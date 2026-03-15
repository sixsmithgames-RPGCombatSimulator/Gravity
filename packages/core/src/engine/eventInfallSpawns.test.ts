import { describe, expect, it } from 'vitest';

import type { AnyCrew, Captain } from '../models/Crew';
import type { GameSettings } from '../models/Game';
import { BoardUtils } from '../models';
import { SHIP_SECTIONS } from '../constants/GameConfig';
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

  it('spawns between 1x and 2x playerCount objects on event turns, starting on the outer ring', () => {
    const started = createGameWithPlayers({ gameId: 'event-infall-2p', playerCount: 2 });

    const game = {
      ...started,
      currentTurn: 4,
      eventDeck: [],
    };

    const after = applyEventPhase(game);

    expect(after.board.objects.length).toBeGreaterThanOrEqual(2);
    expect(after.board.objects.length).toBeLessThanOrEqual(5);

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

  it('scales spawn count with playerCount', () => {
    const started = createGameWithPlayers({ gameId: 'event-infall-3p', playerCount: 3 });

    const game = {
      ...started,
      currentTurn: 4,
      eventDeck: [],
    };

    const after = applyEventPhase(game);

    expect(after.board.objects.length).toBeGreaterThanOrEqual(3);
    expect(after.board.objects.length).toBeLessThanOrEqual(6);
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

  it('uses post-event ship positions when selecting infall spawn spaces', () => {
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

    const after = applyEventPhase(game);

    const shipPositions = new Set(
      Array.from(after.players.values()).map(player => `${player.ship.position.ring}:${player.ship.position.space}`),
    );

    for (const obj of after.board.objects) {
      const key = `${obj.position.ring}:${obj.position.space}`;
      expect(shipPositions.has(key)).toBe(false);
    }
  });

  it('places the infall hazard at the maximum available distance from ships on the outer ring', () => {
    const started = createGameWithPlayers({ gameId: 'event-infall-hazard-distance', playerCount: 2 });

    const game = {
      ...started,
      currentTurn: 4,
      eventDeck: [],
    };

    const after = applyEventPhase(game);
    const hazard = after.board.objects.find((obj) => obj.type === 'hazard');

    expect(hazard).toBeTruthy();

    const outerRing = started.board.rings[started.board.rings.length - 1];
    expect(outerRing).toBeTruthy();

    const candidateDistances: number[] = [];
    for (let space = 0; space < outerRing!.numSpaces; space += 1) {
      const occupiedByShip = Array.from(started.players.values()).some(
        (player) => player.ship.position.ring === outerRing!.index && player.ship.position.space === space,
      );

      if (occupiedByShip) {
        continue;
      }

      candidateDistances.push(getMinimumDistanceToShips(started, outerRing!.index, space));
    }

    const hazardDistance = getMinimumDistanceToShips(
      after as ReturnType<typeof createGameWithPlayers>,
      hazard!.position.ring,
      hazard!.position.space,
    );

    expect(hazardDistance).toBe(Math.max(...candidateDistances));
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
