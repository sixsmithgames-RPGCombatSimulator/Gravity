// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeGameStateSnapshot, type PlayerAction } from '@gravity/core';
import { createMockGame } from '../utils/mockGame';
import { SessionRequestError } from './errors';
import type { SessionAccess, TurnSubmissionPayload } from './types';

const doubles = vi.hoisted(() => ({
  api: { create: vi.fn(), join: vi.fn(), get: vi.fn(), ready: vi.fn(), start: vi.fn(), setBotSeat: vi.fn(),
    cancel: vi.fn(), submitTurn: vi.fn() },
  io: vi.fn(),
}));
vi.mock('./api', () => ({ createSessionApi: () => doubles.api, SESSION_API_ORIGIN: 'http://127.0.0.1:3100' }));
vi.mock('socket.io-client', () => ({ io: doubles.io }));
import { useSessionController } from './useSessionController';

type Listener = (...args: unknown[]) => void;
type SocketDouble = { events: Map<string, Listener>; disconnect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>; timeout: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>;
  auth: (complete: (value: { token?: string }) => void) => void };
const sockets: SocketDouble[] = [];
const token = vi.fn<() => Promise<string>>();

/** Stable domain data keeps controller tests focused on network timing and membership. */
function access(id = 'mission-a', version = 1): SessionAccess {
  const game = { ...createMockGame('hard'), id, currentTurn: version };
  const participant = { id: 'member', sessionId: id, userId: 'host', playerId: 'player-1', displayName: 'Host',
    seatNumber: 1, isReady: true, isBot: false, isHost: true,
    joinedAt: '2026-10-10T12:00:00.000Z', updatedAt: '2026-10-10T12:00:00.000Z' };
  return { participant, session: { id, status: 'active', maxPlayers: 2, createdBy: 'host', stateVersion: version,
    participants: [participant], pendingPlayerIds: [], latestSnapshot: serializeGameStateSnapshot(game, version),
    createdAt: '2026-10-10T12:00:00.000Z', updatedAt: '2026-10-10T12:01:00.000Z', startedAt: '2026-10-10T12:01:00.000Z' } };
}

/** Expose a completion handle so tests can reproduce old REST responses arriving after new socket state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear(); sockets.length = 0;
  token.mockResolvedValue('fresh-token');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  doubles.io.mockImplementation((_origin: string, options: { auth: SocketDouble['auth'] }) => {
    const socket: SocketDouble = { events: new Map(), disconnect: vi.fn(), on: vi.fn(), timeout: vi.fn(), emit: vi.fn(), auth: options.auth };
    socket.on.mockImplementation((name: string, listener: Listener) => { socket.events.set(name, listener); return socket; });
    socket.timeout.mockReturnValue(socket);
    sockets.push(socket);
    return socket;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** Join through the public hook API so each test exercises its actual lifecycle fence. */
async function joined() {
  doubles.api.join.mockResolvedValue(access());
  const hook = renderHook(() => useSessionController(token));
  await act(async () => { await hook.result.current.joinSession('Host', 'CODE'); });
  return hook;
}

