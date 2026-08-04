import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app';
import type { IdentityVerifier } from '../auth/identity';
import type { RateLimiter } from '../abuse/rateLimiter';
import { SessionEventBus } from './eventBus';
import { gravitySessionGameFactory } from './gravitySessionGameFactory';
import { MemorySessionRepository } from './memorySessionRepository';
import { SessionService } from './sessionService';

const identityVerifier: IdentityVerifier = {
  async verify(token) {
    if (!['host-token', 'guest-token', 'stranger-token'].includes(token)) {
      throw new Error('invalid token');
    }
    return { subject: token, displayName: token.replace('-token', '') };
  },
};

function createSessionApp(rateLimiter?: RateLimiter) {
  const service = new SessionService({
    repository: new MemorySessionRepository(),
    gameFactory: gravitySessionGameFactory,
    events: new SessionEventBus(),
    joinCodePepper: 'test-only-pepper-value',
    createJoinCode: () => 'JOIN2345',
    now: () => new Date('2026-08-01T12:00:00.000Z'),
  });
  return createApp({
    corsOrigin: 'http://localhost:5173',
    readiness: {
      checkDatabase: async () => undefined,
      checkRedis: async () => undefined,
    },
    sessions: { service, identityVerifier, rateLimiter },
  });
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('session HTTP API', () => {
  it('requires verified identity', async () => {
    const response = await request(createSessionApp()).post('/sessions').send({ maxPlayers: 2 });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns a stable 429 response when an identity exceeds a mutation limit', async () => {
    const rateLimiter: RateLimiter = {
      async consume(key, policy) {
        const allowed = !key.startsWith('session-create:');
        return {
          allowed,
          remaining: allowed ? policy.limit - 1 : 0,
          retryAfterMs: 4_200,
        };
      },
    };
    const response = await request(createSessionApp(rateLimiter))
      .post('/sessions')
      .set(bearer('host-token'))
      .send({ maxPlayers: 2 });

    expect(response.status).toBe(429);
    expect(response.header['retry-after']).toBe('5');
    expect(response.body.error).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('exposes host-authorized bot roster and cancellation mutations', async () => {
    const app = createSessionApp();
    const created = await request(app)
      .post('/sessions')
      .set(bearer('host-token'))
      .send({ displayName: 'Commander Host', maxPlayers: 3 });
    const sessionId = created.body.session.id as string;

    const forbiddenBot = await request(app)
      .post(`/sessions/${sessionId}/bots`)
      .set(bearer('stranger-token'))
      .send({ seatNumber: 2, isBot: true });
    expect(forbiddenBot.status).toBe(403);
    expect(forbiddenBot.body.error.code).toBe('NOT_A_MEMBER');

    const bot = await request(app)
      .post(`/sessions/${sessionId}/bots`)
      .set(bearer('host-token'))
      .send({ seatNumber: 2, isBot: true });
    expect(bot.status).toBe(200);
    expect(bot.body.session.participants[1]).toMatchObject({
      seatNumber: 2,
      isBot: true,
      isReady: true,
      userId: null,
    });

    const canceled = await request(app)
      .post(`/sessions/${sessionId}/cancel`)
      .set(bearer('host-token'))
      .send();
    expect(canceled.status).toBe(200);
    expect(canceled.body.session.status).toBe('abandoned');

    const lateBot = await request(app)
      .post(`/sessions/${sessionId}/bots`)
      .set(bearer('host-token'))
      .send({ seatNumber: 3, isBot: true });
    expect(lateBot.status).toBe(409);
    expect(lateBot.body.error.code).toBe('CONFLICT');
  });

  it('completes create, join, ready, start, and authenticated resume', async () => {
    const app = createSessionApp();
    const created = await request(app)
      .post('/sessions')
      .set(bearer('host-token'))
      .send({ displayName: 'Commander Host', maxPlayers: 2 });
    expect(created.status).toBe(201);
    expect(created.body.joinCode).toBe('JOIN2345');
    const sessionId = created.body.session.id as string;

    const joined = await request(app)
      .post('/sessions/join')
      .set(bearer('guest-token'))
      .send({ joinCode: 'JOIN-2345', displayName: 'Commander Guest' });
    expect(joined.status).toBe(200);
    expect(joined.body.session.participants).toHaveLength(2);

    for (const token of ['host-token', 'guest-token']) {
      const ready = await request(app)
        .post(`/sessions/${sessionId}/ready`)
        .set(bearer(token))
        .send({ isReady: true });
      expect(ready.status).toBe(200);
    }

    const started = await request(app)
      .post(`/sessions/${sessionId}/start`)
      .set(bearer('host-token'))
      .send();
    expect(started.status).toBe(200);
    expect(started.body.session.latestSnapshot).toMatchObject({ schemaVersion: 1, stateVersion: 1 });

    const guestTurn = await request(app)
      .post(`/sessions/${sessionId}/turns`)
      .set(bearer('guest-token'))
      .send({
        submissionId: '20000000-0000-4000-8000-000000000001',
        expectedStateVersion: 1,
        actions: [],
      });
    expect(guestTurn.status).toBe(202);
    expect(guestTurn.body.status).toBe('pending');

    const hostTurnPayload = {
      submissionId: '20000000-0000-4000-8000-000000000002',
      expectedStateVersion: 1,
      actions: [],
    };
    const hostTurn = await request(app)
      .post(`/sessions/${sessionId}/turns`)
      .set(bearer('host-token'))
      .send(hostTurnPayload);
    expect(hostTurn.status).toBe(200);
    expect(hostTurn.body).toMatchObject({ status: 'committed', stateVersion: 2 });

    const retriedTurn = await request(app)
      .post(`/sessions/${sessionId}/turns`)
      .set(bearer('host-token'))
      .send(hostTurnPayload);
    expect(retriedTurn.status).toBe(200);
    expect(retriedTurn.body).toMatchObject({ status: 'duplicate', stateVersion: 2 });

    const resumed = await request(app)
      .get(`/sessions/${sessionId}`)
      .set(bearer('guest-token'));
    expect(resumed.status).toBe(200);
    expect(resumed.body.participant.displayName).toBe('Commander Guest');
    expect(resumed.body.session.latestSnapshot.stateVersion).toBe(2);

    const rejected = await request(app)
      .get(`/sessions/${sessionId}`)
      .set(bearer('stranger-token'));
    expect(rejected.status).toBe(403);
    expect(rejected.body.error.code).toBe('NOT_A_MEMBER');
  });
});
