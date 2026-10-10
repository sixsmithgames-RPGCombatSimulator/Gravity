import { deserializeGameStateSnapshot } from '@gravity/core';
import { describe, expect, it, vi } from 'vitest';

import { createContentionFactory, createContentionPlan } from '../../testFixtures/sessionContention';

import type { AuthenticatedIdentity } from '../auth/identity';
import { SessionError } from './errors';
import { gravitySessionGameFactory } from './gravitySessionGameFactory';
import { MemorySessionRepository } from './memorySessionRepository';
import { SessionService } from './sessionService';

const host: AuthenticatedIdentity = { subject: 'clerk-host', displayName: 'Host' };
const guest: AuthenticatedIdentity = { subject: 'clerk-guest', displayName: 'Guest' };
const stranger: AuthenticatedIdentity = { subject: 'clerk-stranger', displayName: 'Stranger' };

function createService() {
  const publish = vi.fn();
  const service = new SessionService({
    repository: new MemorySessionRepository(),
    gameFactory: gravitySessionGameFactory,
    events: { publish },
    joinCodePepper: 'test-only-pepper-value',
    createJoinCode: () => 'ABCD2345',
    now: () => new Date('2026-08-01T12:00:00.000Z'),
  });
  return { service, publish };
}

describe('SessionService beta lobby lifecycle', () => {
  it('creates a private lobby and makes reconnect by the same identity idempotent', async () => {
    const { service } = createService();
    const created = await service.createSession({ identity: host, maxPlayers: 4 });
    const rejoined = await service.joinSession({ identity: host, joinCode: 'ABCD-2345' });

    expect(created.joinCode).toBe('ABCD2345');
    expect(created.session.stateVersion).toBe(0);
    expect(created.participant.isHost).toBe(true);
    expect(rejoined.participant.id).toBe(created.participant.id);
    expect(rejoined.session.participants).toHaveLength(1);
    expect(JSON.stringify(created)).not.toContain('joinCodeHash');
  });

  it('rejects a non-member resume without exposing the session', async () => {
    const { service } = createService();
    const created = await service.createSession({ identity: host, maxPlayers: 4 });

    await expect(service.getSession(stranger, created.session.id)).rejects.toMatchObject({
      code: 'NOT_A_MEMBER',
      statusCode: 403,
    });
  });

  it('requires host authority and every participant readiness before committing version 1', async () => {
    const { service, publish } = createService();
    const created = await service.createSession({ identity: host, maxPlayers: 2 });
    await service.joinSession({ identity: guest, joinCode: created.joinCode });

    await expect(service.startSession(guest, created.session.id)).rejects.toMatchObject({ code: 'NOT_HOST' });
    await expect(service.startSession(host, created.session.id)).rejects.toMatchObject({ code: 'NOT_READY' });

    await service.setReady({ identity: host, sessionId: created.session.id, isReady: true });
    await service.setReady({ identity: guest, sessionId: created.session.id, isReady: true });
    const started = await service.startSession(host, created.session.id);

    expect(started.session.status).toBe('active');
    expect(started.session.stateVersion).toBe(1);
    expect(started.session.latestSnapshot?.schemaVersion).toBe(1);
    const hydrated = deserializeGameStateSnapshot(started.session.latestSnapshot);
    expect(hydrated.game.players).toBeInstanceOf(Map);
    expect(hydrated.game.players).toHaveLength(2);
    expect(hydrated.game.board.objects.filter((object) => object.type === 'hostile_ship')).toHaveLength(2);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'game_started', snapshot: expect.objectContaining({ stateVersion: 1 }) }),
    );
  });

  it('requires the configured roster size and lets bots fill ready seats', async () => {
    const { service } = createService();
    const created = await service.createSession({ identity: host, maxPlayers: 3 });
    const joined = await service.joinSession({ identity: guest, joinCode: created.joinCode });

    await service.setReady({ identity: host, sessionId: created.session.id, isReady: true });
    await service.setReady({ identity: guest, sessionId: created.session.id, isReady: true });
    await expect(service.startSession(host, created.session.id)).rejects.toMatchObject({ code: 'NOT_READY' });

    const withBot = await service.setBotSeat({
      identity: host,
      sessionId: created.session.id,
      seatNumber: 3,
      isBot: true,
    });
    expect(withBot.session.participants).toHaveLength(3);
    expect(withBot.session.participants[2]).toMatchObject({
      displayName: 'Bot Commander 3',
      seatNumber: 3,
      isBot: true,
      isReady: true,
      userId: null,
    });

    const started = await service.startSession(host, created.session.id);
    const hydrated = deserializeGameStateSnapshot(started.session.latestSnapshot);
    const bot = Array.from(hydrated.game.players.values()).find((player) => player.isBot);
    expect(bot).toMatchObject({ isBot: true, userId: null, botStrategy: 'default' });

    const guestPending = await service.submitTurn({
      identity: guest,
      sessionId: created.session.id,
      submissionId: '30000000-0000-4000-8000-000000000001',
      expectedStateVersion: 1,
      actions: [],
    });
    expect(guestPending).toMatchObject({ status: 'pending', submittedPlayerIds: [joined.participant.playerId] });

    const committed = await service.submitTurn({
      identity: host,
      sessionId: created.session.id,
      submissionId: '30000000-0000-4000-8000-000000000002',
      expectedStateVersion: 1,
      actions: [],
    });
    expect(committed).toMatchObject({ status: 'committed', stateVersion: 2 });
  });

  it('lets only the host replace non-host seats with bots and reopen them', async () => {
    const { service } = createService();
    const created = await service.createSession({ identity: host, maxPlayers: 2 });
    await service.joinSession({ identity: guest, joinCode: created.joinCode });

    await expect(
      service.setBotSeat({ identity: guest, sessionId: created.session.id, seatNumber: 2, isBot: true }),
    ).rejects.toMatchObject({ code: 'NOT_HOST' });

    const replaced = await service.setBotSeat({
      identity: host,
      sessionId: created.session.id,
      seatNumber: 2,
      isBot: true,
    });
    expect(replaced.session.participants[1]).toMatchObject({ seatNumber: 2, isBot: true, userId: null });
    await expect(service.getSession(guest, created.session.id)).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });

    const reopened = await service.setBotSeat({
      identity: host,
      sessionId: created.session.id,
      seatNumber: 2,
      isBot: false,
    });
    expect(reopened.session.participants).toHaveLength(1);
  });

  it('lets only the host cancel a waiting game', async () => {
    const { service, publish } = createService();
    const created = await service.createSession({ identity: host, maxPlayers: 2 });
    await service.joinSession({ identity: guest, joinCode: created.joinCode });

    await expect(service.cancelSession(guest, created.session.id)).rejects.toMatchObject({ code: 'NOT_HOST' });
    const canceled = await service.cancelSession(host, created.session.id);

    expect(canceled.session.status).toBe('abandoned');
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'session_updated', session: expect.objectContaining({ status: 'abandoned' }) }),
    );
    await expect(
      service.joinSession({ identity: stranger, joinCode: created.joinCode }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('does not accept a seventh seat or a new identity after start', async () => {
    const { service } = createService();
    const created = await service.createSession({ identity: host, maxPlayers: 2 });
    await service.joinSession({ identity: guest, joinCode: created.joinCode });

    await expect(
      service.joinSession({ identity: stranger, joinCode: created.joinCode }),
    ).rejects.toBeInstanceOf(SessionError);

    await service.setReady({ identity: host, sessionId: created.session.id, isReady: true });
    await service.setReady({ identity: guest, sessionId: created.session.id, isReady: true });
    await service.startSession(host, created.session.id);

    await expect(
      service.joinSession({ identity: stranger, joinCode: created.joinCode }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('waits for all active players, commits one full turn, and returns retries idempotently', async () => {
    const { service } = createService();
    const created = await service.createSession({ identity: host, maxPlayers: 2 });
    const joined = await service.joinSession({ identity: guest, joinCode: created.joinCode });
    await service.setReady({ identity: host, sessionId: created.session.id, isReady: true });
    await service.setReady({ identity: guest, sessionId: created.session.id, isReady: true });
    const started = await service.startSession(host, created.session.id);
    expect(started.session.latestSnapshot?.game.turnPhase).toBe('action_planning');

    const guestSubmission = {
      identity: guest,
      sessionId: created.session.id,
      submissionId: '10000000-0000-4000-8000-000000000001',
      expectedStateVersion: 1,
      actions: [],
    };
    const pending = await service.submitTurn(guestSubmission);
    expect(pending).toMatchObject({ status: 'pending', stateVersion: 1 });
    expect(await service.submitTurn(guestSubmission)).toMatchObject({ status: 'duplicate', stateVersion: 1 });

    const committed = await service.submitTurn({
      identity: host,
      sessionId: created.session.id,
      submissionId: '10000000-0000-4000-8000-000000000002',
      expectedStateVersion: 1,
      actions: [],
    });
    expect(committed).toMatchObject({
      status: 'committed',
      stateVersion: 2,
      snapshot: { stateVersion: 2, game: { currentTurn: 2, turnPhase: 'action_planning' } },
    });

    const retry = await service.submitTurn({
      identity: host,
      sessionId: created.session.id,
      submissionId: '10000000-0000-4000-8000-000000000002',
      expectedStateVersion: 1,
      actions: [],
    });
    expect(retry).toMatchObject({ status: 'duplicate', stateVersion: 2, snapshot: { stateVersion: 2 } });

    await expect(
      service.submitTurn({
        identity: guest,
        sessionId: created.session.id,
        submissionId: '10000000-0000-4000-8000-000000000003',
        expectedStateVersion: 1,
        actions: [],
      }),
    ).rejects.toMatchObject({ code: 'STALE_STATE' });

    await expect(
      service.submitTurn({
        identity: host,
        sessionId: created.session.id,
        submissionId: '10000000-0000-4000-8000-000000000004',
        expectedStateVersion: 2,
        actions: [
          {
            playerId: joined.participant.playerId,
            crewId: `${joined.participant.playerId}:first-officer`,
            type: 'restore',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ACTION' });
  });

  it('rejects an invalid early plan without locking it and accepts a corrected plan with the same submission id', async () => {
    const { service, publish } = createService();
    const created = await service.createSession({ identity: host, maxPlayers: 2 });
    await service.joinSession({ identity: guest, joinCode: created.joinCode });
    await service.setReady({ identity: host, sessionId: created.session.id, isReady: true });
    await service.setReady({ identity: guest, sessionId: created.session.id, isReady: true });
    const started = await service.startSession(host, created.session.id);
    const before = structuredClone(started.session.latestSnapshot);
    const submission = {
      identity: host, sessionId: created.session.id,
      submissionId: '40000000-0000-4000-8000-000000000001', expectedStateVersion: 1,
    };
    publish.mockClear();
    await expect(service.submitTurn({ ...submission, actions: [{
      playerId: created.participant.playerId, crewId: 'missing-crew', type: 'restore',
    }] })).rejects.toMatchObject({ code: 'INVALID_ACTION' });
    const rejected = await service.getSession(host, created.session.id);
    expect(rejected.session.pendingPlayerIds).toEqual([]);
    expect(rejected.session.latestSnapshot).toEqual(before);
    expect(publish).not.toHaveBeenCalled();
    expect(await service.submitTurn({ ...submission, actions: [] })).toMatchObject({ status: 'pending' });
    expect(await service.submitTurn({
      identity: guest, sessionId: created.session.id,
      submissionId: '40000000-0000-4000-8000-000000000002', expectedStateVersion: 1, actions: [],
    })).toMatchObject({ status: 'committed', stateVersion: 2 });
  });

  it.each(['attack', 'scan', 'probe', 'torpedo', 'retaliate', 'torpedo-retaliate', 'acquire-attack', 'acquire-retaliate'] as const)('commits two locked %s contention plans after the third human submits', async (mode) => {
    const third = { subject: 'third-attacker', displayName: 'Third' };
    const service = new SessionService({ repository: new MemorySessionRepository(),
      gameFactory: createContentionFactory(mode), events: { publish() {} }, joinCodePepper: 'test-only-pepper-value', createJoinCode: () => 'ATCK2345' });
    const created = await service.createSession({ identity: host, maxPlayers: 3 });
    for (const identity of [guest, third]) await service.joinSession({ identity, joinCode: created.joinCode });
    for (const identity of [host, guest, third]) await service.setReady({ identity, sessionId: created.session.id, isReady: true });
    const started = await service.startSession(host, created.session.id);
    for (const identity of [host, guest]) {
      const participant = started.session.participants.find(member => member.userId === identity.subject);
      if (!participant) throw new Error('Attack fixture participant was not found.');
      expect(await service.submitTurn({ identity, sessionId: created.session.id, expectedStateVersion: 1, submissionId: identity.subject,
        actions: createContentionPlan(participant.playerId, mode, identity === host) })).toMatchObject({ status: 'pending' });
    }
    expect((await service.getSession(host, created.session.id)).session.pendingPlayerIds).toHaveLength(2);
    const committed = await service.submitTurn({ identity: third, sessionId: created.session.id, expectedStateVersion: 1, submissionId: third.subject, actions: [] });
    expect(committed).toMatchObject({ status: 'committed', stateVersion: 2 });
    expect(committed.snapshot?.game.board.objects.filter(object => object.id === 'shared-target')).toEqual(['attack', 'retaliate', 'torpedo-retaliate'].includes(mode) ? [expect.objectContaining({ type: 'debris' })] : []);
    expect((await service.getSession(host, created.session.id)).session.pendingPlayerIds).toEqual([]);
  });
});
