import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createContentionFactory, createContentionPlan } from '../../testFixtures/sessionContention';

import { sessions, state_snapshots, turn_submissions, users } from '../database/schema';
import { SessionEventBus } from './eventBus';
import { gravitySessionGameFactory } from './gravitySessionGameFactory';
import { PostgresSessionRepository } from './postgresSessionRepository';
import { SessionService } from './sessionService';

const databaseUrl = process.env.TEST_DATABASE_URL;
let closeDatabase: (() => Promise<void>) | undefined;

/** Create an isolated durable two-human lobby and expose cleanup without touching any pre-existing game. */
async function createDurableFixture() {
  process.env.DATABASE_URL = databaseUrl;
  const databaseModule = await import('../database/client');
  closeDatabase = databaseModule.closeDatabase;
  const { db } = databaseModule;
  const repository = new PostgresSessionRepository(db);
  const suffix = randomUUID();
  const host = { subject: `race-host-${suffix}`, displayName: 'Host' };
  const guest = { subject: `race-guest-${suffix}`, displayName: 'Guest' };
  const now = new Date('2026-10-10T12:00:00.000Z');
  const service = new SessionService({ repository, gameFactory: gravitySessionGameFactory, events: new SessionEventBus(),
    joinCodePepper: 'integration-test-pepper-value', createJoinCode: () => randomUUID().replace(/-/g, '').slice(0, 8), now: () => now });
  const created = await service.createSession({ identity: host, maxPlayers: 2 });
  await service.joinSession({ identity: guest, joinCode: created.joinCode });
  await service.setReady({ identity: host, sessionId: created.session.id, isReady: true });
  await service.setReady({ identity: guest, sessionId: created.session.id, isReady: true });
  return { db, repository, service, host, guest, now, sessionId: created.session.id, hostParticipant: created.participant,
    /** Delete only this test's session/users after every assertion, including failed checks. */
    async cleanup() {
      await db.delete(sessions).where(eq(sessions.id, created.session.id));
      await db.delete(users).where(inArray(users.auth_subject, [host.subject, guest.subject]));
    },
  };
}

afterAll(async () => {
  await closeDatabase?.();
});

