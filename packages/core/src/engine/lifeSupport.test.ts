/**
 * Purpose: Lock the independent life-support pool and its scoring behavior.
 */
import { describe, expect, it } from 'vitest';

import { SHIP_SECTIONS } from '../constants/GameConfig';
import type { AnyCrew, Captain, PlayerState } from '../models';
import {
  calculateLifeSupportBreakdown,
  calculateVictoryPointBreakdown,
  createInitialShip,
  createPlayerState,
} from './index';

function createPlayer(captainType: Captain['captainType'] = 'merchant'): PlayerState {
  const crew: AnyCrew = {
    id: 'crew-1',
    name: 'Pilot',
    type: 'basic',
    role: 'pilot',
    status: 'active',
    location: SHIP_SECTIONS.BRIDGE,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  };
  const captain: Captain = {
    id: 'captain-1',
    name: 'Captain',
    type: 'captain',
    captainType,
    status: 'active',
    location: SHIP_SECTIONS.BRIDGE,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  };

  return createPlayerState({
    id: 'player-1',
    userId: 'user-1',
    isBot: false,
    playerOrder: 1,
    ship: createInitialShip({ ring: 8, space: 0 }),
    crew: [crew],
    captain,
  });
}

describe('life-support pool', () => {
  it('starts with 6 stored power and supports 3 crew', () => {
    const breakdown = calculateLifeSupportBreakdown(createPlayer());

    expect(breakdown.basePoolPower).toBe(6);
    expect(breakdown.totalPower).toBe(6);
    expect(breakdown.powerPerCrew).toBe(2);
    expect(breakdown.capacity).toBe(3);
  });

  it('does not gain capacity when ship sections become fully powered', () => {
    const player = createPlayer();
    const fullyPoweredPlayer: PlayerState = {
      ...player,
      ship: {
        ...player.ship,
        sections: {
          ...player.ship.sections,
          [SHIP_SECTIONS.BRIDGE]: {
            ...player.ship.sections[SHIP_SECTIONS.BRIDGE],
            powerDice: [6],
          },
        },
      },
    };

    expect(calculateLifeSupportBreakdown(fullyPoweredPlayer).capacity).toBe(3);
  });

  it('treats the Explorer benefit as 5 bonus pool power', () => {
    const player = createPlayer('explorer');
    player.ship = { ...player.ship, lifeSupportPower: 0 };

    const breakdown = calculateLifeSupportBreakdown(player);
    expect(breakdown.explorerBonusPower).toBe(5);
    expect(breakdown.totalPower).toBe(5);
    expect(breakdown.capacity).toBe(2);
  });

  it('counts stored life-support pool power in victory points', () => {
    const player = createPlayer();
    const emptyPoolPlayer = {
      ...player,
      ship: { ...player.ship, lifeSupportPower: 0 },
    };

    const withPool = calculateVictoryPointBreakdown(player);
    const withoutPool = calculateVictoryPointBreakdown(emptyPoolPlayer);

    expect(withPool.storedPower - withoutPool.storedPower).toBe(6);
    expect(withPool.total - withoutPool.total).toBe(6);
  });
});
