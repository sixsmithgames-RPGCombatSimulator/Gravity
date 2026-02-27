import type {
  GameState,
  PlayerState,
  Ship,
  Captain,
  AnyCrew,
  GameSettings,
  AnySpaceObject,
} from '@gravity/core';
import {
  SHIP_SECTIONS,
  BOARD_CONFIG,
  createInitialShip,
  createNewGame,
  addPlayerToGame,
  startGame,
} from '@gravity/core';

export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * Create a mock game state for UI development and testing
 * Purpose: Provide realistic game data without needing a server
 *
 * This creates a game with:
 * - 1 human player + 1 bot player
 * - Ships at different positions on the board
 * - Various space objects (hazards, asteroids, hostiles)
 * - Sample crew with different roles and states
 *
 * Note: Uses engine helpers to match canonical GameState shape, then patches in
 *       mock crew/captain/resources for development UX.
 */
export function createMockGame(difficulty: Difficulty): GameState {
  const playerId = 'player-1';
  const botId = 'bot-1';

  const settings: GameSettings = {
    maxPlayers: 4,
    rotationDirection: 'clockwise',
    expansions: ['core'],
  };

  // Derive a simple speed profile per ring (matches previous mock formula)
  const boardSpeedByRing: number[] = Array.from(
    { length: BOARD_CONFIG.NUM_RINGS },
    (_ignored, index) => {
      const ringIndex = index + 1;
      return Math.max(1, 4 - Math.floor(ringIndex / 2));
    },
  );

  // Create canonical game via engine
  let game = createNewGame({
    id: 'game-mock-001',
    createdAt: new Date(),
    settings,
    boardSpeedByRing,
  });

  // Player ship and crew
  const playerShip = createMockShip({ ring: 1, space: 0 }, difficulty);
  const playerCrew = createMockCrew();
  const playerCaptain = createMockCaptain();

  // Bot ship and crew
  const botShip = createMockShip({ ring: 1, space: 0 }, difficulty);
  const botCrew = createMockCrew();
  const botCaptain = createMockCaptain();

  game = addPlayerToGame(game, {
    id: playerId,
    userId: 'user-123',
    isBot: false,
    botStrategy: undefined,
    ship: playerShip,
    crew: playerCrew,
    captain: playerCaptain,
  });

  game = addPlayerToGame(game, {
    id: botId,
    userId: null,
    isBot: true,
    botStrategy: 'survival',
    ship: botShip,
    crew: botCrew,
    captain: botCaptain,
  });

  game = seedInitialObjects(game);

  // Start game to place ships on board and mark players active
  game = startGame(game, { startedAt: new Date() });

  // Patch in mock missions for dev UX (resources remain at engine defaults)
  const players = new Map<string, PlayerState>();

  for (const player of game.players.values()) {
    if (player.id === playerId) {
      players.set(player.id, {
        ...player,
        missions: [
          {
            id: 'mission-1',
            name: 'Escape the Gravity Well',
            description: 'Reach the outer ring to escape',
            objectives: {
              primary: { description: 'Reach ring 8', points: 10, completed: false },
              secondary: { description: 'With all crew alive', points: 5, completed: false },
            },
          },
        ],
      });
    } else if (player.id === botId) {
      players.set(player.id, {
        ...player,
      });
    } else {
      players.set(player.id, player);
    }
  }

  return {
    ...game,
    players,
  };
}

/**
 * Seed initial board objects for mock game
 * Note: Dev-only helper; production setups should use a dedicated engine helper.
 */
