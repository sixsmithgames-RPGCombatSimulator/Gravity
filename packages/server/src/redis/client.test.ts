import { describe, expect, it } from 'vitest';

import { createRedisClient } from './client';

describe('Redis client configuration', () => {
  it('supports a hosted TLS URL without requiring host and port variables', () => {
    const client = createRedisClient({ REDIS_URL: 'rediss://user:secret@cache.example.test:6380/2' });

    expect(client.options).toMatchObject({ host: 'cache.example.test', port: 6380, db: 2, lazyConnect: true });
    client.disconnect();
  });

  it('supports local host, password, and explicit TLS configuration', () => {
    const client = createRedisClient({
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: 'local-secret',
      REDIS_TLS: 'true',
    });

    expect(client.options).toMatchObject({
      host: 'redis.internal',
      port: 6379,
      password: 'local-secret',
      lazyConnect: true,
      tls: {},
    });
    client.disconnect();
  });

  it('rejects unsafe or incomplete Redis configuration', () => {
    expect(() => createRedisClient({ REDIS_URL: 'https://cache.example.test' })).toThrow('redis:// or rediss://');
    expect(() => createRedisClient({ REDIS_HOST: 'redis.internal', REDIS_PORT: '70000' })).toThrow(
      'between 1 and 65535',
    );
    expect(() => createRedisClient({})).toThrow('REDIS_HOST');
  });
});
