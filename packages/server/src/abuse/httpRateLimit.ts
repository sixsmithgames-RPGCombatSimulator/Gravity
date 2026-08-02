import type { Request, RequestHandler } from 'express';

import { createRateLimitKey, type RateLimiter, type RateLimitPolicy } from './rateLimiter';

type HttpRateLimitOptions = {
  limiter: RateLimiter;
  policy: RateLimitPolicy;
  scope: string;
  identify: (request: Request) => string;
};

export function createHttpRateLimitMiddleware(options: HttpRateLimitOptions): RequestHandler {
  return async (request, response, next): Promise<void> => {
    try {
      const decision = await options.limiter.consume(
        createRateLimitKey(options.scope, options.identify(request)),
        options.policy,
      );
      response.setHeader('RateLimit-Limit', String(options.policy.limit));
      response.setHeader('RateLimit-Remaining', String(decision.remaining));
      if (decision.allowed) {
        next();
        return;
      }

      const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
      response.setHeader('Retry-After', String(retryAfterSeconds));
      response.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Retry in ${retryAfterSeconds} seconds.`,
        },
      });
    } catch {
      response.status(503).json({
        error: {
          code: 'RATE_LIMIT_UNAVAILABLE',
          message: 'Request protection is temporarily unavailable. Retry shortly.',
        },
      });
    }
  };
}
