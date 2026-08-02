import { deserializeGameStateSnapshot } from '@gravity/core';
import { describe, expect, it, vi } from 'vitest';

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
    const created = await service.createSession({ identity: host, maxPlayers: 4 });
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
});
