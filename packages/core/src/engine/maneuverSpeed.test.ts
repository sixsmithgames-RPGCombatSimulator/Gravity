/**
 * Purpose: Verify maneuver updates ship speed/velocity based on direction.
 * Root cause: Moving backward (negative direction) previously left speed unchanged.
 */
import { describe, expect, it } from 'vitest';

import { SHIP_SECTIONS } from '../constants/GameConfig';
import type { AnyCrew, Captain } from '../models/Crew';
import type { GameSettings } from '../models/Game';
import type { Ship } from '../models/Ship';
import { addPlayerToGame, createInitialShip, createNewGame, startGame } from './index';
import { previewManeuver } from './index';

function createStarter(ship: Ship) {
  const settings: GameSettings = {
    maxPlayers: 2,
    rotationDirection: 'clockwise',
    expansions: ['core'],
  };

  const createdAt = new Date('2026-01-01T00:00:00.000Z');

  let game = createNewGame({
    id: 'maneuver-speed-test-game',
    createdAt,
    settings,
    boardSpeedByRing: [1, 1, 1, 1, 1, 1, 1, 1],
  });

  const crew: AnyCrew[] = [
    {
      id: 'crew-1',
      name: 'Pilot',
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
  ];

  const captain: Captain = {
    id: 'captain-1',
    name: 'Captain',
    type: 'captain',
    captainType: 'merchant',
    status: 'active',
    location: SHIP_SECTIONS.BRIDGE,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  };

  game = addPlayerToGame(game, {
    id: 'player-1',
    userId: 'user-1',
    isBot: false,
    ship,
    crew,
    captain,
  });

  game = startGame(game, { startedAt: createdAt });
  return game;
}

describe('maneuver speed/velocity updates', () => {
  it('sets positive speed when moving forward', () => {
    const baseShip = createInitialShip({ ring: 3, space: 0 });
    const ship: Ship = { ...baseShip, speed: 0 };
    const game = createStarter(ship);

    const { updatedShip } = previewManeuver(
      game.players.get('player-1')!.ship,
      game.players.get('player-1')!.crew[0],
      'forward',
      2,
      game.board,
    );

    expect(updatedShip.speed).toBe(2);
  });

  it('sets negative speed when moving backward', () => {
    const baseShip = createInitialShip({ ring: 3, space: 0 });
    const ship: Ship = { ...baseShip, speed: 3 };
    const game = createStarter(ship);

    const { updatedShip } = previewManeuver(
      game.players.get('player-1')!.ship,
      game.players.get('player-1')!.crew[0],
      'backward',
      2,
      game.board,
    );

    expect(updatedShip.speed).toBe(-2);
  });

  it('keeps speed unchanged for inward/outward moves (radial, not tangential)', () => {
    const baseShip = createInitialShip({ ring: 3, space: 2 });
    const ship: Ship = { ...baseShip, speed: 4 };
    const game = createStarter(ship);

    const { updatedShip } = previewManeuver(
      game.players.get('player-1')!.ship,
      game.players.get('player-1')!.crew[0],
      'inward',
      1,
      game.board,
    );

    expect(updatedShip.speed).toBe(4);
  });
});
