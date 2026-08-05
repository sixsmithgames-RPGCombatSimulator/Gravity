import type { SessionUiError } from './types';

export const GRAVITY_SUPPORT_EMAIL = 'info@sixsmithgames.com';

export type SessionRequestContext = {
  workflow: string;
  stage: string;
  attemptedAction: string;
  failedResult: string;
  safeState: string;
  nextAction: string;
};

type SessionFailureDetails = {
  code: string;
  status: number;
  diagnostic: string;
};

type SessionErrorEnvelope = {
  error?: {
    code?: unknown;
    message?: unknown;
  };
};

const PLAYER_REASON_BY_CODE: Record<string, string> = {
  IDENTITY_UNAVAILABLE: 'Gravity could not confirm your sign-in for this request.',
  NETWORK_UNAVAILABLE: 'Gravity could not reach the game service.',
  SERVICE_UPDATING: 'The game service is still finishing an update for this control.',
  INVALID_RESPONSE: 'The game service did not return a usable result.',
  UNAUTHENTICATED: 'Your sign-in session needs to be refreshed.',
  INVALID_REQUEST: 'One of the entered choices was not accepted.',
  NOT_FOUND: 'That game is no longer available.',
  NOT_A_MEMBER: 'This signed-in account no longer has a player seat in that game.',
  NOT_HOST: 'Only the game host can use that control.',
  SESSION_FULL: 'Every player seat in that game is already filled.',
  NOT_READY: 'The configured roster is not full and ready yet.',
  STALE_STATE: 'Another player updated the game first, so your screen needs the latest state.',
  DUPLICATE_SUBMISSION: 'That plan was already sent for this turn.',
  INVALID_ACTION: 'At least one planned action is no longer legal in the current game state.',
  CONFLICT: 'The lobby or turn changed before Gravity could finish this request.',
  RATE_LIMITED: 'Too many requests reached the game service in a short time.',
  INTERNAL_ERROR: 'The game service could not finish the request safely.',
  SERVICE_UNAVAILABLE: 'The game service is temporarily unavailable.',
  UNKNOWN_ERROR: 'The game service did not provide a usable reason.',
};

/**
 * Purpose: Track only consecutive equivalent failures so a successful or different request breaks the escalation chain.
 * Parameters: Failure signatures supplied through recordFailure.
 * Returns: The one-based consecutive occurrence count for each recorded failure.
 * Side effects: Retains the last signature and count in this tracker instance.
 */
export class SessionFailureTracker {
  private previousSignature: string | null = null;
  private consecutiveCount = 0;

  recordFailure(signature: string): number {
    if (signature === this.previousSignature) this.consecutiveCount += 1;
    else {
      this.previousSignature = signature;
      this.consecutiveCount = 1;
    }
    return this.consecutiveCount;
  }

  recordSuccess(): void {
    this.previousSignature = null;
    this.consecutiveCount = 0;
  }
}

/**
 * Purpose: Carry player-safe recovery copy separately from developer-only request diagnostics.
 * Parameters: Player UI error, normalized code/status, workflow metadata, occurrence, and diagnostic detail.
 * Returns: An Error instance suitable for controller type guards and diagnostic logging.
 * Side effects: None.
 */
export class SessionRequestError extends Error {
  constructor(
    public readonly playerError: SessionUiError,
    public readonly code: string,
    public readonly status: number,
    public readonly workflow: string,
    public readonly stage: string,
    public readonly occurrence: number,
    public readonly diagnostic: string,
  ) {
    super(playerError.message);
    this.name = 'SessionRequestError';
  }
}

/**
 * Purpose: Produce a short deterministic code that support can correlate without exposing a route, payload, or exception.
 * Parameters: Normalized failure signature containing workflow, stage, code, and status.
 * Returns: A copyable GRV-prefixed support code.
 * Side effects: None.
 */
