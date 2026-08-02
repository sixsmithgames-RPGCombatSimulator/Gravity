import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app';

function createHealthyApp() {
  return createApp({
    corsOrigin: 'http://localhost:5173',
    readiness: {
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      checkRedis: vi.fn().mockResolvedValue('PONG'),
    },
  });
}

describe('health endpoints', () => {
  it('reports liveness without checking external dependencies', async () => {
    const response = await request(createHealthyApp()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it.each(['/health', '/health/ready'])('reports readiness at %s', async (path) => {
    const response = await request(createHealthyApp()).get(path);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      checks: {
        database: 'ok',
        redis: 'ok',
      },
    });
  });

  it('returns a sanitized unavailable response when a dependency fails', async () => {
    const app = createApp({
      corsOrigin: 'http://localhost:5173',
      readiness: {
        checkDatabase: vi.fn().mockRejectedValue(new Error('secret database hostname leaked')),
        checkRedis: vi.fn().mockResolvedValue('PONG'),
      },
    });

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      checks: {
        database: 'unavailable',
        redis: 'ok',
      },
    });
    expect(response.text).not.toContain('secret database hostname leaked');
  });
});

describe('CORS', () => {
  it.each(['https://gravity-staging.sixsmithgames.com', 'https://gravity-preview.example.test'])(
    'allows configured origin %s',
    async (origin) => {
      const app = createApp({
        corsOrigin: ['https://gravity-staging.sixsmithgames.com', 'https://gravity-preview.example.test'],
        readiness: {
          checkDatabase: vi.fn().mockResolvedValue(undefined),
          checkRedis: vi.fn().mockResolvedValue('PONG'),
        },
      });

      const response = await request(app).get('/health/live').set('Origin', origin);

      expect(response.headers['access-control-allow-origin']).toBe(origin);
    },
  );
});
