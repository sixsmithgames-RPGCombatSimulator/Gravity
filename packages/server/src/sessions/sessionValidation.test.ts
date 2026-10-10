import { applyPlayerActions, deserializeGameStateSnapshot, SHIP_SECTIONS, type GameStateSnapshotV1, type PlayerAction } from '@gravity/core';
import { describe, expect, it, vi } from 'vitest';

import { gravitySessionGameFactory } from './gravitySessionGameFactory';
import { MemorySessionRepository } from './memorySessionRepository';
import { SessionService } from './sessionService';
import { validateSessionPlan } from './sessionValidation';

/** Create a real server-authored snapshot without external persistence for canonical validation checks. */
async function createSnapshot(): Promise<GameStateSnapshotV1> {
  const host = { subject: 'validation-host', displayName: 'Host' };
  const guest = { subject: 'validation-guest', displayName: 'Guest' };
  const service = new SessionService({
    repository: new MemorySessionRepository(), gameFactory: gravitySessionGameFactory,
    events: { publish() {} }, joinCodePepper: 'validation-test-pepper-value', createJoinCode: () => 'PLAN2345',
  });
  const created = await service.createSession({ identity: host, maxPlayers: 2 });
  await service.joinSession({ identity: guest, joinCode: created.joinCode });
  await service.setReady({ identity: host, sessionId: created.session.id, isReady: true });
  await service.setReady({ identity: guest, sessionId: created.session.id, isReady: true });
  const started = await service.startSession(host, created.session.id);
  if (!started.session.latestSnapshot) throw new Error('Validation fixture did not launch.');
  return started.session.latestSnapshot;
}

/** Prepare a repository-level launch fixture at one timestamp to expose same-millisecond readiness/roster races. */
async function createReadyRepository() {
  const repository = new MemorySessionRepository();
  const now = new Date('2026-10-10T12:00:00.000Z');
  const host = { subject: 'rollback-host', displayName: 'Host' };
  const created = await repository.createLobby({ identity: host, displayName: host.displayName, maxPlayers: 2, joinCodeHash: 'rollback', now });
  const joined = await repository.addParticipant({ sessionId: created.id, identity: { subject: 'rollback-guest', displayName: 'Guest' }, displayName: 'Guest', now });
  for (const participant of joined.participants) await repository.setParticipantReady({ sessionId: joined.id, userId: participant.userId!, isReady: true, now });
  const ready = await repository.findById(joined.id);
  if (!ready) throw new Error('Repository fixture lobby was not found.');
  const snapshot = gravitySessionGameFactory.create({ sessionId: ready.id, participants: ready.participants, maxPlayers: 2, now });
  return { repository, ready, snapshot, now };
}

