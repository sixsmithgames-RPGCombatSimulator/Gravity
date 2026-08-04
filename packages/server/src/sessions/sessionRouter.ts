import { Router, type NextFunction, type Request, type Response } from 'express';
import { z, type ZodTypeAny } from 'zod';

import { createHttpAuthMiddleware, type AuthenticatedRequest } from '../auth/httpAuth';
import type { IdentityVerifier } from '../auth/identity';
import { createHttpRateLimitMiddleware } from '../abuse/httpRateLimit';
import type { RateLimiter, RateLimitPolicy } from '../abuse/rateLimiter';
import { SessionError } from './errors';
import { SessionService } from './sessionService';

const sessionIdSchema = z.string().uuid();
const displayNameSchema = z.string().trim().min(1).max(50).optional();
const playerActionSchema = z
  .object({
    playerId: z.string().min(1).max(100),
    crewId: z.string().min(1).max(150),
    type: z.enum([
      'restore',
      'route',
      'repair',
      'revive',
      'scan',
      'acquire',
      'attack',
      'launch',
      'maneuver',
      'retaliate',
      'assemble',
      'integrate',
    ]),
    target: z
      .object({
        playerId: z.string().optional(),
        objectId: z.string().optional(),
        position: z.object({ ring: z.number().int(), space: z.number().int() }).optional(),
        section: z.string().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

function parse<TSchema extends ZodTypeAny>(schema: TSchema, value: unknown): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new SessionError(
      'INVALID_REQUEST',
      result.error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; '),
      400,
    );
  }
  return result.data;
}

function asyncRoute(
  handler: (request: AuthenticatedRequest, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    handler(request as AuthenticatedRequest, response).catch(next);
  };
}

export function createSessionRouter(options: {
  service: SessionService;
  identityVerifier: IdentityVerifier;
  rateLimiter?: RateLimiter;
}): Router {
  const router = Router();
  router.use(createHttpAuthMiddleware(options.identityVerifier));

  const identityLimit = (scope: string, policy: RateLimitPolicy) =>
    options.rateLimiter
      ? createHttpRateLimitMiddleware({
          limiter: options.rateLimiter,
          policy,
          scope,
          identify: (request) => (request as AuthenticatedRequest).identity.subject,
        })
      : (_request: Request, _response: Response, next: NextFunction) => next();

  router.use(identityLimit('session-all', { limit: 120, windowMs: 60_000 }));

  router.post(
    '/',
    identityLimit('session-create', { limit: 10, windowMs: 5 * 60_000 }),
    asyncRoute(async (request, response) => {
      const body = parse(
        z.object({
          displayName: displayNameSchema,
          maxPlayers: z.number().int().min(2).max(6).default(4),
        }),
        request.body,
      );
      const result = await options.service.createSession({ identity: request.identity, ...body });
      response.status(201).json(result);
    }),
  );

  router.post(
    '/join',
    identityLimit('session-join', { limit: 10, windowMs: 5 * 60_000 }),
    asyncRoute(async (request, response) => {
      const body = parse(
        z.object({
          joinCode: z.string().min(1).max(32),
          displayName: displayNameSchema,
        }),
        request.body,
      );
      response.status(200).json(await options.service.joinSession({ identity: request.identity, ...body }));
    }),
  );

  router.get(
    '/:sessionId',
    asyncRoute(async (request, response) => {
      const sessionId = parse(sessionIdSchema, request.params.sessionId);
      response.status(200).json(await options.service.getSession(request.identity, sessionId));
    }),
  );

  router.post(
    '/:sessionId/ready',
    identityLimit('session-ready', { limit: 30, windowMs: 60_000 }),
    asyncRoute(async (request, response) => {
      const sessionId = parse(sessionIdSchema, request.params.sessionId);
      const body = parse(z.object({ isReady: z.boolean() }), request.body);
      response.status(200).json(
        await options.service.setReady({ identity: request.identity, sessionId, isReady: body.isReady }),
      );
    }),
  );

  router.post(
    '/:sessionId/bots',
    identityLimit('session-bots', { limit: 30, windowMs: 60_000 }),
    asyncRoute(async (request, response) => {
      const sessionId = parse(sessionIdSchema, request.params.sessionId);
      const body = parse(
        z.object({
          seatNumber: z.number().int().min(2).max(6),
          isBot: z.boolean(),
        }),
        request.body,
      );
      response.status(200).json(
        await options.service.setBotSeat({ identity: request.identity, sessionId, ...body }),
      );
    }),
  );

  router.post(
    '/:sessionId/cancel',
    identityLimit('session-cancel', { limit: 10, windowMs: 60_000 }),
    asyncRoute(async (request, response) => {
      const sessionId = parse(sessionIdSchema, request.params.sessionId);
      response.status(200).json(await options.service.cancelSession(request.identity, sessionId));
    }),
  );

  router.post(
    '/:sessionId/start',
    identityLimit('session-start', { limit: 10, windowMs: 60_000 }),
    asyncRoute(async (request, response) => {
      const sessionId = parse(sessionIdSchema, request.params.sessionId);
      response.status(200).json(await options.service.startSession(request.identity, sessionId));
    }),
  );

  router.post(
    '/:sessionId/turns',
    identityLimit('session-turn', { limit: 30, windowMs: 60_000 }),
    asyncRoute(async (request, response) => {
      const sessionId = parse(sessionIdSchema, request.params.sessionId);
      const body = parse(
        z.object({
          submissionId: z.string().uuid(),
          expectedStateVersion: z.number().int().nonnegative(),
          actions: z.array(playerActionSchema).max(20),
        }),
        request.body,
      );
      const result = await options.service.submitTurn({
        identity: request.identity,
        sessionId,
        ...body,
      });
      response.status(result.status === 'pending' ? 202 : 200).json(result);
    }),
  );

  router.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (!(error instanceof SessionError)) {
      next(error);
      return;
    }
    response.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
  });

  return router;
}
