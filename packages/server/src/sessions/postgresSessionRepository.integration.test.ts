import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { sessions, users } from '../database/schema';
import { SessionEventBus } from './eventBus';
import { gravitySessionGameFactory } from './gravitySessionGameFactory';
import { PostgresSessionRepository } from './postgresSessionRepository';
import { SessionService } from './sessionService';

const databaseUrl = process.env.TEST_DATABASE_URL;
let closeDatabase: (() => Promise<void>) | undefined;

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
});
