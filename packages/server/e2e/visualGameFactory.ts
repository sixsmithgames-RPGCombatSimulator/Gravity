import { gravitySessionGameFactory } from '../src/sessions/gravitySessionGameFactory';
import type { SessionGameFactory } from '../src/sessions/types';

/**
 * Purpose: Keep browser screenshot scenarios reproducible without giving the
 * browser authority over game state. Parameters: The real durable lobby seats.
 * Returns: A canonical server-created snapshot with fixed opening deck seeds.
 * Side effects: None. This module is reachable only from the loopback harness.
 * IDs are restored to the actual session after seeding; membership and all
 * subsequent REST/socket operations still use the normal server contracts.
 */
export const VISUAL_GAME_FACTORY: SessionGameFactory = {
  create(params) {
    const snapshot = gravitySessionGameFactory.create({
      ...params,
      sessionId: '70f2ac42-13de-4f21-9467-3a33aa1c0101',
      now: new Date('2026-10-10T12:00:00.000Z'),
    });
    return { ...snapshot, game: { ...snapshot.game, id: params.sessionId } };
  },
};
