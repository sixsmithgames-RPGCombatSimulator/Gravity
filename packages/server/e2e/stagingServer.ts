import { createServer } from 'node:http';

import { sql } from 'drizzle-orm';
import { Server as SocketIOServer } from 'socket.io';

import { createRedisRateLimiter } from '../src/abuse/rateLimiter';
import { createApp } from '../src/app';
import type { IdentityVerifier } from '../src/auth/identity';
import { closeDatabase, db } from '../src/database/client';
import { createRedisClient } from '../src/redis/client';
import { SessionEventBus } from '../src/sessions/eventBus';
import { gravitySessionGameFactory } from '../src/sessions/gravitySessionGameFactory';
import { PostgresSessionRepository } from '../src/sessions/postgresSessionRepository';
import { SessionService } from '../src/sessions/sessionService';
import { configureSessionSockets } from '../src/sessions/sessionSockets';

if (process.env.GRAVITY_E2E !== '1') {
  throw new Error('The staging E2E server can run only when GRAVITY_E2E=1.');
}

const host = '127.0.0.1';
const port = Number(process.env.E2E_API_PORT || '3110');
const webOrigin = process.env.E2E_WEB_ORIGIN || 'http://127.0.0.1:4197';
const joinCodePepper = process.env.JOIN_CODE_PEPPER;
const tokenPattern = /^e2e:([a-z0-9-]{1,32})$/;

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error('E2E_API_PORT must be an integer between 1 and 65535.');
}
if (!joinCodePepper || joinCodePepper.length < 16) {
  throw new Error('JOIN_CODE_PEPPER must contain at least 16 characters for staging certification.');
}

const identityVerifier: IdentityVerifier = {
  async verify(token) {
    const match = tokenPattern.exec(token);
    if (!match) throw new Error('Invalid staging E2E identity token.');
    return { subject: `e2e:${match[1]}`, displayName: match[1] };
  },
};

const redis = createRedisClient();
const rateLimiter = createRedisRateLimiter(redis, 'gravity:staging-cert:rate');
const events = new SessionEventBus();
const service = new SessionService({
  repository: new PostgresSessionRepository(db),
  gameFactory: gravitySessionGameFactory,
  events,
  joinCodePepper,
});
const app = createApp({
  corsOrigin: webOrigin,
  readiness: {
    checkDatabase: () => db.execute(sql`select 1 as ok`),
    checkRedis: () => redis.ping(),
  },
  sessions: {
    service,
    identityVerifier,
    rateLimiter,
    edgeRateLimitPolicy: { limit: 100, windowMs: 60_000 },
  },
});
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: webOrigin, credentials: true },
});
const stopBroadcasts = configureSessionSockets({ io, identityVerifier, service, events, rateLimiter });
let stopping = false;

async function start(): Promise<void> {
  await redis.connect();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  process.stdout.write(`Gravity staging E2E server listening on http://${host}:${port}\n`);
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  stopBroadcasts();
  await io.close();
  if (server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await redis.quit();
  await closeDatabase();
}

process.on('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => void shutdown().finally(() => process.exit(0)));

void start().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  void shutdown().finally(() => process.exit(1));
});
