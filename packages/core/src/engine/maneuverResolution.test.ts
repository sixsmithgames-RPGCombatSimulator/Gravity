import { describe, expect, it } from 'vitest';

import { SHIP_SECTIONS } from '../constants/GameConfig';
import type { AnyCrew, Captain } from '../models/Crew';
import type { GameSettings, PlayerAction } from '../models/Game';
import type { Ship } from '../models/Ship';
import {
  addPlayerToGame,
  applyPlayerActions,
  createInitialShip,
  createNewGame,
  previewManeuver,
  startGame,
} from './index';

function createBaseGame() {
  const settings: GameSettings = {
    maxPlayers: 2,
    rotationDirection: 'clockwise',
    expansions: ['core'],
  };

  return createNewGame({
    id: 'maneuver-resolution-test-game',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    settings,
    boardSpeedByRing: [1, 1, 1, 1, 1, 1, 1, 1],
  });
}

function createCaptain(): Captain {
  return {
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
}

function createBridgeCrew(id: string, role: 'pilot' | 'engineer' | 'medic' | 'scientist' | 'tactician'): AnyCrew {
  return {
    id,
    name: id,
    type: 'basic',
    role,
    status: 'active',
    location: SHIP_SECTIONS.BRIDGE,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  };
}

function createFunctionalManeuverShip(overrides?: Partial<Ship>): Ship {
  const ship = createInitialShip({ ring: 4, space: 0 });

  return {
    ...ship,
    ...overrides,
    sections: {
      ...ship.sections,
      [SHIP_SECTIONS.BRIDGE]: {
        ...ship.sections[SHIP_SECTIONS.BRIDGE],
        hull: 3,
        powerDice: [6],
      },
      [SHIP_SECTIONS.DRIVES]: {
        ...ship.sections[SHIP_SECTIONS.DRIVES],
        hull: 3,
        powerDice: [1],
        conduitConnections: {
          ...ship.sections[SHIP_SECTIONS.DRIVES].conduitConnections,
          [SHIP_SECTIONS.ENGINEERING]: 1,
          [SHIP_SECTIONS.MED_LAB]: 1,
        },
      },
      [SHIP_SECTIONS.ENGINEERING]: {
        ...ship.sections[SHIP_SECTIONS.ENGINEERING],
        hull: 3,
        powerDice: [2],
        conduitConnections: {
          ...ship.sections[SHIP_SECTIONS.ENGINEERING].conduitConnections,
          [SHIP_SECTIONS.BRIDGE]: 1,
          [SHIP_SECTIONS.DRIVES]: 1,
          [SHIP_SECTIONS.DEFENSE]: 0,
        },
      },
      [SHIP_SECTIONS.MED_LAB]: {
        ...ship.sections[SHIP_SECTIONS.MED_LAB],
        hull: 3,
        powerDice: [],
        conduitConnections: {
          ...ship.sections[SHIP_SECTIONS.MED_LAB].conduitConnections,
          [SHIP_SECTIONS.BRIDGE]: 1,
          [SHIP_SECTIONS.DRIVES]: 1,
        },
      },
      [SHIP_SECTIONS.SCI_LAB]: {
        ...ship.sections[SHIP_SECTIONS.SCI_LAB],
        hull: 3,
        powerDice: [],
        conduitConnections: {
          ...ship.sections[SHIP_SECTIONS.SCI_LAB].conduitConnections,
          [SHIP_SECTIONS.BRIDGE]: 1,
          [SHIP_SECTIONS.DEFENSE]: 0,
        },
      },
      [SHIP_SECTIONS.DEFENSE]: {
        ...ship.sections[SHIP_SECTIONS.DEFENSE],
        hull: 3,
        powerDice: [],
        conduitConnections: {
          ...ship.sections[SHIP_SECTIONS.DEFENSE].conduitConnections,
          [SHIP_SECTIONS.SCI_LAB]: 0,
          [SHIP_SECTIONS.ENGINEERING]: 0,
        },
      },
      ...(overrides?.sections ?? {}),
    },
  };
}

function createScenario(params?: {
  ship?: Ship;
  crew?: AnyCrew[];
  captain?: Captain;
  otherShip?: Ship;
}) {
  const playerId = 'player-1';
  const otherPlayerId = 'player-2';
  const crew = params?.crew ?? [createBridgeCrew('crew-1', 'pilot')];
  const captain = params?.captain ?? createCaptain();
  const ship = params?.ship ?? createFunctionalManeuverShip();
  const otherShip = params?.otherShip ?? createInitialShip({ ring: 6, space: 5 });

  let game = addPlayerToGame(createBaseGame(), {
    id: playerId,
    userId: 'user-1',
    isBot: false,
    ship,
    crew,
    captain,
  });

  game = addPlayerToGame(game, {
    id: otherPlayerId,
    userId: 'user-2',
    isBot: false,
    ship: otherShip,
    crew: [createBridgeCrew('other-crew', 'pilot')],
    captain: {
      ...createCaptain(),
      id: 'captain-2',
      name: 'Other Captain',
    },
  });

  game = startGame(game, { startedAt: new Date('2026-01-01T00:00:00.000Z') });
  game = {
    ...game,
    turnPhase: 'action_execution',
  };

  return { game, playerId, otherPlayerId };
}

describe('maneuver resolution', () => {
  it('rejects duplicate maneuver actions for the same player in one turn', () => {
    const crew = [createBridgeCrew('crew-1', 'pilot'), createBridgeCrew('crew-2', 'engineer')];
    const { game, playerId, otherPlayerId } = createScenario({ crew });

    const actions: PlayerAction[] = [
      {
        playerId,
        crewId: 'crew-1',
        type: 'maneuver',
        parameters: { direction: 'forward', powerSpent: 1 },
      },
      {
        playerId,
        crewId: 'crew-2',
        type: 'maneuver',
        parameters: { direction: 'forward', powerSpent: 1 },
      },
    ];

    expect(() =>
      applyPlayerActions(game, {
        [playerId]: actions,
        [otherPlayerId]: [],
      }),
    ).toThrow(/more than one maneuver/i);
  });

  it('records a lost maneuver when drives remain underpowered for a non-pilot-family crew', () => {
    const crew = [createBridgeCrew('crew-1', 'engineer')];
    const ship = createFunctionalManeuverShip({
      sections: {
        ...createFunctionalManeuverShip().sections,
        [SHIP_SECTIONS.DRIVES]: {
          ...createFunctionalManeuverShip().sections[SHIP_SECTIONS.DRIVES],
          hull: 3,
          powerDice: [1],
        },
        [SHIP_SECTIONS.ENGINEERING]: {
          ...createFunctionalManeuverShip().sections[SHIP_SECTIONS.ENGINEERING],
          hull: 3,
          powerDice: [3],
          conduitConnections: {
            ...createFunctionalManeuverShip().sections[SHIP_SECTIONS.ENGINEERING].conduitConnections,
            [SHIP_SECTIONS.DRIVES]: 1,
          },
        },
      },
    });
    const { game, playerId, otherPlayerId } = createScenario({ crew, ship });

    const after = applyPlayerActions(game, {
      [playerId]: [
        {
          playerId,
          crewId: 'crew-1',
          type: 'maneuver',
          parameters: { direction: 'forward', powerSpent: 2 },
        },
      ],
      [otherPlayerId]: [],
    });

    const afterPlayer = after.players.get(playerId);
    expect(afterPlayer).toBeTruthy();
    expect(afterPlayer?.ship.position).toEqual(game.players.get(playerId)?.ship.position);

    const actionResults = after.lastActionResolutionRecordsByPlayerId?.[playerId] ?? [];
    expect(actionResults).toHaveLength(1);
    expect(actionResults[0]?.outcome).toBe('lost');
    expect(actionResults[0]?.actionType).toBe('maneuver');
    expect(actionResults[0]?.message).toMatch(/does not have the pilot-family 1-power reroute ability/i);
  });

  it('allows pilot-family crew to reroute one power into Drives for maneuver', () => {
    const ship = createFunctionalManeuverShip({
      sections: {
        ...createFunctionalManeuverShip().sections,
        [SHIP_SECTIONS.DRIVES]: {
          ...createFunctionalManeuverShip().sections[SHIP_SECTIONS.DRIVES],
          hull: 3,
          powerDice: [1],
        },
        [SHIP_SECTIONS.ENGINEERING]: {
          ...createFunctionalManeuverShip().sections[SHIP_SECTIONS.ENGINEERING],
          hull: 3,
          powerDice: [2],
          conduitConnections: {
            ...createFunctionalManeuverShip().sections[SHIP_SECTIONS.ENGINEERING].conduitConnections,
            [SHIP_SECTIONS.DRIVES]: 1,
          },
        },
      },
    });
    const { game, playerId, otherPlayerId } = createScenario({ ship });

    const beforePlayer = game.players.get(playerId);
    expect(beforePlayer).toBeTruthy();
    if (!beforePlayer) {
      return;
    }

    const after = applyPlayerActions(game, {
      [playerId]: [
        {
          playerId,
          crewId: 'crew-1',
          type: 'maneuver',
          parameters: {
            direction: 'forward',
            powerSpent: 2,
            rerouteSourceSection: SHIP_SECTIONS.ENGINEERING,
          },
        },
      ],
      [otherPlayerId]: [],
    });

    const afterPlayer = after.players.get(playerId);
    expect(afterPlayer).toBeTruthy();
    if (!afterPlayer) {
      return;
    }

    expect(afterPlayer.ship.position.space).not.toBe(beforePlayer.ship.position.space);
    const engineeringPowerAfter = afterPlayer.ship.sections[SHIP_SECTIONS.ENGINEERING].powerDice.reduce((sum, die) => sum + die, 0);
    expect(engineeringPowerAfter).toBe(1);
    expect(after.lastActionResolutionRecordsByPlayerId?.[playerId] ?? []).toHaveLength(0);
  });

  it('resolves split-axis maneuver plans with the same destination as previewManeuver', () => {
    const { game, playerId, otherPlayerId } = createScenario();
    const player = game.players.get(playerId);
    expect(player).toBeTruthy();
    if (!player) {
      return;
    }

    const preview = previewManeuver(
      player.ship,
      player.crew[0],
      {
        tangentialDirection: 'forward',
        tangentialDistance: 1,
        radialDirection: 'inward',
        radialDistance: 2,
      },
      2,
      game.board,
      player.installedUpgrades,
    );

    const after = applyPlayerActions(game, {
      [playerId]: [
        {
          playerId,
          crewId: 'crew-1',
          type: 'maneuver',
          parameters: {
            tangentialDirection: 'forward',
            tangentialDistance: 1,
            radialDirection: 'inward',
            radialDistance: 2,
            powerSpent: 2,
          },
        },
      ],
      [otherPlayerId]: [],
    });

    const afterPlayer = after.players.get(playerId);
    expect(afterPlayer).toBeTruthy();
    if (!afterPlayer) {
      return;
    }

    expect(afterPlayer.ship.position).toEqual(preview.updatedShip.position);
    expect(afterPlayer.ship.speed).toBe(preview.updatedShip.speed);
  });

  it('previewManeuver uses the same pilot-family reroute rule as live resolution', () => {
    const ship = createFunctionalManeuverShip({
      sections: {
        ...createFunctionalManeuverShip().sections,
        [SHIP_SECTIONS.DRIVES]: {
          ...createFunctionalManeuverShip().sections[SHIP_SECTIONS.DRIVES],
          hull: 3,
          powerDice: [1],
        },
        [SHIP_SECTIONS.ENGINEERING]: {
          ...createFunctionalManeuverShip().sections[SHIP_SECTIONS.ENGINEERING],
          hull: 3,
          powerDice: [2],
          conduitConnections: {
            ...createFunctionalManeuverShip().sections[SHIP_SECTIONS.ENGINEERING].conduitConnections,
            [SHIP_SECTIONS.DRIVES]: 1,
          },
        },
      },
    });
    const { game, playerId } = createScenario({ ship });
    const player = game.players.get(playerId);
    expect(player).toBeTruthy();
    if (!player) {
      return;
    }

    const preview = previewManeuver(
      player.ship,
      player.crew[0],
      'forward',
      2,
      game.board,
      undefined,
      player.installedUpgrades,
      SHIP_SECTIONS.ENGINEERING,
    );

    expect(preview.acceleration).toBeGreaterThanOrEqual(2);
    const engineeringPowerAfter = preview.shipAfterCost.sections[SHIP_SECTIONS.ENGINEERING].powerDice.reduce((sum, die) => sum + die, 0);
    expect(engineeringPowerAfter).toBe(1);
  });
});
