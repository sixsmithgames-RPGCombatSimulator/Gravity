import { createServer } from 'node:http';

import { io as createClient } from 'socket.io-client';
import { Server as SocketIOServer } from 'socket.io';
import { afterEach, describe, expect, it } from 'vitest';

import type { IdentityVerifier } from '../auth/identity';
import type { RateLimiter } from '../abuse/rateLimiter';
import { SessionEventBus } from './eventBus';
import { gravitySessionGameFactory } from './gravitySessionGameFactory';
import { MemorySessionRepository } from './memorySessionRepository';
import { SessionService } from './sessionService';
import { configureSessionSockets } from './sessionSockets';

const openServers: Array<{ io: SocketIOServer; server: ReturnType<typeof createServer>; stop: () => void }> = [];

afterEach(async () => {
  while (openServers.length > 0) {
    const item = openServers.pop();
    if (!item) continue;
    item.stop();
    await item.io.close();
    await new Promise<void>((resolve) => item.server.close(() => resolve()));
  }
});

describe('authenticated session sockets', () => {
  it('refuses a socket handshake when the shared connection limit is exceeded', async () => {
    const verifier: IdentityVerifier = {
      async verify(token) {
        return { subject: token, displayName: token };
      },
    };
    const rateLimiter: RateLimiter = {
      async consume() {
        return { allowed: false, remaining: 0, retryAfterMs: 30_000 };
      },
    };
    const events = new SessionEventBus();
    const service = new SessionService({
      repository: new MemorySessionRepository(),
      gameFactory: gravitySessionGameFactory,
      events,
      joinCodePepper: 'test-only-pepper-value',
    });
    const server = createServer();
    const io = new SocketIOServer(server);
    const stop = configureSessionSockets({ io, identityVerifier: verifier, service, events, rateLimiter });
    openServers.push({ io, server, stop });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test address.');

    const client = createClient(`http://127.0.0.1:${address.port}`, {
      auth: { token: 'guest' },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    const message = await new Promise<string>((resolve) => {
      client.once('connect_error', (error) => resolve(error.message));
    });

    expect(message).toBe('RATE_LIMITED');
    client.disconnect();
  });

  it('rejoins durable membership and sends the latest lobby snapshot', async () => {
    const verifier: IdentityVerifier = {
      async verify(token) {
        return { subject: token, displayName: token };
      },
    };
    const events = new SessionEventBus();
    const service = new SessionService({
      repository: new MemorySessionRepository(),
      gameFactory: gravitySessionGameFactory,
      events,
      joinCodePepper: 'test-only-pepper-value',
      createJoinCode: () => 'SOCKET23',
    });
    const created = await service.createSession({
      identity: { subject: 'host', displayName: 'Host' },
      maxPlayers: 4,
    });
    await service.joinSession({
      identity: { subject: 'guest', displayName: 'Guest' },
      joinCode: created.joinCode,
    });

    const server = createServer();
    const io = new SocketIOServer(server);
    const stop = configureSessionSockets({ io, identityVerifier: verifier, service, events });
    openServers.push({ io, server, stop });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test address.');

    const client = createClient(`http://127.0.0.1:${address.port}`, {
      auth: { token: 'guest' },
      transports: ['websocket'],
      forceNew: true,
    });
    const lobbyPromise = new Promise<{ id: string }>((resolve) => client.once('session_updated', resolve));
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    const ack = await new Promise<{ ok: boolean; code?: string }>((resolve) => {
      client.emit('join_session', { sessionId: created.session.id }, resolve);
    });

    expect(ack).toEqual({ ok: true });
    await expect(lobbyPromise).resolves.toMatchObject({ id: created.session.id });
    client.disconnect();

    await expect(
      service.getSession({ subject: 'guest', displayName: 'Guest' }, created.session.id),
    ).resolves.toMatchObject({ participant: { userId: 'guest' } });
  });

  it('refuses socket room access to a verified non-member', async () => {
    const verifier: IdentityVerifier = {
      async verify(token) {
        return { subject: token, displayName: token };
      },
    };
    const events = new SessionEventBus();
    const service = new SessionService({
      repository: new MemorySessionRepository(),
      gameFactory: gravitySessionGameFactory,
      events,
      joinCodePepper: 'test-only-pepper-value',
      createJoinCode: () => 'DENY2345',
    });
    const created = await service.createSession({
      identity: { subject: 'host', displayName: 'Host' },
      maxPlayers: 4,
    });
    const server = createServer();
    const io = new SocketIOServer(server);
    const stop = configureSessionSockets({ io, identityVerifier: verifier, service, events });
    openServers.push({ io, server, stop });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test address.');

    const client = createClient(`http://127.0.0.1:${address.port}`, {
      auth: { token: 'stranger' },
      transports: ['websocket'],
      forceNew: true,
    });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    const ack = await new Promise<{ ok: boolean; code?: string }>((resolve) => {
      client.emit('join_session', { sessionId: created.session.id }, resolve);
    });

    expect(ack).toMatchObject({ ok: false, code: 'NOT_A_MEMBER' });
    client.disconnect();
  });
});
