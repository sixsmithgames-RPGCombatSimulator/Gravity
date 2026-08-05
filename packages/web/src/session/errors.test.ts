import { describe, expect, it } from 'vitest';

import {
  GRAVITY_SUPPORT_EMAIL,
  SessionFailureTracker,
  SessionRequestError,
  parseSessionResponse,
  type SessionRequestContext,
} from './errors';

const BOT_CONTEXT: SessionRequestContext = {
  workflow: 'configure-bot-seat',
  stage: 'add-bot',
  attemptedAction: 'add a bot to seat 2',
  failedResult: 'The bot was not added.',
  safeState: 'No player slots changed, and the current lobby is still safe.',
  nextAction: 'Wait a moment, then choose Add bot again.',
};

/**
 * Purpose: Exercise a failed response and return the structured error for player-copy assertions.
 * Parameters: A fresh response, tracker, and optional workflow context.
 * Returns: The SessionRequestError thrown by the response parser.
 * Side effects: Advances the supplied failure tracker.
 */
async function captureRequestError(
  response: Response,
  tracker: SessionFailureTracker,
  context: SessionRequestContext = BOT_CONTEXT,
): Promise<SessionRequestError> {
  try {
    await parseSessionResponse(response, context, tracker);
  } catch (cause) {
    expect(cause).toBeInstanceOf(SessionRequestError);
    return cause as SessionRequestError;
  }
  throw new Error('Expected parseSessionResponse to reject the failed response.');
}

/**
 * Purpose: Reproduce the stale Railway route response that originally exposed an HTML parser exception.
 * Parameters: None.
 * Returns: A fresh HTML 404 response for each parser attempt.
 * Side effects: None.
 */
function createHtmlNotFoundResponse(): Response {
  return new Response('<!DOCTYPE html><html><body>Cannot POST /sessions/example/bots</body></html>', {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

describe('session response errors', () => {
  it('turns an HTML route failure into complete player recovery copy without exposing diagnostics', async () => {
    const error = await captureRequestError(createHtmlNotFoundResponse(), new SessionFailureTracker());

    expect(error.playerError.message).toContain('trying to add a bot to seat 2');
    expect(error.playerError.message).toContain('The bot was not added.');
    expect(error.playerError.message).toContain('still finishing an update');
    expect(error.playerError.message).toContain('No player slots changed');
    expect(error.playerError.message).toContain('choose Add bot again');
    expect(error.playerError.message).not.toMatch(/DOCTYPE|JSON|404|Cannot POST|\/sessions\//i);
    expect(error.playerError.supportCode).toBeNull();
    expect(error.diagnostic).toContain('status=404');
    expect(error.diagnostic).toContain('DOCTYPE');
  });

  it('stops the repeated recovery loop on the second consecutive failure and supplies support details', async () => {
    const tracker = new SessionFailureTracker();
    await captureRequestError(createHtmlNotFoundResponse(), tracker);
    const secondError = await captureRequestError(createHtmlNotFoundResponse(), tracker);

    expect(secondError.occurrence).toBe(2);
    expect(secondError.playerError.message).toContain('same snag twice');
    expect(secondError.playerError.message).toContain('No player slots changed');
    expect(secondError.playerError.message).toContain(GRAVITY_SUPPORT_EMAIL);
    expect(secondError.playerError.supportCode).toMatch(/^GRV-[A-F0-9]{8}$/);
    expect(secondError.playerError.message).not.toMatch(/DOCTYPE|JSON|404|Cannot POST|\/sessions\//i);
  });

  it('resets the consecutive-failure boundary after a successful response', async () => {
    const tracker = new SessionFailureTracker();
    await captureRequestError(createHtmlNotFoundResponse(), tracker);
    await expect(
      parseSessionResponse<{ ok: boolean }>(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
        BOT_CONTEXT,
        tracker,
      ),
    ).resolves.toEqual({ ok: true });
    const nextError = await captureRequestError(createHtmlNotFoundResponse(), tracker);

    expect(nextError.occurrence).toBe(1);
    expect(nextError.playerError.supportCode).toBeNull();
  });

  it('resets the consecutive-failure boundary when a different normalized failure occurs', async () => {
    const tracker = new SessionFailureTracker();
    await captureRequestError(createHtmlNotFoundResponse(), tracker);
    await captureRequestError(
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Internal limiter detail.' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
      tracker,
    );
    const nextRouteError = await captureRequestError(createHtmlNotFoundResponse(), tracker);

    expect(nextRouteError.occurrence).toBe(1);
    expect(nextRouteError.playerError.supportCode).toBeNull();
  });

  it('maps a structured server reason without displaying the raw server message', async () => {
    const error = await captureRequestError(
      new Response(JSON.stringify({ error: { code: 'NOT_HOST', message: 'Sensitive authorization internals.' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
      new SessionFailureTracker(),
    );

    expect(error.playerError.message).toContain('Only the game host can use that control.');
    expect(error.playerError.message).not.toContain('Sensitive authorization internals.');
  });
});
