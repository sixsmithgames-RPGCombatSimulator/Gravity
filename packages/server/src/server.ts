import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import * as dotenv from 'dotenv';
import winston from 'winston';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from './database/client';
import { createApp } from './app';
import { createClerkJwtVerifier } from './auth/identity';
import { SessionEventBus } from './sessions/eventBus';
import { gravitySessionGameFactory } from './sessions/gravitySessionGameFactory';
import { PostgresSessionRepository } from './sessions/postgresSessionRepository';
import { SessionService } from './sessions/sessionService';
import { configureSessionSockets } from './sessions/sessionSockets';
import { createRedisRateLimiter } from './abuse/rateLimiter';
import { createRedisClient } from './redis/client';

dotenv.config();

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

const PORT_RAW = process.env.PORT;

if (!PORT_RAW) {
  throw new Error(
    'PORT environment variable is required.\n' +
      'Root cause: PORT is not set.\n' +
      'Fix: Set PORT (e.g. 3000) in your environment or Docker compose configuration.',
  );
}

const PORT = Number(PORT_RAW);

if (!Number.isInteger(PORT) || PORT <= 0) {
  throw new Error(
    'PORT environment variable must be a positive integer.\n' +
      `Root cause: PORT is "${PORT_RAW}".\n` +
      'Fix: Set PORT to a valid integer (e.g. 3000).',
  );
}

const HOST = process.env.HOST;

if (!HOST) {
  throw new Error(
    'HOST environment variable is required.\n' +
      'Root cause: HOST is not set.\n' +
      'Fix: Set HOST to 0.0.0.0 for containers or localhost for local development.',
  );
}

const CORS_ORIGIN = process.env.CORS_ORIGIN;

if (!CORS_ORIGIN) {
  throw new Error(
    'CORS_ORIGIN environment variable is required.\n' +
      'Root cause: CORS_ORIGIN is not set.\n' +
      'Fix: Set CORS_ORIGIN to your web client origin (e.g. http://localhost:5173).',
  );
}

const CLERK_ISSUER = process.env.CLERK_ISSUER;
if (!CLERK_ISSUER) {
  throw new Error(
    'CLERK_ISSUER environment variable is required.\n' +
      'Root cause: the server cannot verify browser identity tokens without the Clerk issuer.\n' +
      'Fix: Set CLERK_ISSUER to the HTTPS issuer from the Clerk dashboard.',
  );
}

const JOIN_CODE_PEPPER = process.env.JOIN_CODE_PEPPER;
if (!JOIN_CODE_PEPPER) {
  throw new Error(
    'JOIN_CODE_PEPPER environment variable is required.\n' +
      'Root cause: private session join codes must never be stored as plaintext.\n' +
      'Fix: Set JOIN_CODE_PEPPER to a secret value of at least 16 characters.',
  );
}

const redis = createRedisClient();
const rateLimiter = createRedisRateLimiter(redis);

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received "${raw}".`);
  }
  return value;
}

const identityVerifier = createClerkJwtVerifier({
  issuer: CLERK_ISSUER,
  audience: process.env.CLERK_AUDIENCE || undefined,
  authorizedParties: (process.env.CLERK_AUTHORIZED_PARTIES || CORS_ORIGIN)
    .split(',')
    .map((party) => party.trim())
    .filter(Boolean),
});
const sessionEvents = new SessionEventBus();
const sessionService = new SessionService({
  repository: new PostgresSessionRepository(db),
  gameFactory: gravitySessionGameFactory,
  events: sessionEvents,
  joinCodePepper: JOIN_CODE_PEPPER,
});

const app = createApp({
  corsOrigin: CORS_ORIGIN,
  readiness: {
    checkDatabase: () => db.execute(sql`select 1 as ok`),
    checkRedis: () => redis.ping(),
  },
  sessions: {
    service: sessionService,
    identityVerifier,
    rateLimiter,
    edgeRateLimitPolicy: {
      windowMs: positiveIntegerEnvironment('RATE_LIMIT_WINDOW_MS', 15 * 60_000),
      limit: positiveIntegerEnvironment('RATE_LIMIT_MAX_REQUESTS', 100),
    },
  },
});

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: CORS_ORIGIN,
    credentials: true,
  },
});

const stopSessionBroadcasts = configureSessionSockets({
  io,
  identityVerifier,
  service: sessionService,
  events: sessionEvents,
  rateLimiter,
});

server.listen(PORT, HOST, () => {
  redis
    .connect()
    .then(() => {
      logger.info(`Gravity server listening on http://${HOST}:${PORT}`);
    })
    .catch((error) => {
      logger.error(error);
      process.exit(1);
    });
});

async function shutdown(signal: string) {
  logger.info(`Shutting down Gravity server (signal: ${signal})...`);

  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  stopSessionBroadcasts();
  await redis.quit();
  await closeDatabase();
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error(error);
      process.exit(1);
    });
});

process.on('SIGINT', () => {
  shutdown('SIGINT')
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error(error);
      process.exit(1);
    });
});