describe('device session lifecycle and asynchronous authority', () => {
  it('ignores a resume reply after the player chooses another session', async () => {
    const oldResume = deferred<SessionAccess>();
    localStorage.setItem('gravity:beta-session:v1', JSON.stringify({ version: 1, sessionId: 'mission-a' }));
    doubles.api.get.mockReturnValue(oldResume.promise);
    doubles.api.join.mockResolvedValue(access('mission-b'));
    const hook = renderHook(() => useSessionController(token));
    await act(async () => { await hook.result.current.joinSession('Host', 'NEWCODE'); });
    await act(async () => { oldResume.resolve(access('mission-a', 5)); });
    expect(hook.result.current.access?.session.id).toBe('mission-b');
    expect(localStorage.getItem('gravity:beta-session:v1')).toContain('mission-b');
  });

  it('return home discards resume and old mutation results without deleting the server mission', async () => {
    const hook = await joined();
    const oldResponse = deferred<SessionAccess>();
    doubles.api.ready.mockReturnValue(oldResponse.promise);
    let request!: Promise<void>;
    act(() => { request = hook.result.current.setReady(false); });
    act(() => { hook.result.current.returnToMissionHome(); });
    await act(async () => { oldResponse.resolve(access('mission-a', 4)); await request; });
    expect(hook.result.current.access).toBeNull();
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.isWorking).toBe(false);
    expect(localStorage.getItem('gravity:beta-session:v1')).toBeNull();
    expect(doubles.api.cancel).not.toHaveBeenCalled();
  });

  it('retains a newer socket snapshot when a REST mutation returns an older summary', async () => {
    const hook = await joined();
    const oldResponse = deferred<SessionAccess>();
    doubles.api.ready.mockReturnValue(oldResponse.promise);
    let request!: Promise<void>;
    act(() => { request = hook.result.current.setReady(false); });
    act(() => { sockets[0].events.get('state_snapshot')!(access('mission-a', 3).session.latestSnapshot); });
    await act(async () => { oldResponse.resolve(access('mission-a', 2)); await request; });
    expect(hook.result.current.access?.session.stateVersion).toBe(3);
  });

  it('does not clear a locked plan for duplicate/stale/foreign snapshot broadcasts', async () => {
    const hook = await joined();
    const locked = { ...access().session, pendingPlayerIds: ['player-1'] };
    act(() => { sockets[0].events.get('session_updated')!(locked); });
    act(() => {
      sockets[0].events.get('state_snapshot')!(access().session.latestSnapshot);
      sockets[0].events.get('state_snapshot')!(access('mission-a', 0).session.latestSnapshot);
      sockets[0].events.get('state_snapshot')!(access('mission-b', 4).session.latestSnapshot);
    });
    expect(hook.result.current.turnStatus).toContain('Plan locked');
    await act(async () => { await hook.result.current.submitTurn([]); });
    expect(doubles.api.submitTurn).not.toHaveBeenCalled();
  });

  it('clears a lock only after accepting a genuinely newer committed snapshot', async () => {
    const hook = await joined();
    act(() => { sockets[0].events.get('session_updated')!({ ...access().session, pendingPlayerIds: ['player-1'] }); });
    act(() => { sockets[0].events.get('state_snapshot')!(access('mission-a', 2).session.latestSnapshot); });
    expect(hook.result.current.turnStatus).toBeNull();
    expect(hook.result.current.access?.session.pendingPlayerIds).toEqual([]);
  });

  it('refreshes the identity on each socket authentication request', async () => {
    await joined();
    token.mockResolvedValueOnce('first-token').mockResolvedValueOnce('refreshed-token');
    const complete = vi.fn();
    await act(async () => { sockets[0].auth(complete); });
    await act(async () => { sockets[0].auth(complete); });
    expect(complete.mock.calls).toEqual([[{ token: 'first-token' }], [{ token: 'refreshed-token' }]]);
  });

  it('requires a room acknowledgement and stops the second consecutive failure with support', async () => {
    const hook = await joined();
    const socket = sockets[0];
    const rejectRoom = () => {
      socket.events.get('connect')!();
      const callback = socket.emit.mock.lastCall![2] as (error: Error | null, ack: { ok: boolean; code: string; message: string }) => void;
      callback(null, { ok: false, code: 'RATE_LIMITED', message: 'internal raw transport details' });
    };
    act(rejectRoom);
    expect(hook.result.current.error?.message).toContain('restore live updates for your player seat');
    expect(hook.result.current.error?.message).toContain('reload Gravity once');
    expect(hook.result.current.error?.message).not.toMatch(/RATE_LIMITED|internal raw|transport|JSON/);
    act(rejectRoom);
    expect(hook.result.current.error?.message).toContain('same snag twice');
    expect(hook.result.current.error?.message).toContain('info@sixsmithgames.com');
    expect(hook.result.current.error?.supportCode).toMatch(/^GRV-[A-F0-9]{8}$/);
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('successful room recovery resets the repeated-failure boundary', async () => {
    const hook = await joined();
    const socket = sockets[0];
    const acknowledge = (ok: boolean) => {
      socket.events.get('connect')!();
      const callback = socket.emit.mock.lastCall![2] as (error: Error | null, ack: { ok: boolean; code?: string }) => void;
      callback(null, ok ? { ok: true } : { ok: false, code: 'RATE_LIMITED' });
    };
    act(() => acknowledge(false));
    act(() => acknowledge(true));
    expect(hook.result.current.error).toBeNull();
    act(() => acknowledge(false));
    expect(hook.result.current.error?.supportCode).toBeNull();
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('ignores obsolete socket delivery and revokes local resume when membership is lost', async () => {
    const hook = await joined();
    const previous = sockets[0];
    act(() => { previous.events.get('session_updated')!({ ...access().session, participants: [] }); });
    expect(hook.result.current.access).toBeNull();
    expect(hook.result.current.error?.message).toContain('host switched it to a bot');
    expect(localStorage.getItem('gravity:beta-session:v1')).toBeNull();
    act(() => { previous.events.get('state_snapshot')!(access('mission-a', 5).session.latestSnapshot); });
    expect(hook.result.current.access).toBeNull();
  });

  it('uses corrected actions after a confirmed invalid plan rejection', async () => {
    const hook = await joined();
    doubles.api.submitTurn.mockRejectedValueOnce(new SessionRequestError(
      { message: 'Plan rejected; review your actions.', supportCode: null }, 'INVALID_ACTION', 400, 'submit-turn', 'lock-plan', 1, 'test diagnostic',
    )).mockResolvedValueOnce({ status: 'pending', stateVersion: 1, submittedPlayerIds: ['player-1'], snapshot: null });
    const wrong: PlayerAction[] = [{ playerId: 'player-1', crewId: 'captain-1', type: 'restore' }];
    const corrected: PlayerAction[] = [];
    await act(async () => { await hook.result.current.submitTurn(wrong); });
    await act(async () => { await hook.result.current.submitTurn(corrected); });
    const first = doubles.api.submitTurn.mock.calls[0][1] as TurnSubmissionPayload;
    const second = doubles.api.submitTurn.mock.calls[1][1] as TurnSubmissionPayload;
    expect(second.actions).toEqual(corrected);
    expect(second.submissionId).not.toBe(first.submissionId);
    expect(second).not.toHaveProperty('sessionId');
  });

  it('stops a second confirmed invalid-plan rejection but leaves the first correction available', async () => {
    const hook = await joined();
    doubles.api.submitTurn.mockRejectedValueOnce(new SessionRequestError(
      { message: 'Plan rejected; review your actions.', supportCode: null }, 'INVALID_ACTION', 400, 'submit-turn', 'lock-plan', 1, 'private diagnostic',
    )).mockRejectedValueOnce(new SessionRequestError(
      { message: 'Sorry—Gravity hit the same snag twice. Email info@sixsmithgames.com.', supportCode: 'GRV-12345678' },
      'INVALID_ACTION', 400, 'submit-turn', 'lock-plan', 2, 'private diagnostic',
    ));
    await act(async () => { await hook.result.current.submitTurn([]); });
    expect(hook.result.current.isTurnSubmissionBlocked).toBe(false);
    await act(async () => { await hook.result.current.submitTurn([]); });
    expect(hook.result.current.isTurnSubmissionBlocked).toBe(true);
    await act(async () => { await hook.result.current.submitTurn([]); });
    expect(doubles.api.submitTurn).toHaveBeenCalledTimes(2);
  });

  it('preserves idempotency after an uncertain transport outcome and a duplicate snapshot', async () => {
    const hook = await joined();
    doubles.api.submitTurn.mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ status: 'pending', stateVersion: 1, submittedPlayerIds: ['player-1'], snapshot: null });
    const original: PlayerAction[] = [{ playerId: 'player-1', crewId: 'captain-1', type: 'restore' }];
    await act(async () => { await hook.result.current.submitTurn(original); });
    expect(hook.result.current.error?.message).toContain('could not confirm whether your original plan was locked');
    expect(hook.result.current.error?.message).toContain('Keep this screen open');
    expect(hook.result.current.error?.message).not.toMatch(/not committed|not locked|Reload|lost response/);
    act(() => { sockets[0].events.get('state_snapshot')!(access().session.latestSnapshot); });
    await act(async () => { await hook.result.current.submitTurn([]); });
    const first = doubles.api.submitTurn.mock.calls[0][1] as TurnSubmissionPayload;
    const retry = doubles.api.submitTurn.mock.calls[1][1] as TurnSubmissionPayload;
    expect(retry.submissionId).toBe(first.submissionId);
    expect(retry.actions).toEqual(original);
    expect(hook.result.current.turnStatus).toContain('Plan locked');
  });

  it('escalates a repeated raw turn failure while preserving the original retry payload', async () => {
    const hook = await joined();
    doubles.api.submitTurn.mockRejectedValue(new Error('private untyped failure'));
    await act(async () => { await hook.result.current.submitTurn([]); });
    await act(async () => { await hook.result.current.submitTurn([]); });
    expect(hook.result.current.error?.message).toContain('same snag twice');
    expect(hook.result.current.error?.message).toContain('info@sixsmithgames.com');
    expect(hook.result.current.error?.message).toContain('could not confirm whether your original plan was locked');
    expect(hook.result.current.error?.message).not.toMatch(/private untyped|not committed|not locked|Reload|choose Lock Plans again/);
    expect(hook.result.current.error?.supportCode).toMatch(/^GRV-[A-F0-9]{8}$/);
    expect(doubles.api.submitTurn.mock.calls[1][1]).toEqual(doubles.api.submitTurn.mock.calls[0][1]);
    expect(hook.result.current.isTurnSubmissionBlocked).toBe(true);
    await act(async () => { await hook.result.current.submitTurn([]); });
    expect(doubles.api.submitTurn).toHaveBeenCalledTimes(2);
    act(() => { sockets[0].events.get('state_snapshot')!(access('mission-a', 2).session.latestSnapshot); });
    expect(hook.result.current.isTurnSubmissionBlocked).toBe(false);
    expect(hook.result.current.error).toBeNull();
  });

  it('resets raw failure escalation after a successful request and a different workflow', async () => {
    const hook = await joined();
    doubles.api.ready.mockRejectedValueOnce(new Error('raw readiness failure')).mockResolvedValueOnce(access())
      .mockRejectedValue(new Error('raw readiness failure'));
    doubles.api.get.mockResolvedValue(access());
    await act(async () => { await hook.result.current.setReady(true); });
    expect(hook.result.current.error?.message).toContain('mark your player ready');
    await act(async () => { await hook.result.current.refreshSession(); });
    await act(async () => { await hook.result.current.setReady(true); });
    await act(async () => { await hook.result.current.setReady(true); });
    expect(hook.result.current.error?.supportCode).toBeNull();
    await act(async () => { await hook.result.current.refreshSession(); });
    doubles.api.setBotSeat.mockRejectedValue(new Error('raw bot failure'));
    await act(async () => { await hook.result.current.setBotSeat(2, true); });
    await act(async () => { await hook.result.current.refreshSession(); });
    await act(async () => { await hook.result.current.setReady(true); });
    expect(hook.result.current.error?.supportCode).toBeNull();
    await act(async () => { await hook.result.current.refreshSession(); });
    await act(async () => { await hook.result.current.setReady(true); });
    expect(hook.result.current.error?.message).toContain('same snag twice');
  });

  it('pauses uncertain lobby writes until a read succeeds and escalates the repeated write failure', async () => {
    const hook = await joined();
    doubles.api.ready.mockRejectedValue(new Error('private uncertain readiness result'));
    doubles.api.get.mockResolvedValue(access());
    await act(async () => { await hook.result.current.setReady(true); });
    expect(hook.result.current.isLobbyRefreshRequired).toBe(true);
    expect(hook.result.current.error?.message).toContain('Choose Refresh lobby');
    await act(async () => { await hook.result.current.setReady(true); });
    expect(doubles.api.ready).toHaveBeenCalledTimes(1);
    await act(async () => { await hook.result.current.refreshSession(); });
    expect(doubles.api.get).toHaveBeenCalledWith('mission-a', true);
    expect(hook.result.current.isLobbyRefreshRequired).toBe(false);
    await act(async () => { await hook.result.current.setReady(true); });
    expect(hook.result.current.error?.message).toContain('same snag twice');
    expect(hook.result.current.error?.message).toContain('info@sixsmithgames.com');
    expect(hook.result.current.error?.message).not.toContain('Choose Refresh lobby');
  });

  it('blocks blind creation after an unknown first result, including a direct same-render call', async () => {
    doubles.api.create.mockRejectedValue(new Error('private lost creation reply'));
    const hook = renderHook(() => useSessionController(token));
    await act(async () => {
      const create = hook.result.current.createSession;
      await create('Host', 4); await create('Host', 4);
    });
    expect(doubles.api.create).toHaveBeenCalledTimes(1);
    expect(hook.result.current.creationError?.message).toContain('do not create another game yet');
    expect(hook.result.current.creationError?.supportCode).toMatch(/^GRV-[A-F0-9]{8}$/);
    act(() => hook.result.current.returnToMissionHome());
    await act(async () => { await hook.result.current.createSession('Host', 4); });
    expect(doubles.api.create).toHaveBeenCalledTimes(1);
  });

  it('prevents parallel lobby mutations through direct same-controller calls', async () => {
    const hook = await joined();
    const pending = deferred<SessionAccess>();
    doubles.api.ready.mockReturnValue(pending.promise);
    let request!: Promise<void>;
    act(() => { request = hook.result.current.setReady(true); });
    await act(async () => { await hook.result.current.setBotSeat(2, true); });
    expect(doubles.api.setBotSeat).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(access()); await request; });
  });

  it('does not apply old completion errors to another session', async () => {
    const hook = await joined();
    const old = deferred<SessionAccess>();
    doubles.api.ready.mockReturnValue(old.promise);
    let request!: Promise<void>;
    act(() => { request = hook.result.current.setReady(false); });
    act(() => hook.result.current.returnToMissionHome());
    doubles.api.join.mockResolvedValue(access('mission-b'));
    await act(async () => { await hook.result.current.joinSession('Host', 'NEXT'); });
    await act(async () => { old.reject(new Error('old error')); await request; });
    await waitFor(() => expect(hook.result.current.access?.session.id).toBe('mission-b'));
    expect(hook.result.current.error).toBeNull();
  });
});
