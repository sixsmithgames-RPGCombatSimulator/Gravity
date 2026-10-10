import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { PlayerAction } from '@gravity/core';

import { createSessionApi, SESSION_API_ORIGIN } from './api';
import {
  SessionFailureTracker, SessionRequestError, createClientSessionError, createSessionRequestError,
  isTerminalSessionResumeError, toSessionUiError, type SessionRequestContext,
} from './errors';
import { mergeSessionAccess, mergeSessionSnapshot, mergeSessionSummary } from './merge';
import { SESSION_REQUEST_CONTEXTS, botSeatRequestContext, readyRequestContext } from './requestContexts';
import type { SessionAccess, SessionSummary, SessionUiError, TurnSubmissionPayload } from './types';

const STORAGE_KEY = 'gravity:beta-session:v1';
type StoredSession = { version: 1; sessionId: string; joinCode?: string };
type PendingSubmission = TurnSubmissionPayload & { sessionId: string };
type JoinAck = { ok: true } | { ok: false; code: string; message: string };

const LIVE_CONNECTION_CONTEXT: SessionRequestContext = {
  workflow: 'live-session', stage: 'connect', attemptedAction: 'reconnect live game updates',
  failedResult: 'Live lobby and turn updates did not reconnect.',
  safeState: 'Your last server-confirmed lobby or turn state is safe.',
  nextAction: 'Check your connection, then reload Gravity once.',
};
const LIVE_IDENTITY_CONTEXT: SessionRequestContext = {
  workflow: 'live-session', stage: 'authenticate', attemptedAction: 'confirm your sign-in for live game updates',
  failedResult: 'Live lobby and turn updates did not start.',
  safeState: 'Your last server-confirmed lobby or turn state is safe.',
  nextAction: 'Refresh your sign-in, then reload Gravity once.',
};
const LIVE_ROOM_CONTEXT: SessionRequestContext = {
  workflow: 'live-session', stage: 'join-room', attemptedAction: 'restore live updates for your player seat',
  failedResult: 'Your player seat did not reconnect to live updates.',
  safeState: 'Your last server-confirmed lobby or turn state is safe.',
  nextAction: 'Check your connection and sign-in, then reload Gravity once.',
};
const CANCELED_RECOVERY =
  'Gravity was trying to keep this lobby in sync. The lobby closed because the host canceled this game. ' +
  'No additional lobby or turn changes were applied on this device. Create or join another mission.';
const REMOVED_SEAT_RECOVERY =
  'Gravity was trying to keep your player seat connected. Your seat is no longer available because the host switched it to a bot. ' +
  'Your previous server-confirmed game state is safe on the server. Join another mission to keep playing.';

/** Read only the supported resume pointer; corrupt local data never becomes mission authority. */
function readStoredSession(): StoredSession | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<StoredSession> | null;
    return stored?.version === 1 && typeof stored.sessionId === 'string'
      ? { version: 1, sessionId: stored.sessionId,
        ...(typeof stored.joinCode === 'string' ? { joinCode: stored.joinCode } : {}) }
      : null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/** Persist a resume reference, never a browser-owned copy of the authoritative mission. */
function storeSessionId(sessionId: string, joinCode?: string | null): void {
  const current = readStoredSession();
  const code = joinCode === undefined && current?.sessionId === sessionId ? current.joinCode : joinCode;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, sessionId, ...(code ? { joinCode: code } : {}) }));
}

/** Keep diagnostics separate from the player recovery message. */
function logLiveSessionFailure(error: SessionRequestError): void {
  console.error('Gravity live session connection failed', {
    workflow: error.workflow, stage: error.stage, code: error.code,
    occurrence: error.occurrence, diagnostic: error.diagnostic,
  });
}

/**
 * Purpose: Own the authenticated device session and accept only current, monotonic server updates.
 * Parameters: Token accessor refreshed for every REST request and socket handshake.
 * Returns: Player actions, current accepted session and structured recovery state.
 * Side effects: REST/socket traffic and a resume pointer; never simulates or deletes a mission.
 */