function seedInitialObjects(game: GameState): GameState {
  const objects: AnySpaceObject[] = [];

  // Track occupied spaces per ring to avoid overlapping objects.
  // Key = ring index (1-based), Value = set of occupied space indices.
  const occupiedByRing = new Map<number, Set<number>>();

  // Reserve the ship start positions used by startGame() so we don't seed
  // objects onto the spaces where ships will be placed.
  const outerRing = game.board.rings[game.board.rings.length - 1];
  const startingPlayerCount = game.players.size;
  if (outerRing && outerRing.numSpaces > 0 && startingPlayerCount > 0) {
    if (!occupiedByRing.has(outerRing.index)) {
      occupiedByRing.set(outerRing.index, new Set());
    }
    const occupied = occupiedByRing.get(outerRing.index)!;

    const spacing = outerRing.numSpaces / startingPlayerCount;
    const sortedPlayers = Array.from(game.players.values()).sort(
      (a, b) => a.playerOrder - b.playerOrder,
    );

    for (let index = 0; index < sortedPlayers.length; index += 1) {
      const space = index * spacing;
      // startGame throws if this isn't an integer; keep the same behavior here.
      if (!Number.isInteger(space)) {
        continue;
      }
      occupied.add(space);
    }
  }

  /**
   * Place `count` objects of `type` on `ring`, avoiding already-occupied spaces.
   * Distributes objects as evenly as possible around the ring circumference.
   */
  const addSpread = (type: AnySpaceObject['type'], ring: number, count: number) => {
    const boardRing = game.board.rings[ring - 1];
    if (!boardRing || count <= 0) {
      return;
    }

    if (!occupiedByRing.has(ring)) {
      occupiedByRing.set(ring, new Set());
    }
    const occupied = occupiedByRing.get(ring)!;

    // Build list of free spaces
    const freeSpaces: number[] = [];
    for (let s = 0; s < boardRing.numSpaces; s += 1) {
      if (!occupied.has(s)) {
        freeSpaces.push(s);
      }
    }

    // Pick evenly-spaced indices from the free list
    const step = Math.max(1, Math.floor(freeSpaces.length / count));
    let placed = 0;
    for (let i = 0; placed < count && i < freeSpaces.length; i += step) {
      const space = freeSpaces[i];
      occupied.add(space);

      const base: AnySpaceObject = {
        id: `${type}-${ring}-${placed}`,
        type,
        position: { ring, space },
      } as AnySpaceObject;

      if (type === 'hostile_ship') {
        objects.push({ ...base, type: 'hostile_ship', hull: 8, hasTorpedo: true } as AnySpaceObject);
      } else {
        objects.push(base);
      }
      placed += 1;
    }
  };

  // Hazards: 2 objects on ring 4 (12 spaces)
  addSpread('hazard', 4, 2);

  // Asteroid clusters: 3 on ring 5 (14 spaces), 2 on ring 7 (18 spaces)
  addSpread('asteroid_cluster', 5, 3);
  addSpread('asteroid_cluster', 7, 2);

  // Debris: 2 on ring 4, 2 on ring 6 (14 spaces)
  addSpread('debris', 4, 2);
  addSpread('debris', 6, 2);

  const objectPlayerCount = game.players.size || 2;

  // Hostile ships: (number of players) on ring 3 (12 spaces)
  addSpread('hostile_ship', 3, objectPlayerCount);

  // Wrecked ships: (number of players) on ring 5
  addSpread('wrecked_ship', 5, objectPlayerCount);

  // Functional stations: 1 at start
  addSpread('functional_station', 6, 1);

  return {
    ...game,
    board: {
      ...game.board,
      objects,
    },
  };
}

// Note: Board is now created by the engine via createNewGame; no additional
// mock board helper is required here.

/**
 * Create mock ship state
 * Note: Delegate to engine's createInitialShip so starting hull/power match INITIAL_SHIP_STATE
 */
function createMockShip(position: { ring: number; space: number }, difficulty: Difficulty): Ship {
  return createInitialShip(position as Ship['position'], difficulty);
}

/**
 * Create mock captain
 */
function createMockCaptain(): Captain {
  return {
    id: 'captain-1',
    name: 'Captain Nova',
    type: 'captain',
    captainType: 'space_pirate',
    status: 'active',
    location: SHIP_SECTIONS.BRIDGE,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  } as Captain;
}

/**
 * Create mock crew roster
 * Note: Using type assertions for flexibility in mock data
 */
function createMockCrew(): AnyCrew[] {
  return [
    {
      id: 'crew-fo-1',
      name: 'First Officer Reyes',
      type: 'officer',
      role: 'first_officer',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
      stimPacksUsed: 0,
    },
    {
      id: 'crew-fo-2',
      name: 'Chief Engineer Singh',
      type: 'officer',
      role: 'chief_engineer',
      status: 'active',
      location: SHIP_SECTIONS.ENGINEERING,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
      stimPacksUsed: 0,
    },
    {
      id: 'crew-pilot',
      name: 'Pilot Chen',
      type: 'basic',
      role: 'pilot',
      status: 'unconscious',
      location: null,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
    {
      id: 'crew-engineer',
      name: 'Engineer Martinez',
      type: 'basic',
      role: 'engineer',
      status: 'unconscious',
      location: null,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
    {
      id: 'crew-medic',
      name: 'Medic Okonkwo',
      type: 'basic',
      role: 'medic',
      status: 'unconscious',
      location: null,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
    {
      id: 'crew-scientist',
      name: 'Scientist Yamamoto',
      type: 'basic',
      role: 'scientist',
      status: 'unconscious',
      location: null,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
    {
      id: 'crew-tactician',
      name: 'Tactician Volkov',
      type: 'basic',
      role: 'tactician',
      status: 'unconscious',
      location: null,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
  ] as AnyCrew[];
}
