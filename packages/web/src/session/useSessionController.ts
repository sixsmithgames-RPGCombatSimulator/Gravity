import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { PlayerAction } from '@gravity/core';

import { createSessionApi, SESSION_API_ORIGIN } from './api';
import {
  SessionFailureTracker,
  SessionRequestError,
  createClientSessionError,
  isTerminalSessionResumeError,
  toSessionUiError,
  type SessionRequestContext,
} from './errors';
import type { SessionAccess, SessionSummary, SessionUiError, TurnSubmissionResult } from './types';

const STORAGE_KEY = 'gravity:beta-session:v1';

type StoredSession = { version: 1; sessionId: string; joinCode?: string };

const LIVE_CONNECTION_CONTEXT: SessionRequestContext = {
  workflow: 'live-session',
  stage: 'connect',
  attemptedAction: 'reconnect live game updates',
  failedResult: 'Live lobby and turn updates did not reconnect.',
  safeState: 'Your last server-confirmed lobby or turn state is safe.',
  nextAction: 'Check your connection, then reload Gravity once.',
};

const LIVE_IDENTITY_CONTEXT: SessionRequestContext = {
  workflow: 'live-session',
  stage: 'authenticate',
  attemptedAction: 'confirm your sign-in for live game updates',
  failedResult: 'Live lobby and turn updates did not start.',
  safeState: 'Your last server-confirmed lobby or turn state is safe.',
  nextAction: 'Refresh your sign-in, then reload Gravity once.',
};

const UNKNOWN_SESSION_RECOVERY =
  'Gravity was trying to update this game. The update did not finish because the game service did not provide a usable reason. ' +
  'Your last server-confirmed lobby or turn state is safe. Reload Gravity once, then try the control again.';

const UNKNOWN_RESUME_RECOVERY =
  'Gravity was trying to restore your saved game. The game could not be restored because the game service did not provide a usable reason. ' +
  'Your last server-confirmed lobby or turn state was not changed. Check your connection, then reload Gravity once.';

const UNKNOWN_TURN_RECOVERY =
  'Gravity was trying to lock your plan for this turn. Your plan was not committed because the game service did not provide a usable reason. ' +
  'Your last completed turn is safe, and the pending plan remains on this device. Reload Gravity once, then choose Lock Plans again.';

function readStoredSession(): StoredSession | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as {
      version?: unknown;
      sessionId?: unknown;
      joinCode?: unknown;
    } | null;
    return stored?.version === 1 && typeof stored.sessionId === 'string'
      ? {
          version: 1,
          sessionId: stored.sessionId,
          ...(typeof stored.joinCode === 'string' ? { joinCode: stored.joinCode } : {}),
        }
      : null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function storeSessionId(sessionId: string, joinCode?: string | null): void {
  const current = readStoredSession();
  const nextCode = joinCode === undefined && current?.sessionId === sessionId ? current.joinCode : joinCode;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, sessionId, ...(nextCode ? { joinCode: nextCode } : {}) }),
  );
}

/**
 * Purpose: Remove durable resume data when a lobby is canceled or the current player loses its seat.
 * Parameters: None.
 * Returns: Nothing.
 * Side effects: Deletes the versioned session pointer from localStorage.
 */
function clearStoredSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Purpose: Log live-update diagnostics without leaking socket or authentication exception text into player copy.
 * Parameters: Structured live-session request error.
 * Returns: Nothing.
 * Side effects: Writes one diagnostic object to the developer console.
 */
function logLiveSessionFailure(error: SessionRequestError): void {
  console.error('Gravity live session connection failed', {
    workflow: error.workflow,
    stage: error.stage,
    code: error.code,
    occurrence: error.occurrence,
    diagnostic: error.diagnostic,
  });
}

