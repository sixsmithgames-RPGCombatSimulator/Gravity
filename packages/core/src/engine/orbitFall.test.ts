/**
 * Purpose: Validate orbit fall behavior when ship speed is below requirement
 * and when negative-speed geo-sync ships should remain stationary.
 * Root cause: Ships with insufficient speed were not falling inward with other
 * objects, and negative-speed ships matching the speed requirement should not
 * rotate or fall (geo-sync orbit rule).
 */
import { describe, expect, it } from 'vitest';

import { SHIP_SECTIONS, TURN_CONFIG } from '../constants/GameConfig';
import type { AnyCrew, Captain } from '../models/Crew';
import type { GameSettings } from '../models/Game';
import type { Ship } from '../models/Ship';
import { addPlayerToGame, createInitialShip, createNewGame, startGame, updateOrbitsAndObjects } from './index';

/**
 * Purpose: Build a minimal started game with a single player and provided ship.
 * Parameters:
 *   - ship: Ship state to assign to the test player
 *   - boardSpeedByRing: Speed requirements for each ring
 * Returns: Game state ready for environment/orbit updates
 * Side effects: None (pure setup helper)
 */
function createStartedGame(ship: Ship, boardSpeedByRing: number[]) {
  const settings: GameSettings = {
    maxPlayers: 2,
    rotationDirection: 'clockwise',
    expansions: ['core'],
  };

  const intendedPosition = ship.position;

  const createdAt = new Date('2026-01-01T00:00:00.000Z');

  let game = createNewGame({
    id: 'orbit-fall-test-game',
    createdAt,
    settings,
    boardSpeedByRing,
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

  game = addPlayerToGame(game, {
    id: 'player-2',
    userId: 'user-2',
    isBot: false,
    ship: createInitialShip({ ring: 8, space: 5 }),
    crew: [
      {
        id: 'crew-2',
        name: 'Copilot',
        type: 'basic',
        role: 'pilot',
        status: 'active',
        location: SHIP_SECTIONS.BRIDGE,
        reviveProgress: 0,
        assembleProgress: 0,
        assembleItemType: null,
      },
    ],
    captain: {
      id: 'captain-2',
      name: 'Captain Two',
      type: 'captain',
      captainType: 'merchant',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
  });

  game = startGame(game, { startedAt: createdAt });
  const startedPlayer = game.players.get('player-1');
  if (!startedPlayer) {
    throw new Error('Expected player-1 to exist after startGame in orbitFall test setup.');
  }

  const players = new Map(game.players);
  players.set('player-1', {
    ...startedPlayer,
    ship: {
      ...startedPlayer.ship,
      position: intendedPosition,
    },
  });

  game = {
    ...game,
    players,
    currentTurn: TURN_CONFIG.CYCLE_LENGTH,
  };

  return game;
}

describe('orbit fall and geo-sync handling', () => {
  it('falls inward on cycle turn when speed is below ring requirement', () => {
    const baseShip = createInitialShip({ ring: 3, space: 0 });
    const ship: Ship = {
      ...baseShip,
      speed: 1,
    };

    const speedRequirements = [2, 2, 2, 2, 2, 2, 2, 2];
    const game = createStartedGame(ship, speedRequirements);

    const after = updateOrbitsAndObjects(game);
    const player = after.players.get('player-1');
    expect(player).toBeTruthy();
    if (!player) {
      return;
    }

    expect(player.ship.position.ring).toBe(2);
    // Ring 2 rotates 40 degrees per turn => 1 space clockwise for 9 spaces.
    expect(player.ship.position.space).toBe(1);
  });

  it('stays in geo-sync when speed is negative and matches requirement magnitude', () => {
    const baseShip = createInitialShip({ ring: 2, space: 5 });
    const ship: Ship = {
      ...baseShip,
      speed: -2,
    };

    const speedRequirements = [2, 2, 2, 2, 2, 2, 2, 2];
    const game = createStartedGame(ship, speedRequirements);

    const after = updateOrbitsAndObjects(game);
    const player = after.players.get('player-1');
    expect(player).toBeTruthy();
    if (!player) {
      return;
    }

    expect(player.ship.position.ring).toBe(2);
    expect(player.ship.position.space).toBe(5);
  });
});
