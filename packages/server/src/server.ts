import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import * as dotenv from 'dotenv';
import Redis from 'ioredis';
import winston from 'winston';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from './database/client';

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

const REDIS_HOST = process.env.REDIS_HOST;

if (!REDIS_HOST) {
  throw new Error(
    'REDIS_HOST environment variable is required.\n' +
      'Root cause: REDIS_HOST is not set.\n' +
      'Fix: Set REDIS_HOST (e.g. "redis" in Docker compose).',
  );
}

const REDIS_PORT_RAW = process.env.REDIS_PORT;

if (!REDIS_PORT_RAW) {
  throw new Error(
    'REDIS_PORT environment variable is required.\n' +
      'Root cause: REDIS_PORT is not set.\n' +
      'Fix: Set REDIS_PORT (e.g. 6379).',
  );
}

const REDIS_PORT = Number(REDIS_PORT_RAW);

if (!Number.isInteger(REDIS_PORT) || REDIS_PORT <= 0) {
  throw new Error(
    'REDIS_PORT environment variable must be a positive integer.\n' +
      `Root cause: REDIS_PORT is "${REDIS_PORT_RAW}".\n` +
      'Fix: Set REDIS_PORT to a valid integer (e.g. 6379).',
  );
}

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  lazyConnect: true,
});

const app = express();

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  }),
);

app.get('/health', async (_req, res) => {
  try {
    await db.execute(sql`select 1 as ok`);
    await redis.ping();

    res.status(200).json({
      ok: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      ok: false,
      error: message,
    });
  }
});

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: CORS_ORIGIN,
    credentials: true,
  },
});

io.on('connection', (socket) => {
  socket.emit('connected', { ok: true });
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