export function useSessionController(getIdentityToken: () => Promise<string>) {
  const sessionApi = useMemo(() => createSessionApi(getIdentityToken), [getIdentityToken]);
  const liveFailureTracker = useMemo(() => new SessionFailureTracker(), []);
  const [access, setAccess] = useState<SessionAccess | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(() => readStoredSession()?.joinCode ?? null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<SessionUiError | null>(null);
  const [turnStatus, setTurnStatus] = useState<string | null>(null);
  const pendingSubmission = useRef<{
    submissionId: string;
    expectedStateVersion: number;
    actions: PlayerAction[];
  } | null>(null);
  const isLiveErrorVisible = useRef(false);

  const resetSession = useCallback((message: string) => {
    clearStoredSession();
    pendingSubmission.current = null;
    setAccess(null);
    setJoinCode(null);
    setTurnStatus(null);
    isLiveErrorVisible.current = false;
    setError({ message, supportCode: null });
  }, []);

  const acceptAccess = useCallback((nextAccess: SessionAccess) => {
    if (nextAccess.session.status === 'abandoned') {
      resetSession(
        'Gravity was trying to restore your game. The game was canceled, so it cannot be opened. ' +
        'The canceled lobby is closed, and no turn state changed. Create or join another mission.',
      );
      return;
    }
    setAccess(nextAccess);
    storeSessionId(nextAccess.session.id);
    setTurnStatus(
      nextAccess.session.pendingPlayerIds.includes(nextAccess.participant.playerId)
        ? 'Plan locked. Waiting for the remaining active players.'
        : null,
    );
  }, [resetSession]);

  useEffect(() => {
    const storedSession = readStoredSession();
    if (!storedSession) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    sessionApi
      .get(storedSession.sessionId)
      .then((result) => {
        if (!cancelled) acceptAccess(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (isTerminalSessionResumeError(cause)) {
          clearStoredSession();
          setJoinCode(null);
        }
        isLiveErrorVisible.current = false;
        setError(toSessionUiError(cause, UNKNOWN_RESUME_RECOVERY));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [acceptAccess, sessionApi]);

  useEffect(() => {
    if (!access) return;
    const participantPlayerId = access.participant.playerId;
    let disposed = false;
    let socket: ReturnType<typeof io> | null = null;

    getIdentityToken()
      .then((token) => {
        if (disposed) return;
        socket = io(SESSION_API_ORIGIN, { auth: { token } });
        socket.on('connect', () => {
          liveFailureTracker.recordSuccess();
          if (isLiveErrorVisible.current) {
            isLiveErrorVisible.current = false;
            setError(null);
          }
          socket?.emit('join_session', { sessionId: access.session.id });
        });
        socket.on('session_updated', (session: SessionSummary) => {
          if (session.status === 'abandoned') {
            resetSession(
              'Gravity was trying to keep this lobby in sync. The lobby closed because the host canceled this game. ' +
              'No additional lobby or turn changes were applied on this device. Create or join another mission.',
            );
            return;
          }
          if (!session.participants.some((member) => member.playerId === participantPlayerId)) {
            resetSession(
              'Gravity was trying to keep your player seat connected. Your seat is no longer available because the host switched it to a bot. ' +
              'Your previous server-confirmed game state is safe on the server. Join another mission to keep playing.',
            );
            return;
          }
          setTurnStatus(
            session.pendingPlayerIds.includes(participantPlayerId)
              ? 'Plan locked. Waiting for the remaining active players.'
              : null,
          );
          setAccess((current) => (current ? { ...current, session } : current));
        });
        socket.on('state_snapshot', (snapshot: SessionSummary['latestSnapshot']) => {
          if (!snapshot) return;
          setAccess((current) => {
            if (!current || (current.session.latestSnapshot?.stateVersion ?? -1) >= snapshot.stateVersion) {
              return current;
            }
            return {
              ...current,
              session: {
                ...current.session,
                status: 'active',
                stateVersion: snapshot.stateVersion,
                latestSnapshot: snapshot,
              },
            };
          });
          pendingSubmission.current = null;
          setTurnStatus(null);
        });
        socket.on('connect_error', (cause: Error) => {
          const liveError = createClientSessionError(
            LIVE_CONNECTION_CONTEXT,
            'NETWORK_UNAVAILABLE',
            cause,
            liveFailureTracker,
          );
          logLiveSessionFailure(liveError);
          isLiveErrorVisible.current = true;
          setError(liveError.playerError);
          if (liveError.occurrence >= 2) socket?.disconnect();
        });
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        const liveError = createClientSessionError(
          LIVE_IDENTITY_CONTEXT,
          'IDENTITY_UNAVAILABLE',
          cause,
          liveFailureTracker,
        );
        logLiveSessionFailure(liveError);
        isLiveErrorVisible.current = true;
        setError(liveError.playerError);
      });

    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [access?.participant.playerId, access?.session.id, getIdentityToken, liveFailureTracker, resetSession]);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    setIsWorking(true);
    isLiveErrorVisible.current = false;
    setError(null);
    try {
      return await operation();
    } catch (cause) {
      setError(toSessionUiError(cause, UNKNOWN_SESSION_RECOVERY));
      return null;
    } finally {
      setIsWorking(false);
    }
  }, []);

  const createSession = useCallback(
    async (displayName: string, maxPlayers: number) => {
      const result = await run(() => sessionApi.create(displayName, maxPlayers));
      if (result) {
        setJoinCode(result.joinCode);
        acceptAccess(result);
        storeSessionId(result.session.id, result.joinCode);
      }
    },
    [acceptAccess, run, sessionApi],
  );

  const joinSession = useCallback(
    async (displayName: string, code: string) => {
      const result = await run(() => sessionApi.join(displayName, code));
      if (result) {
        setJoinCode(null);
        acceptAccess(result);
        storeSessionId(result.session.id, null);
      }
    },
    [acceptAccess, run, sessionApi],
  );

  const setReady = useCallback(
    async (isReady: boolean) => {
      if (!access) return;
      const result = await run(() => sessionApi.ready(access.session.id, isReady));
      if (result) acceptAccess(result);
    },
    [acceptAccess, access, run, sessionApi],
  );

  const startSession = useCallback(async () => {
    if (!access) return;
    const result = await run(() => sessionApi.start(access.session.id));
    if (result) acceptAccess(result);
  }, [acceptAccess, access, run, sessionApi]);

  const setBotSeat = useCallback(
    async (seatNumber: number, isBot: boolean) => {
      if (!access) return;
      const result = await run(() => sessionApi.setBotSeat(access.session.id, seatNumber, isBot));
      if (result) acceptAccess(result);
    },
    [acceptAccess, access, run, sessionApi],
  );

  const cancelSession = useCallback(async () => {
    if (!access) return;
    const result = await run(() => sessionApi.cancel(access.session.id));
    if (result) acceptAccess(result);
  }, [acceptAccess, access, run, sessionApi]);

  const submitTurn = useCallback(
    async (actions: PlayerAction[]) => {
      const snapshot = access?.session.latestSnapshot;
      if (!access || !snapshot) throw new Error('The authoritative session snapshot is not available.');
      if (access.session.pendingPlayerIds.includes(access.participant.playerId)) {
        setTurnStatus('Plan locked. Waiting for the remaining active players.');
        return;
      }

      const pending = pendingSubmission.current;
      const payload =
        pending?.expectedStateVersion === snapshot.stateVersion
          ? pending
          : {
              submissionId: crypto.randomUUID(),
              expectedStateVersion: snapshot.stateVersion,
              actions,
            };
      pendingSubmission.current = payload;
      isLiveErrorVisible.current = false;
      setError(null);
      let result: TurnSubmissionResult;
      try {
        result = await sessionApi.submitTurn(access.session.id, payload);
      } catch (cause) {
        setError(toSessionUiError(cause, UNKNOWN_TURN_RECOVERY));
        return;
      }
      if (result.snapshot) {
        pendingSubmission.current = null;
        setTurnStatus(null);
        setAccess((current) =>
          current
            ? {
                ...current,
                session: {
                  ...current.session,
                  stateVersion: result.snapshot!.stateVersion,
                  latestSnapshot: result.snapshot,
                },
              }
            : current,
        );
        return;
      }
      setTurnStatus(
        `Plan locked. Waiting for ${Math.max(
          0,
          access.session.participants.filter((participant) => !participant.isBot).length -
            result.submittedPlayerIds.length,
        )} player(s).`,
      );
    },
    [access, sessionApi],
  );

  return {
    access,
    joinCode,
    isLoading,
    isWorking,
    error,
    turnStatus,
    clearError: () => setError(null),
    createSession,
    joinSession,
    setReady,
    setBotSeat,
    cancelSession,
    startSession,
    submitTurn,
  };
}
