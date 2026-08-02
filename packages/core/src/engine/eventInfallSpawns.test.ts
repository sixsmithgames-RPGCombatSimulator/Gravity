import { describe, expect, it } from 'vitest';

import type { AnyCrew, Captain } from '../models/Crew';
import type { GameSettings } from '../models/Game';
import { BoardUtils } from '../models';
import { INFALL_CONFIG, SHIP_SECTIONS } from '../constants/GameConfig';
import { addPlayerToGame, applyEventPhase, createInitialShip, createNewGame, startGame } from './index';

function createGameWithPlayers(params: { gameId: string; playerCount: number }) {
  const settings: GameSettings = {
    maxPlayers: params.playerCount,
    rotationDirection: 'clockwise',
    expansions: ['core'],
  };

  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const boardSpeedByRing = [1, 1, 1, 1, 1, 1, 1, 1];

  let game = createNewGame({
    id: params.gameId,
    createdAt,
    settings,
    boardSpeedByRing,
  });

  for (let index = 0; index < params.playerCount; index += 1) {
    const crew: AnyCrew = {
      id: `crew-${index + 1}`,
      name: `Crew ${index + 1}`,
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const captain: Captain = {
      id: `captain-${index + 1}`,
      name: `Captain ${index + 1}`,
      type: 'captain',
      captainType: 'merchant',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    game = addPlayerToGame(game, {
      id: `player-${index + 1}`,
      userId: `user-${index + 1}`,
      isBot: false,
      ship: createInitialShip({ ring: 8, space: 0 }),
      crew: [crew],
      captain,
    });
  }

  game = startGame(game, { startedAt: createdAt });

  return game;
}

function getMinimumDistanceToShips(game: ReturnType<typeof createGameWithPlayers>, ring: number, space: number): number {
  const position = { ring, space };
  const shipPositions = Array.from(game.players.values()).map((player) => player.ship.position);

  return Math.min(
    ...shipPositions.map((shipPosition) => BoardUtils.calculateDistance(position, shipPosition, game.board)),
  );
}

describe('event infall object spawns', () => {
  it.each([2, 3, 4, 5, 6])('starts a supported %i-player game with unique, balanced positions', (playerCount) => {
    const started = createGameWithPlayers({
      gameId: `supported-player-count-${playerCount}`,
      playerCount,
    });
    const spaces = Array.from(started.players.values())
      .map((player) => player.ship.position.space)
      .sort((left, right) => left - right);
    const ringSize = started.board.rings.at(-1)!.numSpaces;
    const circularGaps = spaces.map((space, index) => {
      const nextSpace = spaces[(index + 1) % spaces.length];
      return index === spaces.length - 1
        ? nextSpace + ringSize - space
        : nextSpace - space;
    });

    expect(new Set(spaces).size).toBe(playerCount);
    expect(Math.max(...circularGaps) - Math.min(...circularGaps)).toBeLessThanOrEqual(1);
  });

  it('does not spawn objects on non-event turns', () => {
    const started = createGameWithPlayers({ gameId: 'event-infall-non-event', playerCount: 2 });

    const game = {
      ...started,
      currentTurn: 3,
      eventDeck: [],
    };

    const after = applyEventPhase(game);
    expect(after.board.objects.length).toBe(0);
  });

  it('is deterministic for a given game id + turn', () => {
    const startedA = createGameWithPlayers({ gameId: 'event-infall-deterministic', playerCount: 2 });
    const startedB = createGameWithPlayers({ gameId: 'event-infall-deterministic', playerCount: 2 });

    const gameA = {
      ...startedA,
      currentTurn: 4,
      eventDeck: [],
    };

    const gameB = {
      ...startedB,
      currentTurn: 4,
      eventDeck: [],
    };

    const afterA = applyEventPhase(gameA);
    const afterB = applyEventPhase(gameB);

    expect(afterA.board.objects).toEqual(afterB.board.objects);
  });

  it('spawns playerCount + 3 objects on event turns, starting on the outer ring', () => {
    const started = createGameWithPlayers({ gameId: 'event-infall-2p', playerCount: 2 });

    const game = {
      ...started,
      currentTurn: 4,
      eventDeck: [],
    };

    const after = applyEventPhase(game);

    expect(after.board.objects).toHaveLength(5);

    for (const obj of after.board.objects) {
      expect(obj.position.ring).toBe(8);
      expect(['debris', 'asteroid_cluster', 'hazard', 'wrecked_ship']).toContain(obj.type);
    }
  });

  it('spreads infall spawns around the outer ring (avoids adjacent clusters when possible)', () => {
    const started = createGameWithPlayers({ gameId: 'event-infall-spread-2p', playerCount: 2 });

    const game = {
      ...started,
      currentTurn: 4,
      eventDeck: [],
    };

    const after = applyEventPhase(game);

    const outerRing = after.board.rings[7];
    expect(outerRing).toBeTruthy();

    const spaces = after.board.objects.map(obj => obj.position.space);
    const unique = new Set(spaces);
    expect(unique.size).toBe(spaces.length);

    const availableDistances: number[] = [];
    for (let space = 0; space < outerRing!.numSpaces; space += 1) {
      const occupiedByShip = Array.from(started.players.values()).some(
        (player) => player.ship.position.ring === outerRing!.index && player.ship.position.space === space,
      );

      if (occupiedByShip) {
        continue;
      }

      availableDistances.push(getMinimumDistanceToShips(started, outerRing!.index, space));
    }

    const selectedDistances = after.board.objects
      .map((obj) => getMinimumDistanceToShips(started, obj.position.ring, obj.position.space))
      .sort((left, right) => right - left);
    const bestAvailableDistances = [...availableDistances]
      .sort((left, right) => right - left)
      .slice(0, selectedDistances.length);

    expect(selectedDistances).toEqual(bestAvailableDistances);
  });

  it('scales spawn count with playerCount using the fixed rules bonus', () => {
    const started = createGameWithPlayers({ gameId: 'event-infall-3p', playerCount: 3 });

    const game = {
      ...started,
      currentTurn: 4,
      eventDeck: [],
    };

    const after = applyEventPhase(game);

    expect(after.board.objects).toHaveLength(6);
  });

  it('never spawns an object on a player ship position (safety guard)', () => {
    const started = createGameWithPlayers({ gameId: 'event-infall-no-ship-overlap', playerCount: 2 });

    const game = {
      ...started,
      currentTurn: 4,
      eventDeck: [],
    };

    const after = applyEventPhase(game);

    const shipPositions = new Set(
      Array.from(after.players.values()).map(player => `${player.ship.position.ring}:${player.ship.position.space}`),
    );

    for (const obj of after.board.objects) {
      const key = `${obj.position.ring}:${obj.position.space}`;
      expect(shipPositions.has(key)).toBe(false);
    }
  });

  it('places infall before resolving the drawn Event card', () => {
    const started = createGameWithPlayers({ gameId: 'event-infall-after-player-flux', playerCount: 2 });

    const game = {
      ...started,
      currentTurn: 4,
      eventDeck: [
        {
          id: 'event_gravity_flux_players_forward',
          name: 'Gravity Flux',
          description: 'Move players forward',
          effects: { kind: 'gravity_flux_players_forward' },
        },
      ],
    };

    const withoutEvent = applyEventPhase({
      ...started,
      currentTurn: 4,
      eventDeck: [],
    });
    const after = applyEventPhase(game);

    expect(after.board.objects).toEqual(withoutEvent.board.objects);
    expect(Array.from(after.players.values()).map((player) => player.ship.position)).not.toEqual(
      Array.from(started.players.values()).map((player) => player.ship.position),
    );
  });

  it('uses the documented weighted object mix after reserving one hazard', () => {
    expect(INFALL_CONFIG.REQUIRED_HAZARD_COUNT).toBe(1);
    expect(INFALL_CONFIG.OBJECT_TYPE_WEIGHTS).toEqual([
      { type: 'asteroid_cluster', weight: 0.35 },
      { type: 'debris', weight: 0.4 },
      { type: 'wrecked_ship', weight: 0.25 },
    ]);
  });

  it('adds exactly one hazard to every complete infall set', () => {
    const started = createGameWithPlayers({ gameId: 'event-infall-one-hazard', playerCount: 4 });
    const after = applyEventPhase({
      ...started,
      currentTurn: 4,
      eventDeck: [],
    });

    expect(after.board.objects).toHaveLength(7);
    expect(after.board.objects.filter((object) => object.type === 'hazard')).toHaveLength(1);
  });

  it('gravity flux object movement never lands on a player ship', () => {
    const started = createGameWithPlayers({ gameId: 'event-gravity-flux-ship-avoid', playerCount: 2 });

    // Seed initial objects adjacent to ships to force movement over ship spaces
    const objectA = {
      id: 'obj-a',
      type: 'hazard' as const,
      position: { ...started.players.get('player-1')!.ship.position },
    };

    const objectB = {
      id: 'obj-b',
      type: 'debris' as const,
      position: { ...started.players.get('player-2')!.ship.position },
    };

    const game = {
      ...started,
      currentTurn: 4,
      eventDeck: [
        {
          id: 'event_gravity_flux_objects_forward',
          name: 'Gravity Flux',
          description: 'Move objects forward',
          effects: { kind: 'gravity_flux_objects_forward' },
        },
      ],
      board: {
        ...started.board,
        objects: [objectA as any, objectB as any],
      },
    };

    const after = applyEventPhase(game);

    const shipPositions = new Set(
      Array.from(after.players.values()).map(player => `${player.ship.position.ring}:${player.ship.position.space}`),
    );

    for (const obj of after.board.objects) {
      const key = `${obj.position.ring}:${obj.position.space}`;
      expect(shipPositions.has(key)).toBe(false);
    }
  });
});