function createSupportCode(signature: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `GRV-${(hash >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

/**
 * Purpose: Map normalized server/transport failures to player language without leaking raw backend messages.
 * Parameters: Normalized failure code.
 * Returns: A complete sentence explaining the known cause or the absence of a usable cause.
 * Side effects: None.
 */
function getPlayerReason(code: string): string {
  return PLAYER_REASON_BY_CODE[code] ?? PLAYER_REASON_BY_CODE.UNKNOWN_ERROR;
}

/**
 * Purpose: Build either the normal first-failure recovery or the required second-consecutive-failure support escalation.
 * Parameters: Request context, normalized failure details, and the workflow-scoped failure tracker.
 * Returns: A structured SessionRequestError with player copy and developer diagnostics kept separate.
 * Side effects: Advances the consecutive-failure tracker.
 */
export function createSessionRequestError(
  context: SessionRequestContext,
  details: SessionFailureDetails,
  tracker: SessionFailureTracker,
): SessionRequestError {
  const signature = `${context.workflow}:${context.stage}:${details.code}:${details.status}`;
  const occurrence = tracker.recordFailure(signature);
  const supportCode = createSupportCode(signature);
  const playerError: SessionUiError = occurrence >= 2
    ? {
        message:
          `Sorry—Gravity hit the same snag twice while trying to ${context.attemptedAction}. ` +
          `${context.safeState} Please email ${GRAVITY_SUPPORT_EMAIL} and include the support code below so we can get your game moving again.`,
        supportCode,
      }
    : {
        message:
          `Gravity was trying to ${context.attemptedAction}. ${context.failedResult} ` +
          `${getPlayerReason(details.code)} ${context.safeState} ${context.nextAction}`,
        supportCode: null,
      };

  return new SessionRequestError(
    playerError,
    details.code,
    details.status,
    context.workflow,
    context.stage,
    occurrence,
    details.diagnostic,
  );
}

/**
 * Purpose: Read a server response exactly once, accepting valid JSON and converting HTML/text/proxy failures to safe recovery copy.
 * Parameters: Fetch Response, player workflow context, and consecutive-failure tracker.
 * Returns: The decoded JSON result for successful API responses.
 * Side effects: Consumes the response body and resets or advances the supplied failure tracker.
 */
export async function parseSessionResponse<T>(
  response: Response,
  context: SessionRequestContext,
  tracker: SessionFailureTracker,
): Promise<T> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const rawBody = await response.text();
  let parsedBody: unknown = null;
  let parseFailed = false;

  if (rawBody.trim()) {
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      parseFailed = true;
    }
  }

  if (response.ok && !parseFailed && parsedBody !== null) {
    tracker.recordSuccess();
    return parsedBody as T;
  }

  const envelope = !parseFailed && parsedBody && typeof parsedBody === 'object'
    ? parsedBody as SessionErrorEnvelope
    : null;
  const serverCode = typeof envelope?.error?.code === 'string' ? envelope.error.code : null;
  const serverMessage = typeof envelope?.error?.message === 'string' ? envelope.error.message : null;
  const code = serverCode ?? (
    response.status === 404 && (parseFailed || contentType.includes('text/html'))
      ? 'SERVICE_UPDATING'
      : response.status === 401
        ? 'UNAUTHENTICATED'
        : response.status === 429
          ? 'RATE_LIMITED'
          : response.status >= 500
            ? 'SERVICE_UNAVAILABLE'
            : response.ok
              ? 'INVALID_RESPONSE'
              : 'UNKNOWN_ERROR'
  );
  const responseExcerpt = rawBody.replace(/\s+/g, ' ').slice(0, 160);
  throw createSessionRequestError(
    context,
    {
      code,
      status: response.status,
      diagnostic:
        `status=${response.status}; contentType=${contentType || 'missing'}; ` +
        `serverCode=${serverCode ?? 'missing'}; serverMessage=${serverMessage ?? 'missing'}; ` +
        `responseExcerpt=${responseExcerpt || 'empty'}`,
    },
    tracker,
  );
}

/**
 * Purpose: Convert authentication or network exceptions into the same player-safe API error contract.
 * Parameters: Request context, normalized client failure code, caught value, and consecutive-failure tracker.
 * Returns: A structured SessionRequestError.
 * Side effects: Advances the consecutive-failure tracker.
 */
export function createClientSessionError(
  context: SessionRequestContext,
  code: 'IDENTITY_UNAVAILABLE' | 'NETWORK_UNAVAILABLE',
  cause: unknown,
  tracker: SessionFailureTracker,
): SessionRequestError {
  const diagnostic = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return createSessionRequestError(context, { code, status: 0, diagnostic }, tracker);
}

/**
 * Purpose: Project a caught request error into the UI shape without exposing diagnostics.
 * Parameters: Unknown caught value and compliant fallback copy for non-session failures.
 * Returns: A player-safe UI error.
 * Side effects: None.
 */
export function toSessionUiError(cause: unknown, fallbackMessage: string): SessionUiError {
  if (cause instanceof SessionRequestError) return cause.playerError;
  return { message: fallbackMessage, supportCode: null };
}

/**
 * Purpose: Identify resume failures that prove a saved session reference can no longer succeed.
 * Parameters: Unknown caught request error.
 * Returns: Whether local resume data should be removed.
 * Side effects: None.
 */
export function isTerminalSessionResumeError(cause: unknown): boolean {
  return cause instanceof SessionRequestError && ['NOT_FOUND', 'NOT_A_MEMBER'].includes(cause.code);
}
