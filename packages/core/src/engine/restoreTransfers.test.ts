import { describe, expect, it } from 'vitest';

import type { AnyCrew, Captain } from '../models/Crew';
import type { GameSettings, PlayerAction, UpgradeCard } from '../models/Game';
import type { Ship } from '../models/Ship';
import { SHIP_SECTIONS } from '../constants/GameConfig';
import { addPlayerToGame, applyPlayerActions, createInitialShip, createNewGame, startGame } from './index';

function createTwoPlayerGame(params: {
  playerShip: Ship;
  playerCrew: AnyCrew[];
  playerCaptain: Captain;
  installedUpgrades?: UpgradeCard[];
}): {
  game: ReturnType<typeof createNewGame>;
  playerId: string;
  otherPlayerId: string;
} {
  const settings: GameSettings = {
    maxPlayers: 2,
    rotationDirection: 'clockwise',
    expansions: ['core'],
  };

  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const boardSpeedByRing = [1, 1, 1, 1, 1, 1, 1, 1];

  let game = createNewGame({
    id: 'restore-transfer-test-game',
    createdAt,
    settings,
    boardSpeedByRing,
  });

  const playerId = 'player-1';
  const otherPlayerId = 'player-2';

  game = addPlayerToGame(game, {
    id: playerId,
    userId: 'user-1',
    isBot: false,
    ship: params.playerShip,
    crew: params.playerCrew,
    captain: params.playerCaptain,
  });

  const initialPlayer = game.players.get(playerId);
  if (!initialPlayer) {
    throw new Error(
      'Cannot create test game because player-1 was not added. ' +
        'Root cause: game.players.get("player-1") is undefined. ' +
        'Fix: Ensure addPlayerToGame succeeded.',
    );
  }

  game = {
    ...game,
    players: new Map(game.players).set(playerId, {
      ...initialPlayer,
      installedUpgrades: params.installedUpgrades ?? initialPlayer.installedUpgrades,
    }),
  };

  game = addPlayerToGame(game, {
    id: otherPlayerId,
    userId: null,
    isBot: true,
    ship: createInitialShip({ ring: 8, space: 0 }),
    crew: [
      {
        id: 'other-crew',
        name: 'Other Crew',
        type: 'basic',
        role: 'engineer',
        status: 'active',
        location: SHIP_SECTIONS.ENGINEERING,
        reviveProgress: 0,
        assembleProgress: 0,
        assembleItemType: null,
      },
    ],
    captain: {
      id: 'other-captain',
      name: 'Other Captain',
      type: 'captain',
      captainType: 'merchant',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    },
  });

  game = startGame(game, { startedAt: new Date('2026-01-01T00:00:00.000Z') });
  game = {
    ...game,
    turnPhase: 'action_execution',
  };

  return { game, playerId, otherPlayerId };
}

describe('restore transfers', () => {
  it('allows transfer-only restore when acting crew cannot generate power', () => {
    const ship = createInitialShip({ ring: 8, space: 0 });

    const crewId = 'crew-pilot';
    const pilot: AnyCrew = {
      id: crewId,
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
      id: 'captain',
      name: 'Captain',
      type: 'captain',
      captainType: 'merchant',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const beforeBridgePower = ship.sections[SHIP_SECTIONS.BRIDGE].powerDice.reduce((s, d) => s + d, 0);
    const beforeEngineeringPower = ship.sections[SHIP_SECTIONS.ENGINEERING].powerDice.reduce((s, d) => s + d, 0);

    const { game, playerId, otherPlayerId } = createTwoPlayerGame({
      playerShip: ship,
      playerCrew: [pilot],
      playerCaptain: captain,
    });

    const action: PlayerAction = {
      playerId,
      crewId,
      type: 'restore',
      parameters: {
        transfers: [{ fromSection: SHIP_SECTIONS.BRIDGE, toSection: SHIP_SECTIONS.ENGINEERING, amount: 1 }],
      },
    };

    const next = applyPlayerActions(game, {
      [playerId]: [action],
      [otherPlayerId]: [],
    });

    const nextPlayer = next.players.get(playerId);
    expect(nextPlayer).toBeTruthy();
    if (!nextPlayer) {
      return;
    }

    const afterBridgePower = nextPlayer.ship.sections[SHIP_SECTIONS.BRIDGE].powerDice.reduce((s, d) => s + d, 0);
    const afterEngineeringPower = nextPlayer.ship.sections[SHIP_SECTIONS.ENGINEERING].powerDice.reduce((s, d) => s + d, 0);

    expect(beforeBridgePower - afterBridgePower).toBe(1);
    expect(afterEngineeringPower - beforeEngineeringPower).toBe(1);
  });

  it('allows charging an upgrade from a different section when a conduit path exists', () => {
    const ship = createInitialShip({ ring: 8, space: 0 });

    const upgradeId = 'bio_filters';
    const installedUpgrade: UpgradeCard = {
      id: upgradeId,
      name: 'Bio-Filters',
      description: 'Test',
      powerRequired: 6,
      storedPower: 0,
      section: SHIP_SECTIONS.MED_LAB,
      effects: {},
    };

    const crewId = 'crew-pilot';
    const pilot: AnyCrew = {
      id: crewId,
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
      id: 'captain',
      name: 'Captain',
      type: 'captain',
      captainType: 'merchant',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const beforeBridgePower = ship.sections[SHIP_SECTIONS.BRIDGE].powerDice.reduce((s, d) => s + d, 0);

    const { game, playerId, otherPlayerId } = createTwoPlayerGame({
      playerShip: ship,
      playerCrew: [pilot],
      playerCaptain: captain,
      installedUpgrades: [installedUpgrade],
    });

    const action: PlayerAction = {
      playerId,
      crewId,
      type: 'restore',
      parameters: {
        transfers: [{ fromSection: SHIP_SECTIONS.BRIDGE, toUpgradeId: upgradeId, amount: 2 }],
      },
    };

    const next = applyPlayerActions(game, {
      [playerId]: [action],
      [otherPlayerId]: [],
    });

    const nextPlayer = next.players.get(playerId);
    expect(nextPlayer).toBeTruthy();
    if (!nextPlayer) {
      return;
    }

    const afterBridgePower = nextPlayer.ship.sections[SHIP_SECTIONS.BRIDGE].powerDice.reduce((s, d) => s + d, 0);
    expect(beforeBridgePower - afterBridgePower).toBe(2);

    const updatedUpgrade = nextPlayer.installedUpgrades.find((u) => u.id === upgradeId);
    expect(updatedUpgrade).toBeTruthy();
    expect((updatedUpgrade as any)?.storedPower).toBe(2);
  });

  it('rejects restore allocations when generated power is 0', () => {
    const ship = createInitialShip({ ring: 8, space: 0 });

    const crewId = 'crew-pilot';
    const pilot: AnyCrew = {
      id: crewId,
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
      id: 'captain',
      name: 'Captain',
      type: 'captain',
      captainType: 'merchant',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const { game, playerId, otherPlayerId } = createTwoPlayerGame({
      playerShip: ship,
      playerCrew: [pilot],
      playerCaptain: captain,
    });

    const action: PlayerAction = {
      playerId,
      crewId,
      type: 'restore',
      parameters: {
        routeAllocations: [{ section: SHIP_SECTIONS.ENGINEERING, amount: 1 }],
      },
    };

    expect(() =>
      applyPlayerActions(game, {
        [playerId]: [action],
        [otherPlayerId]: [],
      }),
    ).toThrow(/routed power was requested[\s\S]*cannot generate power/i);
  });
});
