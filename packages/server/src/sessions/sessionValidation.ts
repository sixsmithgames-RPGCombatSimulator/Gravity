import {
  applyPlayerActions,
  deserializeGameStateSnapshot,
  type GameStateSnapshotV1,
  type PlayerAction,
  type TurnActions,
} from '@gravity/core';

import { SessionError } from './errors';
import type { SessionRecord } from './types';

/**
 * Purpose: Reject an invalid complete player plan before its durable pending lock is written.
 * Parameters: The locked committed snapshot, authenticated player id, and that player's proposed actions.
 * Returns: Nothing when canonical action resolution accepts the plan; otherwise throws INVALID_ACTION.
 * Side effects: None. Resolution uses a detached snapshot and deterministic core seeds; its result is discarded.
 * Root cause: Deferring all validation until the final player's submission permanently locked invalid earlier plans.
 */
export function validateSessionPlan(snapshot: GameStateSnapshotV1, playerId: string, actions: PlayerAction[]): void {
  try {
    const game = deserializeGameStateSnapshot(structuredClone(snapshot)).game;
    const player = game.players.get(playerId);
    if (game.status !== 'in_progress' || game.turnPhase !== 'action_planning' || player?.status !== 'active') {
      throw new Error('The committed game is not accepting a plan from this active player.');
    }
    if (actions.some((action) => action.playerId !== playerId)) {
      throw new Error('A proposed action belongs to another participant.');
    }
    const plans: TurnActions = Object.fromEntries(
      Array.from(game.players.values())
        .filter((member) => member.status === 'active')
        .map((member) => [member.id, member.id === playerId ? structuredClone(actions) : []]),
    );
    // Resolve the whole plan in canonical order so Restore/Route can enable its later actions.
    applyPlayerActions({ ...game, turnPhase: 'action_execution' }, plans);
  } catch (error) {
    throw new SessionError(
      'INVALID_ACTION',
      error instanceof Error ? error.message : 'Canonical plan validation rejected the proposed actions.',
      400,
    );
  }
}

/**
 * Purpose: Fence launch against readiness and roster changes under the repository's session lock.
 * Parameters: The current locked lobby, the service-authored launch snapshot, and its observed update time.
 * Returns: Nothing when the snapshot still describes the ready roster; otherwise throws a conflict.
 * Side effects: None. Player identity comparison also catches changes within the same timestamp millisecond.
 */
export function assertLaunchSnapshotMatchesLobby(
  session: SessionRecord,
  snapshot: GameStateSnapshotV1,
  expectedUpdatedAt: Date,
): void {
  if (session.status !== 'lobby' || session.latestSnapshot || session.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw new SessionError('CONFLICT', 'The lobby changed or started while launch was being committed. Review the roster and launch again.', 409);
  }
  if (session.participants.length !== session.maxPlayers || session.participants.some((member) => !member.isReady)) {
    throw new SessionError('NOT_READY', 'Every configured player seat must still be filled and ready before launch.', 409);
  }
  if (
    snapshot.game.id !== session.id ||
    snapshot.game.players.length !== session.participants.length ||
    session.participants.some((member) => !snapshot.game.players.some((player) =>
      player.id === member.playerId && player.isBot === member.isBot && player.userId === member.userId,
    ))
  ) {
    throw new SessionError('CONFLICT', 'The player roster changed while launch was being committed. Review the roster and launch again.', 409);
  }
}
