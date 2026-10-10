import { describe, expect, it } from 'vitest';
import { serializeGameStateSnapshot } from '@gravity/core';
import { createMockGame } from '../utils/mockGame';
import { mergeSessionAccess, mergeSessionSnapshot, mergeSessionSummary } from './merge';
import type { SessionAccess, SessionSummary } from './types';

/** Build stable server-shaped state so assertions measure version/identity rather than random UI data. */
function summary(version = 2, id = 'mission-a'): SessionSummary {
  const game = { ...createMockGame('hard'), id };
  return {
    id, status: 'active', maxPlayers: 2, createdBy: 'host', stateVersion: version,
    participants: [{ id: 'member', sessionId: id, userId: 'host', playerId: 'player-1', displayName: 'Host',
      seatNumber: 1, isReady: true, isBot: false, isHost: true,
      joinedAt: '2026-10-10T12:00:00.000Z', updatedAt: '2026-10-10T12:00:00.000Z' }],
    pendingPlayerIds: [], latestSnapshot: serializeGameStateSnapshot(game, version),
    createdAt: '2026-10-10T12:00:00.000Z', updatedAt: '2026-10-10T12:01:00.000Z', startedAt: '2026-10-10T12:01:00.000Z',
  };
}

describe('session-scoped server acceptance', () => {
  it('rejects older REST summaries, foreign sessions and lobby revival', () => {
    const current = summary(5);
    expect(mergeSessionSummary(current, summary(4))).toBe(current);
    expect(mergeSessionSummary(current, summary(6, 'mission-b'))).toBe(current);
    expect(mergeSessionSummary(current, { ...summary(5), status: 'lobby' })).toBe(current);
  });

  it('retains locks and the committed snapshot after duplicate equal-version summaries', () => {
    const current = { ...summary(), pendingPlayerIds: ['player-1'] };
    const duplicate = { ...summary(), latestSnapshot: null };
    const merged = mergeSessionSummary(current, duplicate);
    expect(merged.pendingPlayerIds).toEqual(['player-1']);
    expect(merged.latestSnapshot).toBe(current.latestSnapshot);
  });

  it('uses updatedAt to reject obsolete same-turn roster/readiness responses', () => {
    const current = summary();
    const old = { ...summary(), updatedAt: '2026-10-10T12:00:59.999Z', participants: [] };
    expect(mergeSessionSummary(current, old)).toBe(current);
  });

  it('orders same-clock lobby mutations by the strictly increasing server timestamp', () => {
    const initial: SessionSummary = { ...summary(0), status: 'lobby', latestSnapshot: null,
      updatedAt: '2026-10-10T12:00:00.000Z' };
    const ready = { ...initial, updatedAt: '2026-10-10T12:00:00.001Z',
      participants: initial.participants.map((participant) => ({ ...participant, isReady: true })) };
    const notReady = { ...initial, updatedAt: '2026-10-10T12:00:00.002Z',
      participants: initial.participants.map((participant) => ({ ...participant, isReady: false })) };
    const accepted = mergeSessionSummary(initial, notReady);
    expect(mergeSessionSummary(accepted, ready)).toBe(accepted);
    expect(accepted.participants[0].isReady).toBe(false);
  });

  it('accepts a newer snapshot and clears only the old turn locks', () => {
    const current = { ...summary(), pendingPlayerIds: ['player-1'] };
    const snapshot = summary(3).latestSnapshot!;
    const merged = mergeSessionSnapshot(current, snapshot);
    expect(merged.stateVersion).toBe(3);
    expect(merged.latestSnapshot).toBe(snapshot);
    expect(merged.pendingPlayerIds).toEqual([]);
    expect(mergeSessionSnapshot(merged, current.latestSnapshot!)).toBe(merged);
    expect(mergeSessionSnapshot(merged, snapshot)).toBe(merged);
    expect(mergeSessionSnapshot(merged, summary(4, 'mission-b').latestSnapshot!)).toBe(merged);
  });

  it('cannot revive abandoned or ended sessions with delayed summaries/snapshots', () => {
    const abandoned: SessionSummary = { ...summary(), status: 'abandoned' };
    const ended: SessionSummary = { ...summary(), status: 'ended' };
    expect(mergeSessionSummary(abandoned, summary(3))).toBe(abandoned);
    expect(mergeSessionSnapshot(abandoned, summary(3).latestSnapshot!)).toBe(abandoned);
    expect(mergeSessionSummary(ended, summary(3))).toBe(ended);
    expect(mergeSessionSnapshot(ended, summary(3).latestSnapshot!)).toBe(ended);
  });

  it('does not switch the authenticated player in a response', () => {
    const session = summary();
    const current: SessionAccess = { session, participant: session.participants[0] };
    expect(mergeSessionAccess(current, { ...current, participant: { ...current.participant, playerId: 'player-2' } })).toBe(current);
  });
});
