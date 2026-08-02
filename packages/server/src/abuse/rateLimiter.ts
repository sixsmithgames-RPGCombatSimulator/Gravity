import { createHash } from 'node:crypto';

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export interface RateLimiter {
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision>;
}

export interface RedisEvalClient {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

function requirePolicy(policy: RateLimitPolicy): void {
  if (!Number.isInteger(policy.limit) || policy.limit <= 0) {
    throw new Error('Rate-limit policy limit must be a positive integer.');
  }
  if (!Number.isInteger(policy.windowMs) || policy.windowMs <= 0) {
    throw new Error('Rate-limit policy windowMs must be a positive integer.');
  }
}

/** Hide raw IP addresses and identity subjects from Redis keys and operational tooling. */
export function createRateLimitKey(scope: string, identifier: string): string {
  const safeScope = scope.replace(/[^a-zA-Z0-9:_-]/g, '_');
  const digest = createHash('sha256').update(identifier).digest('hex');
  return `${safeScope}:${digest}`;
}

/** Atomic fixed-window limiter shared by every server replica through Redis. */
export function createRedisRateLimiter(redis: RedisEvalClient, prefix = 'gravity:rate'): RateLimiter {
  return {
    async consume(key, policy) {
      requirePolicy(policy);
      const result = await redis.eval(FIXED_WINDOW_SCRIPT, 1, `${prefix}:${key}`, policy.windowMs);
      if (!Array.isArray(result) || result.length < 2) {
        throw new Error('Redis returned an invalid rate-limit decision.');
      }

      const count = Number(result[0]);
      const ttl = Number(result[1]);
      if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
        throw new Error('Redis returned non-numeric rate-limit counters.');
      }

      return {
        allowed: count <= policy.limit,
        remaining: Math.max(0, policy.limit - count),
        retryAfterMs: Math.max(1, ttl > 0 ? ttl : policy.windowMs),
      };
    },
  };
}
