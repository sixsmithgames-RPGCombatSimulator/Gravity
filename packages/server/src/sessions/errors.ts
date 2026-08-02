export type SessionErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'NOT_A_MEMBER'
  | 'NOT_HOST'
  | 'SESSION_FULL'
  | 'NOT_READY'
  | 'STALE_STATE'
  | 'DUPLICATE_SUBMISSION'
  | 'INVALID_ACTION'
  | 'CONFLICT';

export class SessionError extends Error {
  constructor(
    public readonly code: SessionErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}
