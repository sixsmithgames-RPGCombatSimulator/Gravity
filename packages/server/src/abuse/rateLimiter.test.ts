import { describe, expect, it, vi } from 'vitest';

import { createRateLimitKey, createRedisRateLimiter, type RedisEvalClient } from './rateLimiter';

describe('Redis rate limiter', () => {
  it('uses an atomic Redis decision and returns stable allowance metadata', async () => {
    const redis: RedisEvalClient = {
      eval: vi.fn().mockResolvedValueOnce([1, 5_000]).mockResolvedValueOnce([3, 2_400]),
    };
    const limiter = createRedisRateLimiter(redis, 'test-rate');

    await expect(limiter.consume('create:abc', { limit: 2, windowMs: 5_000 })).resolves.toEqual({
      allowed: true,
      remaining: 1,
      retryAfterMs: 5_000,
    });
    await expect(limiter.consume('create:abc', { limit: 2, windowMs: 5_000 })).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 2_400,
    });
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('INCR'"), 1, 'test-rate:create:abc', 5_000);
  });

  it('does not expose the raw identity in operational keys', () => {
    const key = createRateLimitKey('session create', 'user_very-sensitive-identifier');
    expect(key).toMatch(/^session_create:[a-f0-9]{64}$/);
    expect(key).not.toContain('very-sensitive');
  });
});
