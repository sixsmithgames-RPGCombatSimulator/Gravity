import Redis from 'ioredis';

export type RedisEnvironment = {
  [key: string]: string | undefined;
  REDIS_URL?: string;
  REDIS_HOST?: string;
  REDIS_PORT?: string;
  REDIS_PASSWORD?: string;
  REDIS_TLS?: string;
};

function parseRedisPort(rawPort: string | undefined): number {
  if (!rawPort) {
    throw new Error(
      'REDIS_PORT environment variable is required when REDIS_URL is not set. ' +
        'Set REDIS_PORT to the Redis TCP port, usually 6379.',
    );
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('REDIS_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function requireRedisUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new Error('REDIS_URL must use the redis:// or rediss:// protocol.');
  }
  if (!parsed.hostname) {
    throw new Error('REDIS_URL must include a hostname.');
  }
  return rawUrl;
}

/** Create a lazy Redis client for local host/port or a hosted TLS Redis URL. */
export function createRedisClient(environment: RedisEnvironment = process.env): Redis {
  const redisUrl = environment.REDIS_URL?.trim();
  if (redisUrl) {
    return new Redis(requireRedisUrl(redisUrl), {
      lazyConnect: true,
      enableReadyCheck: true,
    });
  }

  const host = environment.REDIS_HOST?.trim();
  if (!host) {
    throw new Error(
      'REDIS_HOST environment variable is required when REDIS_URL is not set. ' +
        'Set REDIS_HOST or provide a hosted REDIS_URL.',
    );
  }

  const tlsEnabled = environment.REDIS_TLS?.trim().toLowerCase() === 'true';
  return new Redis({
    host,
    port: parseRedisPort(environment.REDIS_PORT),
    password: environment.REDIS_PASSWORD?.trim() || undefined,
    lazyConnect: true,
    enableReadyCheck: true,
    ...(tlsEnabled ? { tls: {} } : {}),
  });
}