describe.skipIf(!databaseUrl)('PostgresSessionRepository', () => {
  it('persists membership and the initial snapshot across repository instances', async () => {
    process.env.DATABASE_URL = databaseUrl;
    const databaseModule = await import('../database/client');
    closeDatabase = databaseModule.closeDatabase;
    const { db } = databaseModule;
    const suffix = randomUUID();
    const hostSubject = `integration-host-${suffix}`;
    const guestSubject = `integration-guest-${suffix}`;
    const joinCode = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const service = new SessionService({
      repository: new PostgresSessionRepository(db),
      gameFactory: gravitySessionGameFactory,
      events: new SessionEventBus(),
      joinCodePepper: 'integration-test-pepper-value',
      createJoinCode: () => joinCode,
      now: () => new Date('2026-08-01T12:00:00.000Z'),
    });
    let sessionId: string | null = null;

    try {
      const created = await service.createSession({
        identity: { subject: hostSubject, displayName: 'Host' },
        maxPlayers: 2,
      });
      sessionId = created.session.id;
      await service.joinSession({
        identity: { subject: guestSubject, displayName: 'Guest' },
        joinCode,
      });
      await service.setReady({
        identity: { subject: hostSubject, displayName: 'Host' },
        sessionId,
        isReady: true,
      });
      await service.setReady({
        identity: { subject: guestSubject, displayName: 'Guest' },
        sessionId,
        isReady: true,
      });
      const started = await service.startSession({ subject: hostSubject, displayName: 'Host' }, sessionId);
      const hostParticipant = started.session.participants.find((participant) => participant.userId === hostSubject);
      const guestParticipant = started.session.participants.find((participant) => participant.userId === guestSubject);
      if (!hostParticipant || !guestParticipant) throw new Error('Expected both integration participants.');
      await service.submitTurn({
        identity: { subject: hostSubject, displayName: 'Host' },
        sessionId,
        submissionId: randomUUID(),
        expectedStateVersion: 1,
        actions: [],
      });
      const committed = await service.submitTurn({
        identity: { subject: guestSubject, displayName: 'Guest' },
        sessionId,
        submissionId: randomUUID(),
        expectedStateVersion: 1,
        actions: [],
      });
      expect(committed).toMatchObject({ status: 'committed', stateVersion: 2 });

      const restartedService = new SessionService({
        repository: new PostgresSessionRepository(db),
        gameFactory: gravitySessionGameFactory,
        events: new SessionEventBus(),
        joinCodePepper: 'integration-test-pepper-value',
      });
      const resumed = await restartedService.getSession(
        { subject: guestSubject, displayName: 'Guest' },
        sessionId,
      );

      expect(resumed.session).toMatchObject({ status: 'active', stateVersion: 2 });
      expect(resumed.session.participants).toHaveLength(2);
      expect(resumed.session.latestSnapshot).toMatchObject({ schemaVersion: 1, stateVersion: 2 });
    } finally {
      if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
      await db.delete(users).where(inArray(users.auth_subject, [hostSubject, guestSubject]));
    }
  });

  it('rejects an invalid early plan, commits concurrent corrected plans once, and returns consistent resume versions', async () => {
    const fixture = await createDurableFixture();
    try {
      const { db, service, host, guest, sessionId, hostParticipant } = fixture;
      await service.startSession(host, sessionId);
      const submissionId = randomUUID();
      await expect(service.submitTurn({ identity: host, sessionId, submissionId, expectedStateVersion: 1,
        actions: [{ playerId: hostParticipant.playerId, crewId: 'missing-crew', type: 'restore' }],
      })).rejects.toMatchObject({ code: 'INVALID_ACTION' });
      expect(await db.select().from(turn_submissions).where(eq(turn_submissions.session_id, sessionId))).toHaveLength(0);
      expect((await service.getSession(host, sessionId)).session.pendingPlayerIds).toEqual([]);
      const hostPlan = { identity: host, sessionId, submissionId, expectedStateVersion: 1, actions: [] };
      const results = await Promise.all([
        service.submitTurn(hostPlan),
        service.submitTurn({ identity: guest, sessionId, submissionId: randomUUID(), expectedStateVersion: 1, actions: [] }),
        service.submitTurn(hostPlan),
      ]);
      expect(results.filter((result) => result.status === 'committed')).toHaveLength(1);
      expect(await db.select().from(turn_submissions).where(eq(turn_submissions.session_id, sessionId))).toHaveLength(2);
      expect(await db.select().from(state_snapshots).where(eq(state_snapshots.session_id, sessionId))).toHaveLength(2);
      for (let version = 2; version <= 4; version += 1) {
        const reads = Array.from({ length: 6 }, () => service.getSession(host, sessionId));
        const [, , ...observed] = await Promise.all([
          service.submitTurn({ identity: host, sessionId, submissionId: randomUUID(), expectedStateVersion: version, actions: [] }),
          service.submitTurn({ identity: guest, sessionId, submissionId: randomUUID(), expectedStateVersion: version, actions: [] }),
          ...reads,
        ]);
        for (const access of observed) {
          expect(access.session.latestSnapshot?.stateVersion).toBe(access.session.stateVersion);
        }
      }
      expect((await service.getSession(host, sessionId)).session.stateVersion).toBe(5);
    } finally {
      await fixture.cleanup();
    }
  });

  it('serializes launch against unready and rejects readiness writes after launch', async () => {
    const fixture = await createDurableFixture();
    try {
      const { service, repository, host, guest, sessionId, now } = fixture;
      const [launch, unready] = await Promise.allSettled([
        service.startSession(host, sessionId),
        service.setReady({ identity: guest, sessionId, isReady: false }),
      ]);
      const current = await service.getSession(host, sessionId);
      if (launch.status === 'fulfilled') {
        expect(unready.status).toBe('rejected');
        expect(current.session.status).toBe('active');
        expect(current.session.participants.every((participant) => participant.isReady)).toBe(true);
        await expect(repository.setParticipantReady({ sessionId, userId: guest.subject, isReady: false, now })).rejects.toMatchObject({ code: 'CONFLICT' });
      } else {
        expect(unready.status).toBe('fulfilled');
        expect(current.session.status).toBe('lobby');
        expect(current.session.latestSnapshot).toBeNull();
        expect(current.session.participants.find((participant) => participant.userId === guest.subject)?.isReady).toBe(false);
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects an obsolete launch roster even when replacement shares the exact update timestamp', async () => {
    const fixture = await createDurableFixture();
    try {
      const { repository, sessionId, now } = fixture;
      const ready = await repository.findById(sessionId);
      if (!ready) throw new Error('Durable launch fixture was not found.');
      const oldSnapshot = gravitySessionGameFactory.create({ sessionId, participants: ready.participants, maxPlayers: 2, now });
      await repository.setBotSeat({ sessionId, seatNumber: 2, isBot: true, displayName: 'Bot Commander 2', now });
      await expect(repository.commitStart({ sessionId, snapshot: oldSnapshot, expectedUpdatedAt: now, now })).rejects.toMatchObject({ code: 'CONFLICT' });
      const current = await repository.findById(sessionId);
      expect(current?.status).toBe('lobby');
      expect(current?.latestSnapshot).toBeNull();
      expect(current?.participants[1].isBot).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it('orders equal-clock readiness, roster and cancellation revisions across repository instances', async () => {
    const fixture = await createDurableFixture();
    try {
      const { repository, sessionId, guest, now, db } = fixture;
      const before = await repository.findById(sessionId);
      if (!before) throw new Error('Ordered revision fixture was not found.');
      const unready = await repository.setParticipantReady({ sessionId, userId: guest.subject, isReady: false, now });
      const replaced = await new PostgresSessionRepository(db).setBotSeat({ sessionId, seatNumber: 2, isBot: true, displayName: 'Bot', now });
      const canceled = await repository.cancelLobby({ sessionId, now: new Date(now.getTime() - 1000) });
      expect([unready, replaced, canceled].map(session => session.updatedAt.getTime())).toEqual([1, 2, 3].map(step => before.updatedAt.getTime() + step));
      expect(canceled.status).toBe('abandoned');
    } finally { await fixture.cleanup(); }
  });

  it.each(['attack', 'scan', 'probe', 'torpedo', 'retaliate', 'torpedo-retaliate', 'acquire-attack', 'acquire-retaliate'] as const)('durably resolves two pending %s contention plans when the third human completes the turn', async (mode) => {
    const fixture = await createDurableFixture();
    const third = { subject: `third-${randomUUID()}`, displayName: 'Third' };
    try {
      const { db, repository, host, guest, now, sessionId } = fixture;
      // The isolated fixture's capacity is expanded before any snapshot exists; production routes are unchanged.
      await db.update(sessions).set({ max_players: 3 }).where(eq(sessions.id, sessionId));
      await repository.addParticipant({ sessionId, identity: third, displayName: third.displayName, now });
      await repository.setParticipantReady({ sessionId, userId: third.subject, isReady: true, now });
      const service = new SessionService({ repository, events: new SessionEventBus(), joinCodePepper: 'integration-test-pepper-value',
        gameFactory: createContentionFactory(mode), now: () => now });
      const started = await service.startSession(host, sessionId);
      let previousRevision = started.session.updatedAt.getTime();
      for (const identity of [host, guest]) {
        const participant = started.session.participants.find(member => member.userId === identity.subject);
        if (!participant) throw new Error('Durable attack fixture participant was not found.');
        expect(await service.submitTurn({ identity, sessionId, expectedStateVersion: 1, submissionId: randomUUID(),
          actions: createContentionPlan(participant.playerId, mode, identity === host) })).toMatchObject({ status: 'pending' });
        const pending = await repository.findById(sessionId);
        expect(pending?.updatedAt.getTime()).toBe(previousRevision + 1);
        previousRevision += 1;
      }
      expect(await service.submitTurn({ identity: third, sessionId, expectedStateVersion: 1, submissionId: randomUUID(), actions: [] })).toMatchObject({ status: 'committed', stateVersion: 2 });
      const resumed = await new PostgresSessionRepository(db).findById(sessionId);
      expect(resumed?.pendingPlayerIds).toEqual([]);
      expect(resumed?.updatedAt.getTime()).toBe(previousRevision + 1);
      expect(resumed?.latestSnapshot?.game.board.objects.filter(object => object.id === 'shared-target')).toEqual(['attack', 'retaliate', 'torpedo-retaliate'].includes(mode) ? [expect.objectContaining({ type: 'debris' })] : []);
      expect(await db.select().from(turn_submissions).where(eq(turn_submissions.session_id, sessionId))).toHaveLength(3);
      expect(await db.select().from(state_snapshots).where(eq(state_snapshots.session_id, sessionId))).toHaveLength(2);
    } finally {
      await fixture.cleanup();
      await fixture.db.delete(users).where(eq(users.auth_subject, third.subject));
    }
  });
});
