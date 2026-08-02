import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';

import { createHttpRateLimitMiddleware } from './abuse/httpRateLimit';
import type { RateLimiter, RateLimitPolicy } from './abuse/rateLimiter';
import type { IdentityVerifier } from './auth/identity';
import { createSessionRouter } from './sessions/sessionRouter';
import type { SessionService } from './sessions/sessionService';

export type ReadinessDependencies = {
  checkDatabase: () => Promise<unknown>;
  checkRedis: () => Promise<unknown>;
};

export type CreateAppOptions = {
  corsOrigin: string;
  readiness: ReadinessDependencies;
  sessions?: {
    service: SessionService;
    identityVerifier: IdentityVerifier;
    rateLimiter?: RateLimiter;
    edgeRateLimitPolicy?: RateLimitPolicy;
  };
};

type DependencyStatus = 'ok' | 'unavailable';

async function getDependencyStatus(check: () => Promise<unknown>): Promise<DependencyStatus> {
  try {
    await check();
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

/**
 * Create the HTTP application without binding a port.
 * Dependency checks are injected so readiness behavior can be tested without live infrastructure.
 */
export function createApp(options: CreateAppOptions): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: options.corsOrigin,
      credentials: true,
    }),
  );

  if (options.sessions?.rateLimiter) {
    app.use(
      '/sessions',
      createHttpRateLimitMiddleware({
        limiter: options.sessions.rateLimiter,
        policy: options.sessions.edgeRateLimitPolicy ?? { limit: 100, windowMs: 15 * 60_000 },
        scope: 'http-edge',
        identify: (request) => request.ip || request.socket.remoteAddress || 'unknown',
      }),
    );
  }

  app.use(express.json({ limit: '1mb' }));

  app.get('/health/live', (_request, response) => {
    response.status(200).json({ ok: true });
  });

  const readinessHandler: RequestHandler = async (_request, response) => {
    const [database, redis] = await Promise.all([
      getDependencyStatus(options.readiness.checkDatabase),
      getDependencyStatus(options.readiness.checkRedis),
    ]);
    const ok = database === 'ok' && redis === 'ok';

    response.status(ok ? 200 : 503).json({
      ok,
      checks: {
        database,
        redis,
      },
    });
  };

  app.get('/health', readinessHandler);
  app.get('/health/ready', readinessHandler);

  if (options.sessions) {
    app.use('/sessions', createSessionRouter(options.sessions));
  }

  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The server could not complete the request. Retry or contact support with the time of failure.',
      },
    });
  });

  return app;
}
