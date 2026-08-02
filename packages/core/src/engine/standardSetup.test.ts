import { describe, expect, it } from 'vitest';

import { SHIP_SECTIONS } from '../constants';
import type { AnyCrew, Captain } from '../models';
import { addPlayerToGame, createInitialShip, createNewGame, seedStandardBoardObjects, startGame } from './index';

function captain(id: string): Captain {
  return {
    id: `${id}:captain`,
    name: 'Captain',
    type: 'captain',
    captainType: 'merchant',
    status: 'active',
    location: SHIP_SECTIONS.BRIDGE,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  };
}

function crew(id: string): AnyCrew[] {
  return [{
    id: `${id}:crew`,
    name: 'Crew',
    type: 'basic',
    role: 'pilot',
    status: 'unconscious',
    location: null,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  }];
}

describe('standard board setup', () => {
  it('places canonical objects and keeps starting ship spaces unoccupied', () => {
    let game = createNewGame({
      id: 'standard-setup',
      createdAt: new Date('2026-08-01T12:00:00.000Z'),
      settings: { maxPlayers: 6, rotationDirection: 'clockwise', expansions: ['core'] },
      boardSpeedByRing: [4, 3, 3, 2, 2, 1, 1, 1],
    });
    for (let index = 1; index <= 6; index += 1) {
      const id = `player-${index}`;
      game = addPlayerToGame(game, {
        id,
        userId: `user-${index}`,
        isBot: false,
        ship: createInitialShip({ ring: 8, space: 0 }),
        captain: captain(id),
        crew: crew(id),
      });
    }

    game = seedStandardBoardObjects(game);
    game = startGame(game, { startedAt: new Date('2026-08-01T12:01:00.000Z') });

    expect(game.board.objects.filter((object) => object.type === 'hazard')).toHaveLength(2);
    expect(game.board.objects.filter((object) => object.type === 'asteroid_cluster')).toHaveLength(5);
    expect(game.board.objects.filter((object) => object.type === 'debris')).toHaveLength(4);
    expect(game.board.objects.filter((object) => object.type === 'hostile_ship')).toHaveLength(6);
    expect(game.board.objects.filter((object) => object.type === 'wrecked_ship')).toHaveLength(6);

    const occupiedObjects = new Set(
      game.board.objects.map((object) => `${object.position.ring}:${object.position.space}`),
    );
    for (const player of game.players.values()) {
      expect(occupiedObjects.has(`${player.ship.position.ring}:${player.ship.position.space}`)).toBe(false);
    }
  });
});
