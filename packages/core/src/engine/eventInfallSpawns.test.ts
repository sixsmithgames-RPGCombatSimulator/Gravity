import { describe, expect, it } from 'vitest';

import type { AnyCrew, Captain } from '../models/Crew';
import type { GameSettings } from '../models/Game';
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
    const numSpaces = outerRing!.numSpaces;

    const spaces = after.board.objects.map(obj => obj.position.space);
    const unique = new Set(spaces);
    expect(unique.size).toBe(spaces.length);

    const isAdjacent = (a: number, b: number): boolean => {
      const diff = Math.abs(a - b);
      return diff === 1 || diff === numSpaces - 1;
    };

    for (let i = 0; i < spaces.length; i += 1) {
      for (let j = i + 1; j < spaces.length; j += 1) {
        expect(isAdjacent(spaces[i]!, spaces[j]!)).toBe(false);
      }
    }
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
});