describe('canonical pending-plan validation', () => {
  it('validates a whole ordered plan so Restore may enable Route, without changing state or consuming global randomness', async () => {
    const snapshot = await createSnapshot();
    const player = snapshot.game.players[0];
    player.ship.sections[SHIP_SECTIONS.BRIDGE].hull = 3;
    player.ship.sections[SHIP_SECTIONS.BRIDGE].powerDice = [];
    player.ship.sections[SHIP_SECTIONS.ENGINEERING].hull = 3;
    player.ship.sections[SHIP_SECTIONS.ENGINEERING].powerDice = [];
    player.ship.sections[SHIP_SECTIONS.ENGINEERING].conduitConnections[SHIP_SECTIONS.BRIDGE] = 1;
    const route: PlayerAction = {
      playerId: player.id, crewId: `${player.id}:first-officer`, type: 'route',
      parameters: { sourceSection: SHIP_SECTIONS.BRIDGE, targetSection: 'life_support', amount: 1 },
    };
    expect(() => validateSessionPlan(snapshot, player.id, [route])).toThrow();
    const plans: PlayerAction[] = [{ playerId: player.id, crewId: `${player.id}:chief-engineer`, type: 'restore',
      parameters: { routeAllocations: [{ section: SHIP_SECTIONS.BRIDGE, amount: 2 }] },
    }, route];
    const before = structuredClone(snapshot);
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Preflight consumed global randomness.'); });
    try {
      validateSessionPlan(snapshot, player.id, plans);
      validateSessionPlan(snapshot, player.id, plans);
      expect(snapshot).toEqual(before);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it('accepts individually legal shared-target acquisitions and resolves contention without duplicating the reward', async () => {
    const snapshot = await createSnapshot();
    snapshot.game.board.objects = [{ id: 'shared-debris', type: 'debris', position: { ring: 8, space: 0 }, lootResourceType: 'fuel_cell' }];
    const plans = Object.fromEntries(snapshot.game.players.map((player) => {
      player.ship.sections[SHIP_SECTIONS.BRIDGE].hull = 3;
      player.ship.sections[SHIP_SECTIONS.BRIDGE].powerDice = [3];
      player.scanDiscoveriesByObjectId = {
        'shared-debris': { objectId: 'shared-debris', objectType: 'debris', source: 'scan', rollValue: 6, totalRoll: 6,
          foundResource: true, resourceType: 'fuel_cell', foundUpgrade: false, reservedUpgrade: null,
          revealedAtTurn: snapshot.game.currentTurn, crewId: player.captain.id },
      };
      return [player.id, [{ playerId: player.id, crewId: player.captain.id, type: 'acquire' as const, target: { objectId: 'shared-debris' } }]];
    }));
    const before = structuredClone(snapshot);
    for (const player of snapshot.game.players) validateSessionPlan(snapshot, player.id, plans[player.id]);
    const game = deserializeGameStateSnapshot(structuredClone(snapshot)).game;
    const resolved = applyPlayerActions({ ...game, turnPhase: 'action_execution' }, plans);
    expect(resolved.board.objects).toHaveLength(0);
    const second = snapshot.game.players[1];
    expect(resolved.players.get(second.id)?.resources).toEqual(second.resources);
    expect(snapshot).toEqual(before);
  });

  it('does not persist the final submission when combined resolution rejects it', async () => {
    const { repository, ready, snapshot } = await createReadyRepository();
    await repository.commitStart({ sessionId: ready.id, snapshot, expectedUpdatedAt: ready.updatedAt, now: new Date() });
    const submit = { sessionId: ready.id, expectedStateVersion: 1, actions: [], requiredPlayerIds: ready.participants.map((player) => player.playerId),
      validate: validateSessionPlan, now: new Date(), process: () => { throw new Error('Combined rule failure.'); } };
    await repository.submitTurn({ ...submit, participantId: ready.participants[0].id, submissionId: 'first' });
    await expect(repository.submitTurn({ ...submit, participantId: ready.participants[1].id, submissionId: 'second' })).rejects.toThrow('Combined rule failure.');
    expect((await repository.findById(ready.id))?.pendingPlayerIds).toEqual([ready.participants[0].playerId]);
    expect(await repository.submitTurn({ ...submit, participantId: ready.participants[1].id, submissionId: 'second', process: (current) => ({ ...current, stateVersion: 2 }) })).toMatchObject({ status: 'committed', stateVersion: 2 });
  });

  it('rechecks readiness and player identity at launch independently of revision equality', async () => {
    const { repository, ready, snapshot, now } = await createReadyRepository();
    const guest = ready.participants[1];
    const unready = await repository.setParticipantReady({ sessionId: ready.id, userId: guest.userId!, isReady: false, now });
    await expect(repository.commitStart({ sessionId: ready.id, snapshot, expectedUpdatedAt: unready.updatedAt, now })).rejects.toMatchObject({ code: 'NOT_READY' });
    await repository.setParticipantReady({ sessionId: ready.id, userId: guest.userId!, isReady: true, now });
    const updated = await repository.setBotSeat({ sessionId: ready.id, seatNumber: 2, isBot: true, displayName: 'Bot Commander 2', now });
    await expect(repository.commitStart({ sessionId: ready.id, snapshot, expectedUpdatedAt: updated.updatedAt, now })).rejects.toMatchObject({ code: 'CONFLICT' });
    const currentSnapshot = gravitySessionGameFactory.create({ sessionId: ready.id, participants: updated.participants, maxPlayers: 2, now });
    await repository.commitStart({ sessionId: ready.id, snapshot: currentSnapshot, expectedUpdatedAt: updated.updatedAt, now });
    await expect(repository.setParticipantReady({ sessionId: ready.id, userId: ready.participants[0].userId!, isReady: false, now })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await repository.findById(ready.id))?.participants[0].isReady).toBe(true);
  });

  it('orders equal-clock readiness, roster, cancellation and pending/committed turn summaries', async () => {
    const { repository, ready, snapshot, now } = await createReadyRepository();
    const revisions = [ready.updatedAt.getTime()];
    const unready = await repository.setParticipantReady({ sessionId: ready.id, userId: ready.createdBy, isReady: false, now });
    revisions.push(unready.updatedAt.getTime());
    const bot = await repository.setBotSeat({ sessionId: ready.id, seatNumber: 2, isBot: true, displayName: 'Bot', now });
    revisions.push(bot.updatedAt.getTime());
    const canceled = await repository.cancelLobby({ sessionId: ready.id, now: new Date(now.getTime() - 1000) });
    revisions.push(canceled.updatedAt.getTime());
    expect(revisions).toEqual(revisions.map((_, index) => revisions[0] + index));
    expect(canceled.status).toBe('abandoned');

    const active = await createReadyRepository();
    const started = await active.repository.commitStart({ sessionId: active.ready.id, snapshot: active.snapshot, expectedUpdatedAt: active.ready.updatedAt, now });
    const submit = { sessionId: active.ready.id, expectedStateVersion: 1, actions: [], requiredPlayerIds: active.ready.participants.map(player => player.playerId),
      validate: validateSessionPlan, process: () => ({ ...snapshot, stateVersion: 2 }), now };
    const first = { ...submit, participantId: active.ready.participants[0].id, submissionId: 'ordered-first' };
    await active.repository.submitTurn(first);
    const pending = await active.repository.findById(active.ready.id);
    await active.repository.submitTurn(first);
    expect((await active.repository.findById(active.ready.id))?.updatedAt).toEqual(pending?.updatedAt);
    await active.repository.submitTurn({ ...submit, participantId: active.ready.participants[1].id, submissionId: 'ordered-last' });
    expect(pending?.updatedAt.getTime()).toBe(started.updatedAt.getTime() + 1);
    expect((await active.repository.findById(active.ready.id))?.updatedAt.getTime()).toBe(started.updatedAt.getTime() + 2);
  });
});
