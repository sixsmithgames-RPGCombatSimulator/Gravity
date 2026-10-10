import type {
  CreatedSessionAccess,
  SessionAccess,
  TurnSubmissionPayload,
  TurnSubmissionResult,
} from './types';
import {
  SessionFailureTracker,
  SessionRequestError,
  createClientSessionError,
  parseSessionResponse,
  type SessionRequestContext,
} from './errors';
import { SESSION_REQUEST_CONTEXTS, botSeatRequestContext, readyRequestContext } from './requestContexts';
import { validateCreatedSessionResponse, validateSessionAccessResponse, validateTurnSubmissionResponse } from './responseValidation';

const defaultApiOrigin = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? `http://${window.location.hostname}:3000`
  : window.location.origin;

export const SESSION_API_ORIGIN = (import.meta.env.VITE_API_URL?.trim() || defaultApiOrigin).replace(
  /\/$/,
  '',
);

/**
 * Purpose: Share consecutive recovery state with controller-only failures without double counting API errors.
 * Parameters: Fresh identity accessor and optional workflow tracker owned by the controller.
 * Returns: Authenticated session request methods with validated response envelopes.
 * Side effects: Sends requests and logs developer-only diagnostics through the returned methods.
 */
export function createSessionApi(getIdentityToken: () => Promise<string>, failureTracker = new SessionFailureTracker()) {

  /**
   * Purpose: Keep transport diagnostics available to developers without displaying them to players.
   * Parameters: Structured request error containing normalized workflow and response detail.
   * Returns: Nothing.
   * Side effects: Writes one sanitized diagnostic object to the browser console.
   */
  function logRequestFailure(error: SessionRequestError): void {
    console.error('Gravity session request failed', {
      workflow: error.workflow,
      stage: error.stage,
      code: error.code,
      status: error.status,
      occurrence: error.occurrence,
      diagnostic: error.diagnostic,
    });
  }

  /**
   * Purpose: Authenticate, send, and safely decode one authoritative session request.
   * Parameters: API path, fetch options, and player-facing workflow context.
   * Returns: The decoded typed API response.
   * Side effects: Sends an authenticated request and records consecutive success/failure state.
   */
  async function sessionRequest<T>(
    path: string,
    init: RequestInit | undefined,
    context: SessionRequestContext,
    preserveFailureSequence = false,
    validateResponse: (value: unknown) => void = validateSessionAccessResponse,
  ): Promise<T> {
    let token: string;
    try {
      token = await getIdentityToken();
    } catch (cause) {
      const error = createClientSessionError(context, 'IDENTITY_UNAVAILABLE', cause, failureTracker);
      logRequestFailure(error);
      throw error;
    }

    let response: Response;
    try {
      response = await fetch(`${SESSION_API_ORIGIN}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...init?.headers,
        },
      });
    } catch (cause) {
      const error = createClientSessionError(context, 'NETWORK_UNAVAILABLE', cause, failureTracker);
      logRequestFailure(error);
      throw error;
    }

    try {
      return await parseSessionResponse<T>(response, context, failureTracker, preserveFailureSequence, validateResponse);
    } catch (cause) {
      if (cause instanceof SessionRequestError) logRequestFailure(cause);
      throw cause;
    }
  }

  return {
    create(displayName: string, maxPlayers: number): Promise<CreatedSessionAccess> {
      return sessionRequest('/sessions', {
        method: 'POST',
        body: JSON.stringify({ displayName, maxPlayers }),
      }, SESSION_REQUEST_CONTEXTS.create, false, validateCreatedSessionResponse);
    },
    join(displayName: string, joinCode: string): Promise<SessionAccess> {
      return sessionRequest('/sessions/join', {
        method: 'POST',
        body: JSON.stringify({ displayName, joinCode }),
      }, SESSION_REQUEST_CONTEXTS.join);
    },
    get(sessionId: string, recoveryRead = false): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}`, undefined,
        recoveryRead ? SESSION_REQUEST_CONTEXTS.refresh : SESSION_REQUEST_CONTEXTS.resume, recoveryRead);
    },
    ready(sessionId: string, isReady: boolean): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/ready`, {
        method: 'POST',
        body: JSON.stringify({ isReady }),
      }, readyRequestContext(isReady));
    },
    setBotSeat(sessionId: string, seatNumber: number, isBot: boolean): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/bots`, {
        method: 'POST',
        body: JSON.stringify({ seatNumber, isBot }),
      }, botSeatRequestContext(seatNumber, isBot));
    },
    cancel(sessionId: string): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/cancel`, { method: 'POST', body: '{}' }, SESSION_REQUEST_CONTEXTS.cancel);
    },
    start(sessionId: string): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/start`, { method: 'POST', body: '{}' }, SESSION_REQUEST_CONTEXTS.start);
    },
    submitTurn(sessionId: string, payload: TurnSubmissionPayload): Promise<TurnSubmissionResult> {
      return sessionRequest(`/sessions/${sessionId}/turns`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }, SESSION_REQUEST_CONTEXTS.submit, false, validateTurnSubmissionResponse);
    },
  };
}
