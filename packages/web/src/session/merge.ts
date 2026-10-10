import type { GameStateSnapshotV1 } from '@gravity/core';

import type { SessionAccess, SessionSummary } from './types';

/**
 * Purpose: Merge one server summary without letting delayed replies rewind a mission.
 * Parameters: Current and incoming summaries for the same session.
 * Returns: The accepted summary, or the unchanged current reference for obsolete work.
 * Side effects: None; pending seats are monotonic within a committed turn.
 */
export function mergeSessionSummary(current: SessionSummary, incoming: SessionSummary): SessionSummary {
  if (incoming.id !== current.id || incoming.stateVersion < current.stateVersion) return current;
  if (current.status === 'abandoned' || (current.status === 'ended' && incoming.status !== 'ended')) return current;
  if (incoming.stateVersion === current.stateVersion) {
    if (current.status !== 'lobby' && incoming.status === 'lobby') return current;
    if (Date.parse(incoming.updatedAt) < Date.parse(current.updatedAt)) return current;
    // A plan cannot unlock before a newer committed version. Delayed equal-version
    // responses must not re-enable submission or erase another player's lock.
    const pendingPlayerIds = Array.from(new Set([...current.pendingPlayerIds, ...incoming.pendingPlayerIds]));
    return {
      ...incoming,
      pendingPlayerIds,
      latestSnapshot: current.latestSnapshot ?? incoming.latestSnapshot,
    };
  }
  return incoming;
}

/**
 * Purpose: Keep a caller's identity attached to the accepted server membership.
 * Parameters: Current access and a response for that same session and participant.
 * Returns: Monotonic access, retaining the original reference for rejected responses.
 * Side effects: None; session replacement is an explicit controller lifecycle operation.
 */
export function mergeSessionAccess(current: SessionAccess, incoming: SessionAccess): SessionAccess {
  if (incoming.participant.playerId !== current.participant.playerId) return current;
  const session = mergeSessionSummary(current.session, incoming.session);
  if (session === current.session) return current;
  const participant = session.participants.find((member) => member.playerId === current.participant.playerId);
  return { session, participant: participant ?? current.participant };
}

/**
 * Purpose: Accept only a strictly newer committed snapshot for the bound session.
 * Parameters: Current summary and the independently delivered server snapshot.
 * Returns: Updated summary, or the current reference for stale/foreign/terminal data.
 * Side effects: None; only a new turn clears pending player locks.
 */
export function mergeSessionSnapshot(current: SessionSummary, snapshot: GameStateSnapshotV1): SessionSummary {
  if (
    snapshot.game.id !== current.id ||
    snapshot.stateVersion <= current.stateVersion ||
    current.status === 'abandoned' ||
    current.status === 'ended'
  ) return current;
  return {
    ...current,
    stateVersion: snapshot.stateVersion,
    latestSnapshot: snapshot,
    status: snapshot.game.status === 'completed' ? 'ended' : 'active',
    pendingPlayerIds: [],
  };
}