export function useSessionController(getIdentityToken: () => Promise<string>) {
  const requestFailureTracker = useMemo(() => new SessionFailureTracker(), []);
  const sessionApi = useMemo(() => createSessionApi(getIdentityToken, requestFailureTracker), [getIdentityToken, requestFailureTracker]);
  const liveFailureTracker = useMemo(() => new SessionFailureTracker(), []);
  const [access, setAccess] = useState<SessionAccess | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(() => readStoredSession()?.joinCode ?? null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<SessionUiError | null>(null);
  const [creationError, setCreationError] = useState<SessionUiError | null>(null);
  const [isLobbyRefreshRequired, setIsLobbyRefreshRequired] = useState(false);
  const [isTurnSubmissionBlocked, setIsTurnSubmissionBlocked] = useState(false);
  const [turnStatus, setTurnStatus] = useState<string | null>(null);
  const accessRef = useRef<SessionAccess | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const workingCount = useRef(0);
  const pendingSubmission = useRef<PendingSubmission | null>(null);
  const isLiveErrorVisible = useRef(false);
  const lobbyRefreshRequired = useRef(false);
  const uncertainCreation = useRef(false);
  const turnSubmissionBlocked = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  /** Fence all previous requests before returning home; the durable game remains on the server. */
  const resetSession = useCallback((message: string | null) => {
    generation.current += 1;
    localStorage.removeItem(STORAGE_KEY);
    accessRef.current = null;
    pendingSubmission.current = null;
    workingCount.current = 0;
    setAccess(null); setJoinCode(null); setTurnStatus(null); setIsWorking(false); setIsLoading(false);
    isLiveErrorVisible.current = false;
    lobbyRefreshRequired.current = false; setIsLobbyRefreshRequired(false);
    turnSubmissionBlocked.current = false; setIsTurnSubmissionBlocked(false);
    liveFailureTracker.recordSuccess();
    requestFailureTracker.recordSuccess();
    setError(message ? { message, supportCode: null } : null);
  }, [liveFailureTracker, requestFailureTracker]);

  /** Publish one accepted state atomically to controller observers and its synchronous async fence. */
  const publishAccess = useCallback((next: SessionAccess) => {
    const previous = accessRef.current;
    if (next.session.status === 'abandoned') { resetSession(CANCELED_RECOVERY); return false; }
    if (!next.session.participants.some((member) => member.playerId === next.participant.playerId)) {
      resetSession(REMOVED_SEAT_RECOVERY); return false;
    }
    if (previous?.session.id !== next.session.id || next.session.stateVersion > previous.session.stateVersion) {
      pendingSubmission.current = null;
      turnSubmissionBlocked.current = false; setIsTurnSubmissionBlocked(false);
      requestFailureTracker.recordSuccess();
      if (!isLiveErrorVisible.current) setError(null);
    }
    accessRef.current = next;
    setAccess(next);
    setIsLoading(false);
    storeSessionId(next.session.id);
    setTurnStatus(next.session.pendingPlayerIds.includes(next.participant.playerId)
      ? 'Plan locked. Waiting for the remaining active players.' : null);
    return true;
  }, [requestFailureTracker, resetSession]);

  /** Only explicit create/join/resume may replace session identity; mutation replies cannot. */
  const acceptAccess = useCallback((incoming: SessionAccess, epoch: number, replace = false) => {
    if (!mounted.current || generation.current !== epoch) return false;
    const current = accessRef.current;
    if (current && current.session.id !== incoming.session.id && !replace) return false;
    const accepted = current && current.session.id === incoming.session.id
      ? mergeSessionAccess(current, incoming) : incoming;
    if (accepted === current) return false;
    return publishAccess(accepted);
  }, [publishAccess]);

  useEffect(() => {
    const stored = readStoredSession();
    const epoch = generation.current;
    let disposed = false;
    if (!stored) { setIsLoading(false); return; }
    void sessionApi.get(stored.sessionId)
      .then((result) => {
        if (!disposed && mounted.current && epoch === generation.current) {
          requestFailureTracker.recordSuccess(); acceptAccess(result, epoch, true);
        }
      })
      .catch((cause: unknown) => {
        if (disposed || !mounted.current || epoch !== generation.current) return;
        if (isTerminalSessionResumeError(cause)) { localStorage.removeItem(STORAGE_KEY); setJoinCode(null); }
        setError(toSessionUiError(cause, SESSION_REQUEST_CONTEXTS.resume, requestFailureTracker));
      })
      .finally(() => { if (!disposed && mounted.current && epoch === generation.current) setIsLoading(false); });
    return () => { disposed = true; };
  }, [acceptAccess, requestFailureTracker, sessionApi]);

  useEffect(() => {
    if (!access) return;
    const sessionId = access.session.id;
    const epoch = generation.current;
    let disposed = false;
    let identityFailed = false;
    const isCurrent = () => !disposed && mounted.current && generation.current === epoch &&
      accessRef.current?.session.id === sessionId;
    let socket: ReturnType<typeof io>;

    const reportFailure = (failure: SessionRequestError) => {
      if (!isCurrent()) return;
      logLiveSessionFailure(failure);
      isLiveErrorVisible.current = true;
      setError(failure.playerError);
      if (failure.occurrence >= 2) socket.disconnect();
    };

    // Refresh Clerk identity for every reconnect, rather than capturing an expiring token.
    socket = io(SESSION_API_ORIGIN, { auth: (complete) => {
      void getIdentityToken().then((token) => {
        if (!isCurrent()) return;
        identityFailed = false;
        complete({ token });
      }).catch((cause: unknown) => {
        if (!isCurrent()) return;
        identityFailed = true;
        reportFailure(createClientSessionError(LIVE_IDENTITY_CONTEXT, 'IDENTITY_UNAVAILABLE', cause, liveFailureTracker));
        complete({});
      });
    } });

    socket.on('connect', () => {
      if (!isCurrent()) return;
      socket.timeout(7_500).emit('join_session', { sessionId }, (timeout: Error | null, ack?: JoinAck) => {
        if (!isCurrent()) return;
        if (timeout || !ack?.ok) {
          const code = !timeout && ack && !ack.ok ? ack.code : 'NETWORK_UNAVAILABLE';
          if (['NOT_A_MEMBER', 'NOT_FOUND'].includes(code)) { resetSession(REMOVED_SEAT_RECOVERY); return; }
          reportFailure(createSessionRequestError(LIVE_ROOM_CONTEXT, {
            code, status: 0, diagnostic: timeout?.message ?? `Room authorization rejected: ${code}`,
          }, liveFailureTracker));
          return;
        }
        // Room authorization, rather than a bare transport handshake, ends a recovery chain.
        liveFailureTracker.recordSuccess();
        if (isLiveErrorVisible.current) { isLiveErrorVisible.current = false; setError(null); }
      });
    });
    socket.on('session_updated', (incoming: SessionSummary) => {
      if (!isCurrent()) return;
      const current = accessRef.current!;
      const session = mergeSessionSummary(current.session, incoming);
      if (session !== current.session) publishAccess({ ...current, session });
    });
    socket.on('state_snapshot', (snapshot: SessionSummary['latestSnapshot']) => {
      if (!isCurrent() || !snapshot) return;
      const current = accessRef.current!;
      const session = mergeSessionSnapshot(current.session, snapshot);
      if (session !== current.session) publishAccess({ ...current, session });
    });
    socket.on('connect_error', (cause: Error) => {
      if (!isCurrent() || identityFailed) return;
      reportFailure(createClientSessionError(LIVE_CONNECTION_CONTEXT, 'NETWORK_UNAVAILABLE', cause, liveFailureTracker));
    });
    return () => { disposed = true; socket.disconnect(); };
  }, [access?.participant.playerId, access?.session.id, getIdentityToken, liveFailureTracker, publishAccess, resetSession]);

  /** Discard obsolete results/errors after leaving or replacing the device's session. */
  const run = useCallback(async <T,>(operation: () => Promise<T>, epoch: number, context: SessionRequestContext, recoveryRead = false): Promise<T | null> => {
    workingCount.current += 1; setIsWorking(true); setError(null); isLiveErrorVisible.current = false;
    try {
      const result = await operation();
      if (!mounted.current || epoch !== generation.current) return null;
      if (!recoveryRead) requestFailureTracker.recordSuccess();
      return result;
    } catch (cause) {
      if (mounted.current && epoch === generation.current) {
        const playerError = toSessionUiError(cause, context, requestFailureTracker);
        setError(playerError);
        const isUnconfirmed = !(cause instanceof SessionRequestError) || cause.isUnconfirmed;
        if (isUnconfirmed && context.workflow === 'create-session') {
          uncertainCreation.current = true; setCreationError(playerError);
        }
        if (isUnconfirmed && ['set-ready', 'configure-bot-seat', 'cancel-session', 'start-session'].includes(context.workflow)) {
          lobbyRefreshRequired.current = true; setIsLobbyRefreshRequired(true);
        }
      }
      return null;
    } finally {
      if (mounted.current && epoch === generation.current) {
        workingCount.current -= 1; setIsWorking(workingCount.current > 0);
      }
    }
  }, [requestFailureTracker]);

  const createSession = useCallback(async (displayName: string, maxPlayers: number) => {
    // There is no server creation idempotency key. An unknown first result must
    // not trigger another blind creation from a form submit or direct caller.
    if (workingCount.current > 0 || uncertainCreation.current) return;
    const epoch = ++generation.current;
    const result = await run(() => sessionApi.create(displayName, maxPlayers), epoch, SESSION_REQUEST_CONTEXTS.create);
    if (result && acceptAccess(result, epoch, true)) {
      setJoinCode(result.joinCode); storeSessionId(result.session.id, result.joinCode);
    }
  }, [acceptAccess, run, sessionApi]);

  const joinSession = useCallback(async (displayName: string, code: string) => {
    if (workingCount.current > 0) return;
    const epoch = ++generation.current;
    const result = await run(() => sessionApi.join(displayName, code), epoch, SESSION_REQUEST_CONTEXTS.join);
    if (result && acceptAccess(result, epoch, true)) { setJoinCode(null); storeSessionId(result.session.id, null); }
  }, [acceptAccess, run, sessionApi]);

  /** Apply one existing-session mutation using the same epoch and summary fences as sockets. */
  const mutateSession = useCallback(async (operation: (sessionId: string) => Promise<SessionAccess>, context: SessionRequestContext) => {
    const current = accessRef.current;
    if (!current || lobbyRefreshRequired.current || workingCount.current > 0) return;
    const epoch = generation.current;
    const result = await run(() => operation(current.session.id), epoch, context);
    if (result) acceptAccess(result, epoch);
  }, [acceptAccess, run]);
  /** Read the existing server state without replaying a write or clearing its support sequence. */
  const refreshSession = useCallback(async () => {
    const current = accessRef.current;
    if (!current || workingCount.current > 0) return;
    const epoch = generation.current;
    const result = await run(() => sessionApi.get(current.session.id, true), epoch, SESSION_REQUEST_CONTEXTS.refresh, true);
    if (result) {
      lobbyRefreshRequired.current = false; setIsLobbyRefreshRequired(false);
      acceptAccess(result, epoch);
    }
  }, [acceptAccess, run, sessionApi]);
  const setReady = useCallback((isReady: boolean) => mutateSession((id) => sessionApi.ready(id, isReady), readyRequestContext(isReady)), [mutateSession, sessionApi]);
  const startSession = useCallback(() => mutateSession((id) => sessionApi.start(id), SESSION_REQUEST_CONTEXTS.start), [mutateSession, sessionApi]);
  const setBotSeat = useCallback((seatNumber: number, isBot: boolean) =>
    mutateSession((id) => sessionApi.setBotSeat(id, seatNumber, isBot), botSeatRequestContext(seatNumber, isBot)), [mutateSession, sessionApi]);
  const cancelSession = useCallback(() => mutateSession((id) => sessionApi.cancel(id), SESSION_REQUEST_CONTEXTS.cancel), [mutateSession, sessionApi]);

  const submitTurn = useCallback(async (actions: PlayerAction[]) => {
    if (turnSubmissionBlocked.current) return;
    const current = accessRef.current;
    const snapshot = current?.session.latestSnapshot;
    if (!current || !snapshot) {
      setError(toSessionUiError(new Error('No accepted session snapshot is available for submission.'), {
        ...SESSION_REQUEST_CONTEXTS.submit,
        failedResult: 'Your plan was not sent.',
        safeState: 'Your last completed turn is safe, and the plan on this screen was not changed.',
        nextAction: 'Keep this screen open, wait for your mission to finish loading, then choose Lock Plans again.',
        unconfirmed: undefined,
      }, requestFailureTracker));
      return;
    }
    if (current.session.pendingPlayerIds.includes(current.participant.playerId)) {
      setTurnStatus('Plan locked. Waiting for the remaining active players.'); return;
    }
    const epoch = generation.current;
    const existing = pendingSubmission.current;
    const payload: PendingSubmission = existing?.sessionId === current.session.id &&
      existing.expectedStateVersion === snapshot.stateVersion ? existing : {
        sessionId: current.session.id, submissionId: crypto.randomUUID(), expectedStateVersion: snapshot.stateVersion, actions,
      };
    pendingSubmission.current = payload;
    isLiveErrorVisible.current = false; setError(null);
    try {
      const result = await sessionApi.submitTurn(current.session.id, {
        submissionId: payload.submissionId, expectedStateVersion: payload.expectedStateVersion, actions: payload.actions,
      });
      const latest = accessRef.current;
      if (!mounted.current || epoch !== generation.current || latest?.session.id !== current.session.id) return;
      requestFailureTracker.recordSuccess();
      if (result.snapshot) {
        const session = mergeSessionSnapshot(latest.session, result.snapshot);
        if (session !== latest.session) publishAccess({ ...latest, session });
        return;
      }
      if (result.stateVersion !== latest.session.stateVersion) return;
      publishAccess({ ...latest, session: { ...latest.session,
        pendingPlayerIds: Array.from(new Set([...latest.session.pendingPlayerIds, ...result.submittedPlayerIds])) } });
    } catch (cause) {
      if (!mounted.current || epoch !== generation.current || accessRef.current?.session.id !== current.session.id ||
        accessRef.current.session.stateVersion > snapshot.stateVersion) return;
      // Explicit rejection commits no lock: corrected actions need a fresh id. Only
      // uncertain transport results must retain the id for an idempotent retry.
      if (cause instanceof SessionRequestError && !cause.isUnconfirmed && ['INVALID_ACTION', 'INVALID_REQUEST', 'STALE_STATE'].includes(cause.code)) {
        pendingSubmission.current = null;
      }
      const playerError = toSessionUiError(cause, SESSION_REQUEST_CONTEXTS.submit, requestFailureTracker);
      setError(playerError);
      if (playerError.supportCode) {
        turnSubmissionBlocked.current = true; setIsTurnSubmissionBlocked(true);
      }
    }
  }, [publishAccess, requestFailureTracker, sessionApi]);

  const returnToMissionHome = useCallback(() => resetSession(null), [resetSession]);
  return { access, joinCode, isLoading, isWorking, isLobbyRefreshRequired, isTurnSubmissionBlocked, error, creationError, turnStatus, clearError: () => setError(null),
    createSession, joinSession, setReady, setBotSeat, cancelSession, startSession, refreshSession, submitTurn, returnToMissionHome };
}
