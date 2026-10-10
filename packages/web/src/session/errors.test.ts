import { describe, expect, it } from 'vitest';

import {
  GRAVITY_SUPPORT_EMAIL,
  SessionFailureTracker,
  SessionRequestError,
  createClientSessionError,
  parseSessionResponse,
  toSessionUiError,
  type SessionRequestContext,
} from './errors';
import { SESSION_REQUEST_CONTEXTS, botSeatRequestContext, readyRequestContext } from './requestContexts';
import { validateSessionAccessResponse } from './responseValidation';

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
  it.each([SESSION_REQUEST_CONTEXTS.cancel, SESSION_REQUEST_CONTEXTS.start, readyRequestContext(true), botSeatRequestContext(2, true)])(
    'requires a current authoritative lobby read after an unknown mutation outcome', (context) => {
      const error = createClientSessionError(context, 'NETWORK_UNAVAILABLE', new Error('private send failure'), new SessionFailureTracker());
      expect(error.playerError.message).toContain('could not confirm whether');
      expect(error.playerError.message).toContain('last confirmed');
      expect(error.playerError.message).toContain('Choose Refresh lobby');
      expect(error.playerError.message).not.toMatch(/unchanged|not added|did not start|not canceled|No player slots changed|private send/);
    },
  );

  it('stops uncertain non-idempotent creation immediately with a support code', () => {
    const error = createClientSessionError(SESSION_REQUEST_CONTEXTS.create, 'NETWORK_UNAVAILABLE', new Error('lost creation reply'), new SessionFailureTracker());
    expect(error.playerError.message).toContain('could not confirm whether the private game was created');
    expect(error.playerError.message).toContain('do not create another game yet');
    expect(error.playerError.message).toContain(GRAVITY_SUPPORT_EMAIL);
    expect(error.playerError.supportCode).toMatch(/^GRV-[A-F0-9]{8}$/);
    expect(error.playerError.message).not.toMatch(/not created|No lobby|Create private session again|lost creation/);
  });

  it('does not reset repeated-failure tracking for valid JSON with an unusable access envelope', async () => {
    const tracker = new SessionFailureTracker();
    const attempt = () => parseSessionResponse(new Response('{}', { status: 200 }),
      SESSION_REQUEST_CONTEXTS.start, tracker, false, validateSessionAccessResponse);
    await expect(attempt()).rejects.toMatchObject({ occurrence: 1, code: 'INVALID_RESPONSE', isUnconfirmed: true });
    await expect(attempt()).rejects.toMatchObject({ occurrence: 2, playerError: { message: expect.stringContaining(GRAVITY_SUPPORT_EMAIL) } });
  });

  it('keeps the failed mutation sequence through a successful corrective read', async () => {
    const tracker = new SessionFailureTracker();
    createClientSessionError(SESSION_REQUEST_CONTEXTS.start, 'NETWORK_UNAVAILABLE', new Error('lost launch reply'), tracker);
    await parseSessionResponse(new Response('{"ok":true}', { status: 200 }), SESSION_REQUEST_CONTEXTS.refresh, tracker, true);
    const second = createClientSessionError(SESSION_REQUEST_CONTEXTS.start, 'NETWORK_UNAVAILABLE', new Error('lost launch reply'), tracker);
    expect(second.occurrence).toBe(2);
    expect(second.playerError.message).not.toContain('Choose Refresh lobby');
  });

  it('does not claim an uncertain plan was rejected and offers a draft-preserving retry', () => {
    const error = createClientSessionError(SESSION_REQUEST_CONTEXTS.submit, 'NETWORK_UNAVAILABLE',
      new Error('private fetch transport failure'), new SessionFailureTracker());
    expect(error.playerError.message).toContain('trying to lock your plan for this turn');
    expect(error.playerError.message).toContain('could not confirm whether your original plan was locked');
    expect(error.playerError.message).toContain('last completed turn is safe');
    expect(error.playerError.message).toContain('Keep this screen open');
    expect(error.playerError.message).toContain('choose Lock Plans again to check your original plan');
    expect(error.playerError.message).not.toMatch(/not committed|not locked|Reload|private fetch|transport|JSON/);
  });

  it.each([
    new Response('<!DOCTYPE html><html>proxy private details</html>', { status: 503 }),
    new Response('<!DOCTYPE html><html>unusable success</html>', { status: 200 }),
  ])('treats an unavailable or unusable turn reply as an unknown write outcome', async (response) => {
    const error = await captureRequestError(response, new SessionFailureTracker(), SESSION_REQUEST_CONTEXTS.submit);
    expect(error.playerError.message).toContain('could not confirm whether your original plan was locked');
    expect(error.playerError.message).not.toMatch(/not committed|not locked|Reload|DOCTYPE|503|proxy/);
  });

  it('truthfully identifies a confirmed invalid-plan rejection and a pre-send identity failure', async () => {
    const rejection = await captureRequestError(new Response(JSON.stringify({ error: { code: 'INVALID_ACTION' } }),
      { status: 400 }), new SessionFailureTracker(), SESSION_REQUEST_CONTEXTS.submit);
    expect(rejection.playerError.message).toContain('Your plan was not locked.');
    expect(rejection.playerError.message).toContain('Review your planned actions');
    const identity = createClientSessionError(SESSION_REQUEST_CONTEXTS.submit, 'IDENTITY_UNAVAILABLE',
      new Error('private credential details'), new SessionFailureTracker());
    expect(identity.playerError.message).toContain('Your plan was not locked.');
    expect(identity.playerError.message).not.toContain('could not confirm whether');
  });

  it('tracks raw failures without double counting structured failures and resets on success', () => {
    const tracker = new SessionFailureTracker();
    const first = toSessionUiError(new Error('raw internal exception'), SESSION_REQUEST_CONTEXTS.submit, tracker);
    expect(first.supportCode).toBeNull();
    const second = toSessionUiError(new Error('different raw diagnostic, same normalized failure'), SESSION_REQUEST_CONTEXTS.submit, tracker);
    expect(second.message).toContain('same snag twice');
    expect(second.message).toContain('could not confirm whether your original plan was locked');
    expect(second.message).toContain(GRAVITY_SUPPORT_EMAIL);
    expect(second.message).not.toMatch(/raw internal|not committed|not locked|Reload|choose Lock Plans again/);
    expect(second.supportCode).toMatch(/^GRV-[A-F0-9]{8}$/);
    tracker.recordSuccess();
    const structured = createClientSessionError(SESSION_REQUEST_CONTEXTS.submit, 'NETWORK_UNAVAILABLE', new Error('lost reply'), tracker);
    expect(toSessionUiError(structured, SESSION_REQUEST_CONTEXTS.submit, tracker)).toBe(structured.playerError);
    expect(structured.occurrence).toBe(1);
    expect(createClientSessionError(SESSION_REQUEST_CONTEXTS.submit, 'NETWORK_UNAVAILABLE', new Error('lost reply'), tracker).occurrence).toBe(2);
  });

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
