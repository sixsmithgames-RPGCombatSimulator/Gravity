import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { AuthenticatedIdentity, IdentityVerifier } from './identity';
import { readBearerToken } from './identity';

export type AuthenticatedRequest = Request & { identity: AuthenticatedIdentity };

export function createHttpAuthMiddleware(verifier: IdentityVerifier): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const token = readBearerToken(request.header('authorization'));
    if (!token) {
      response.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'A valid Bearer token is required for this endpoint.',
        },
      });
      return;
    }

    try {
      (request as AuthenticatedRequest).identity = await verifier.verify(token);
      next();
    } catch {
      response.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'The identity token is invalid or expired. Sign in again and retry.',
        },
      });
    }
  };
}
