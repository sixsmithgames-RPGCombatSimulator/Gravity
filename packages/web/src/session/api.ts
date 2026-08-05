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

const defaultApiOrigin = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? `http://${window.location.hostname}:3000`
  : window.location.origin;

export const SESSION_API_ORIGIN = (import.meta.env.VITE_API_URL?.trim() || defaultApiOrigin).replace(
  /\/$/,
  '',
);

export function createSessionApi(getIdentityToken: () => Promise<string>) {
  const failureTracker = new SessionFailureTracker();

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
      return await parseSessionResponse<T>(response, context, failureTracker);
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
      }, {
        workflow: 'create-session',
        stage: 'create',
        attemptedAction: 'create a private game',
        failedResult: 'The game was not created.',
        safeState: 'No lobby or saved game state changed.',
        nextAction: 'Check your connection, then choose Create private session again.',
      });
    },
    join(displayName: string, joinCode: string): Promise<SessionAccess> {
      return sessionRequest('/sessions/join', {
        method: 'POST',
        body: JSON.stringify({ displayName, joinCode }),
      }, {
        workflow: 'join-session',
        stage: 'join',
        attemptedAction: 'join the private game',
        failedResult: 'You were not added to the roster.',
        safeState: 'No lobby or saved game state changed.',
        nextAction: 'Check the join code with the host, then choose Join private session again.',
      });
    },
    get(sessionId: string): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}`, undefined, {
        workflow: 'resume-session',
        stage: 'restore',
        attemptedAction: 'restore your saved game',
        failedResult: 'The game could not be restored on this screen.',
        safeState: 'Your last server-confirmed lobby or turn state was not changed.',
        nextAction: 'Check your connection, then reload Gravity once.',
      });
    },
    ready(sessionId: string, isReady: boolean): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/ready`, {
        method: 'POST',
        body: JSON.stringify({ isReady }),
      }, {
        workflow: 'set-ready',
        stage: isReady ? 'ready' : 'not-ready',
        attemptedAction: isReady ? 'mark your player ready' : 'mark your player not ready',
        failedResult: 'Your ready status was not updated.',
        safeState: 'Your previous ready status and the lobby roster are unchanged.',
        nextAction: `Check your connection, then choose ${isReady ? 'Ready up' : 'Mark not ready'} again.`,
      });
    },
    setBotSeat(sessionId: string, seatNumber: number, isBot: boolean): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/bots`, {
        method: 'POST',
        body: JSON.stringify({ seatNumber, isBot }),
      }, {
        workflow: 'configure-bot-seat',
        stage: isBot ? 'add-bot' : 'open-seat',
        attemptedAction: isBot ? `add a bot to seat ${seatNumber}` : `reopen seat ${seatNumber} for a player`,
        failedResult: isBot ? 'The bot was not added.' : 'The seat was not reopened.',
        safeState: 'No player slots changed, and the current lobby is still safe.',
        nextAction: `Wait a moment, then choose ${isBot ? 'Add bot' : 'Open seat'} again.`,
      });
    },
    cancel(sessionId: string): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/cancel`, { method: 'POST', body: '{}' }, {
        workflow: 'cancel-session',
        stage: 'cancel',
        attemptedAction: 'cancel this game',
        failedResult: 'The game was not canceled.',
        safeState: 'The lobby remains open and its roster is unchanged.',
        nextAction: 'Check your connection, then choose Cancel game again.',
      });
    },
    start(sessionId: string): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/start`, { method: 'POST', body: '{}' }, {
        workflow: 'start-session',
        stage: 'launch',
        attemptedAction: 'launch the mission',
        failedResult: 'The mission did not start.',
        safeState: 'The ready room and its roster are unchanged.',
        nextAction: 'Review the player slots and ready indicators, then choose Launch mission again.',
      });
    },
    submitTurn(sessionId: string, payload: TurnSubmissionPayload): Promise<TurnSubmissionResult> {
      return sessionRequest(`/sessions/${sessionId}/turns`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }, {
        workflow: 'submit-turn',
        stage: 'lock-plan',
        attemptedAction: 'lock your plan for this turn',
        failedResult: 'Your plan was not committed.',
        safeState: 'Your last completed turn is safe, and the pending plan remains on this device.',
        nextAction: 'Review your connection and current game state, then choose Lock Plans again.',
      });
    },
  };
}
