import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { PlayerAction } from '@gravity/core';

import { createSessionApi, SESSION_API_ORIGIN } from './api';
import type { SessionAccess, SessionSummary } from './types';

const STORAGE_KEY = 'gravity:beta-session:v1';

type StoredSession = { version: 1; sessionId: string; joinCode?: string };

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

export function useSessionController(getIdentityToken: () => Promise<string>) {
  const sessionApi = useMemo(() => createSessionApi(getIdentityToken), [getIdentityToken]);
  const [access, setAccess] = useState<SessionAccess | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(() => readStoredSession()?.joinCode ?? null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnStatus, setTurnStatus] = useState<string | null>(null);
  const pendingSubmission = useRef<{
    submissionId: string;
    expectedStateVersion: number;
    actions: PlayerAction[];
  } | null>(null);

  const resetSession = useCallback((message: string) => {
    clearStoredSession();
    pendingSubmission.current = null;
    setAccess(null);
    setJoinCode(null);
    setTurnStatus(null);
    setError(message);
  }, []);

  const acceptAccess = useCallback((nextAccess: SessionAccess) => {
    if (nextAccess.session.status === 'abandoned') {
      resetSession('This game was canceled. You can create or join another mission.');
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
        localStorage.removeItem(STORAGE_KEY);
        setError(cause instanceof Error ? cause.message : 'The saved session could not be resumed.');
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
        socket.on('connect', () => socket?.emit('join_session', { sessionId: access.session.id }));
        socket.on('session_updated', (session: SessionSummary) => {
          if (session.status === 'abandoned') {
            resetSession('The host canceled this game. You can create or join another mission.');
            return;
          }
          if (!session.participants.some((member) => member.playerId === participantPlayerId)) {
            resetSession('The host switched your player slot to a bot. You can join another mission.');
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
        socket.on('connect_error', (cause: Error) => setError(`Live session connection failed: ${cause.message}`));
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Unable to authenticate live updates.');
      });

    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [access?.participant.playerId, access?.session.id, getIdentityToken, resetSession]);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    setIsWorking(true);
    setError(null);
    try {
      return await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The session request failed.');
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
      const result = await sessionApi.submitTurn(access.session.id, payload);
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
