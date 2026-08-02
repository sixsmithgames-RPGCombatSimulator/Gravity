import type { Server as SocketIOServer } from 'socket.io';

import { readBearerToken, type IdentityVerifier } from '../auth/identity';
import { createRateLimitKey, type RateLimiter } from '../abuse/rateLimiter';
import { SessionError } from './errors';
import type { SessionEventBus } from './eventBus';
import type { SessionService } from './sessionService';

type JoinSessionAck = (
  result: { ok: true } | { ok: false; code: string; message: string; retryAfterMs?: number },
) => void;

function roomName(sessionId: string): string {
  return `session:${sessionId}`;
}

/** Configure authenticated session rooms. Persistent membership remains in PostgreSQL, never socket state. */
export function configureSessionSockets(options: {
  io: SocketIOServer;
  identityVerifier: IdentityVerifier;
  service: SessionService;
  events: SessionEventBus;
  rateLimiter?: RateLimiter;
}): () => void {
  options.io.use(async (socket, next) => {
    if (options.rateLimiter) {
      try {
        const decision = await options.rateLimiter.consume(
          createRateLimitKey('socket-connect', socket.handshake.address || 'unknown'),
          { limit: 30, windowMs: 60_000 },
        );
        if (!decision.allowed) {
          next(new Error('RATE_LIMITED'));
          return;
        }
      } catch {
        next(new Error('RATE_LIMIT_UNAVAILABLE'));
        return;
      }
    }

    const authToken = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined;
    const headerToken = readBearerToken(socket.handshake.headers.authorization);
    const token = authToken?.trim() || headerToken;
    if (!token) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }

    try {
      socket.data.identity = await options.identityVerifier.verify(token);
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  options.io.on('connection', (socket) => {
    socket.on('join_session', async (payload: unknown, ack?: JoinSessionAck) => {
      const sessionId =
        typeof payload === 'object' && payload !== null && typeof (payload as { sessionId?: unknown }).sessionId === 'string'
          ? (payload as { sessionId: string }).sessionId
          : '';
      try {
        if (options.rateLimiter) {
          const decision = await options.rateLimiter.consume(
            createRateLimitKey('socket-join', socket.data.identity.subject),
            { limit: 30, windowMs: 60_000 },
          );
          if (!decision.allowed) {
            ack?.({
              ok: false,
              code: 'RATE_LIMITED',
              message: 'Too many room join attempts. Retry shortly.',
              retryAfterMs: decision.retryAfterMs,
            });
            return;
          }
        }
        const access = await options.service.getSession(socket.data.identity, sessionId);
        await socket.join(roomName(sessionId));
        socket.data.sessionId = sessionId;
        socket.emit('session_updated', access.session);
        if (access.session.latestSnapshot) {
          socket.emit('state_snapshot', access.session.latestSnapshot);
        }
        ack?.({ ok: true });
      } catch (error) {
        if (!(error instanceof SessionError)) {
          ack?.({
            ok: false,
            code: 'RATE_LIMIT_UNAVAILABLE',
            message: 'Request protection is temporarily unavailable. Retry shortly.',
          });
          return;
        }
        const code = error instanceof SessionError ? error.code : 'INVALID_REQUEST';
        const message = error instanceof Error ? error.message : 'Unable to join the session room.';
        ack?.({ ok: false, code, message });
      }
    });
  });

  return options.events.subscribe((event) => {
    const room = roomName(event.session.id);
    if (event.type === 'game_started') {
      options.io.to(room).emit('game_started', event.snapshot);
      options.io.to(room).emit('state_snapshot', event.snapshot);
    }
    if (event.type === 'state_snapshot') {
      options.io.to(room).emit('state_snapshot', event.snapshot);
    }
    options.io.to(room).emit('session_updated', event.session);
  });
}
