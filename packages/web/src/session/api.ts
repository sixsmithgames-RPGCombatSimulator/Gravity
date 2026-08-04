import type {
  CreatedSessionAccess,
  SessionAccess,
  SessionApiError,
  TurnSubmissionPayload,
  TurnSubmissionResult,
} from './types';

const defaultApiOrigin = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? `http://${window.location.hostname}:3000`
  : window.location.origin;

export const SESSION_API_ORIGIN = (import.meta.env.VITE_API_URL?.trim() || defaultApiOrigin).replace(
  /\/$/,
  '',
);

export function createSessionApi(getIdentityToken: () => Promise<string>) {
  async function sessionRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getIdentityToken();
    const response = await fetch(`${SESSION_API_ORIGIN}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
    const body = (await response.json()) as { error?: { code?: string; message?: string } } & T;
    if (!response.ok) {
      const error = new Error(body.error?.message || 'The session request failed.') as SessionApiError;
      error.code = body.error?.code || 'UNKNOWN_ERROR';
      error.status = response.status;
      throw error;
    }
    return body;
  }

  return {
    create(displayName: string, maxPlayers: number): Promise<CreatedSessionAccess> {
      return sessionRequest('/sessions', {
        method: 'POST',
        body: JSON.stringify({ displayName, maxPlayers }),
      });
    },
    join(displayName: string, joinCode: string): Promise<SessionAccess> {
      return sessionRequest('/sessions/join', {
        method: 'POST',
        body: JSON.stringify({ displayName, joinCode }),
      });
    },
    get(sessionId: string): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}`);
    },
    ready(sessionId: string, isReady: boolean): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/ready`, {
        method: 'POST',
        body: JSON.stringify({ isReady }),
      });
    },
    setBotSeat(sessionId: string, seatNumber: number, isBot: boolean): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/bots`, {
        method: 'POST',
        body: JSON.stringify({ seatNumber, isBot }),
      });
    },
    cancel(sessionId: string): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/cancel`, { method: 'POST', body: '{}' });
    },
    start(sessionId: string): Promise<SessionAccess> {
      return sessionRequest(`/sessions/${sessionId}/start`, { method: 'POST', body: '{}' });
    },
    submitTurn(sessionId: string, payload: TurnSubmissionPayload): Promise<TurnSubmissionResult> {
      return sessionRequest(`/sessions/${sessionId}/turns`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
  };
}
