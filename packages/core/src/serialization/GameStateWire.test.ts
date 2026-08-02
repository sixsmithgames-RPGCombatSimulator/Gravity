import { describe, expect, it } from 'vitest';

import type { AnyCrew, Captain, GameSettings, PlayerState } from '../models';
import { SHIP_SECTIONS } from '../constants';
import { addPlayerToGame, createInitialShip, createNewGame, startGame } from '../engine';
import {
  decodeGameStateSnapshot,
  deserializeGameStateSnapshot,
  encodeGameStateSnapshot,
  GAME_STATE_WIRE_VERSION,
  serializeGameStateSnapshot,
} from './GameStateWire';

function createSnapshotGame() {
  const settings: GameSettings = {
    maxPlayers: 2,
    rotationDirection: 'clockwise',
    expansions: ['core'],
  };
  const createdAt = new Date('2026-08-01T12:00:00.000Z');
  let game = createNewGame({
    id: 'wire-game',
    createdAt,
    settings,
    boardSpeedByRing: [4, 3, 3, 2, 2, 1, 1, 1],
  });

  for (let index = 2; index >= 1; index -= 1) {
    const captain: Captain = {
      id: `captain-${index}`,
      name: `Captain ${index}`,
      type: 'captain',
      captainType: 'merchant',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };
    const crew: AnyCrew = {
      id: `crew-${index}`,
      name: `Crew ${index}`,
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    game = addPlayerToGame(game, {
      id: `player-${index}`,
      userId: `user-${index}`,
      isBot: false,
      botStrategy: undefined,
      ship: createInitialShip({ ring: 8, space: 0 }),
      crew: [crew],
      captain,
    });
  }

  return startGame(game, { startedAt: new Date('2026-08-01T12:05:00.000Z') });
}

describe('game-state wire snapshots', () => {
  it('round-trips Maps and Dates through JSON without losing runtime types', () => {
    const game = createSnapshotGame();
    const decoded = decodeGameStateSnapshot(encodeGameStateSnapshot(game, 7));

    expect(decoded.stateVersion).toBe(7);
    expect(decoded.game.players).toBeInstanceOf(Map);
    expect(decoded.game.createdAt).toBeInstanceOf(Date);
    expect(decoded.game.startedAt).toBeInstanceOf(Date);
    expect(decoded.game).toEqual(game);
  });

  it('sorts players deterministically by player order', () => {
    const snapshot = serializeGameStateSnapshot(createSnapshotGame(), 0);

    expect(snapshot.schemaVersion).toBe(GAME_STATE_WIRE_VERSION);
    expect(snapshot.game.players.map((player) => player.id)).toEqual(['player-2', 'player-1']);
  });

  it('rejects unsupported schema versions', () => {
    const snapshot = serializeGameStateSnapshot(createSnapshotGame(), 1) as unknown as Record<string, unknown>;
    snapshot.schemaVersion = 999;

    expect(() => deserializeGameStateSnapshot(snapshot)).toThrow(/schema version is unsupported/i);
  });

  it('rejects duplicate player ids at the transport boundary', () => {
    const snapshot = serializeGameStateSnapshot(createSnapshotGame(), 1);
    snapshot.game.players.push(snapshot.game.players[0]);

    expect(() => deserializeGameStateSnapshot(snapshot)).toThrow(/player id is duplicated/i);
  });

  it('rejects a mismatched runtime Map key before serialization', () => {
    const game = createSnapshotGame();
    const firstPlayer = game.players.values().next().value as PlayerState;
    game.players.delete(firstPlayer.id);
    game.players.set('wrong-key', firstPlayer);

    expect(() => serializeGameStateSnapshot(game, 1)).toThrow(/Map key does not match/i);
  });
});
