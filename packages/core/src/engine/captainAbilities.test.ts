import { describe, expect, it } from 'vitest';

import type { AnyCrew, Captain } from '../models/Crew';
import type { AnySpaceObject } from '../models/Board';
import type { GameSettings, PlayerAction } from '../models/Game';
import type { Ship } from '../models/Ship';
import type { ShipSection } from '../constants/GameConfig';
import { SHIP_SECTIONS } from '../constants/GameConfig';
import {
  addPlayerToGame,
  applyAutoGenerate,
  applyPlayerActions,
  calculateVictoryPoints,
  createInitialShip,
  createNewGame,
  processTurn,
  startGame,
} from './index';

function createBaseGame(settingsOverrides?: Partial<GameSettings>) {
  const settings: GameSettings = {
    maxPlayers: 2,
    rotationDirection: 'clockwise',
    expansions: ['core'],
    ...settingsOverrides,
  };

  const gameId = 'captain-abilities-test-game';
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const boardSpeedByRing = [1, 1, 1, 1, 1, 1, 1, 1];

  const game = createNewGame({
    id: gameId,
    createdAt,
    settings,
    boardSpeedByRing,
  });

  return game;
}

function addTwoPlayersAndStart(params: {
  game: ReturnType<typeof createBaseGame>;
  playerCaptainType: Captain['captainType'];
  playerShip: Ship;
  playerCrew: AnyCrew[];
  playerCaptainLocation: ShipSection;
  otherShip: Ship;
}): { game: ReturnType<typeof createNewGame>; playerId: string; otherPlayerId: string; actorCrewId: string } {
  const playerId = 'player-1';
  const otherPlayerId = 'player-2';

  const actorCrewId = params.playerCrew[0]?.id;
  if (!actorCrewId) {
    throw new Error(
      'Cannot create test scenario because playerCrew is empty. ' +
        'Root cause: params.playerCrew[0] is undefined. ' +
        'Fix: Provide at least one crew member to act.'
    );
  }

  const captain: Captain = {
    id: 'captain-1',
    name: 'Captain',
    type: 'captain',
    captainType: params.playerCaptainType,
    status: 'active',
    location: params.playerCaptainLocation,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  };

  let game = addPlayerToGame(params.game, {
    id: playerId,
    userId: 'user-1',
    isBot: false,
    ship: params.playerShip,
    crew: params.playerCrew,
    captain,
  });

  game = addPlayerToGame(game, {
    id: otherPlayerId,
    userId: null,
    isBot: true,
    ship: params.otherShip,
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

  return { game, playerId, otherPlayerId, actorCrewId };
}

function createShipWithPoweredSciLab(position: { ring: number; space: number }): Ship {
  const shipBase = createInitialShip(position);
  return {
    ...shipBase,
    sections: {
      ...shipBase.sections,
      [SHIP_SECTIONS.SCI_LAB]: {
        ...shipBase.sections[SHIP_SECTIONS.SCI_LAB],
        hull: 1,
        powerDice: [6],
      },
      [SHIP_SECTIONS.BRIDGE]: {
        ...shipBase.sections[SHIP_SECTIONS.BRIDGE],
        hull: 1,
        powerDice: [6],
      },
    },
  };
}

describe('captain abilities', () => {
  it('start-of-game perks are not applied until the first turn is processed', () => {
    const baseGame = createBaseGame();

    const ship = createInitialShip({ ring: 8, space: 0 });
    const otherShip = createInitialShip({ ring: 8, space: 10 });

    const actor: AnyCrew = {
      id: 'crew-1',
      name: 'Actor',
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const scenario = addTwoPlayersAndStart({
      game: baseGame,
      playerCaptainType: 'merchant',
      playerShip: ship,
      playerCrew: [actor],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip,
    });

    const startedPlayer = scenario.game.players.get(scenario.playerId);
    expect(startedPlayer).toBeTruthy();
    expect(startedPlayer!.pendingUpgrades.length).toBe(0);

    const afterEvent = processTurn(
      {
        ...scenario.game,
        turnPhase: 'event',
      },
      {
        [scenario.playerId]: [],
        [scenario.otherPlayerId]: [],
      },
    );

    const afterPlayer = afterEvent.players.get(scenario.playerId);
    expect(afterPlayer).toBeTruthy();
    expect(afterPlayer!.pendingUpgrades.length).toBeGreaterThan(0);
  });

  it('Explorer repair kit is not available immediately after startGame', () => {
    const baseGame = createBaseGame();

    const ship = createInitialShip({ ring: 8, space: 0 });
    const otherShip = createInitialShip({ ring: 8, space: 10 });

    const actor: AnyCrew = {
      id: 'crew-1',
      name: 'Actor',
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const scenario = addTwoPlayersAndStart({
      game: baseGame,
      playerCaptainType: 'explorer',
      playerShip: ship,
      playerCrew: [actor],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip,
    });

    const startedPlayer = scenario.game.players.get(scenario.playerId);
    expect(startedPlayer).toBeTruthy();
    expect(startedPlayer!.explorerRepairKit).toBeNull();
  });

  it('Merchant: successful acquire grants +1 extra deterministic basic resource', () => {
    const baseGame = createBaseGame();

    const ship = createShipWithPoweredSciLab({ ring: 8, space: 0 });

    const scannerId = 'crew-scan';
    const acquirerId = 'crew-acquire';

    const scanner: AnyCrew = {
      id: scannerId,
      name: 'Scanner',
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const acquirer: AnyCrew = {
      id: acquirerId,
      name: 'Acquirer',
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const otherShip = createShipWithPoweredSciLab({ ring: 8, space: 10 });

    const objectId = 'station-1';
    const station: AnySpaceObject = {
      id: objectId,
      type: 'functional_station',
      position: { ring: 8, space: 1 },
      hull: 24,
      shields: 12,
      lootResourceType: 'antimatter',
      lootUpgrade: null,
      lootRollValue: 1,
      lootGeneratedAtTurn: 1,
    };

    const gameWithObject = {
      ...baseGame,
      board: {
        ...baseGame.board,
        objects: [station],
      },
    };

    const scenario = addTwoPlayersAndStart({
      game: gameWithObject,
      playerCaptainType: 'merchant',
      playerShip: ship,
      playerCrew: [scanner, acquirer],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip,
    });

    const scanAction: PlayerAction = {
      playerId: scenario.playerId,
      crewId: scannerId,
      type: 'scan',
      target: { objectId },
    };

    const acquireAction: PlayerAction = {
      playerId: scenario.playerId,
      crewId: acquirerId,
      type: 'acquire',
      target: { objectId },
    };

    const after = applyPlayerActions(scenario.game, {
      [scenario.playerId]: [scanAction, acquireAction],
      [scenario.otherPlayerId]: [],
    });

    const player = after.players.get(scenario.playerId);
    expect(player).toBeDefined();

    const totalResources = Object.values(player?.resources ?? {}).reduce(
      (sum, count) => sum + (typeof count === 'number' ? count : 0),
      0,
    );

    expect(totalResources).toBe(2);
  });

  it('Technologist: fully powered Sci-Lab grants +3 scan range', () => {
    const baseGame = createBaseGame();

    const ship = createShipWithPoweredSciLab({ ring: 8, space: 0 });

    const actor: AnyCrew = {
      id: 'crew-1',
      name: 'Actor',
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const otherShip = createShipWithPoweredSciLab({ ring: 8, space: 10 });

    const objectId = 'debris-1';
    const debris: AnySpaceObject = {
      id: objectId,
      type: 'debris',
      position: { ring: 8, space: 4 },
    };

    const gameWithObject = {
      ...baseGame,
      board: {
        ...baseGame.board,
        objects: [debris],
      },
    };

    const scenario = addTwoPlayersAndStart({
      game: gameWithObject,
      playerCaptainType: 'technologist',
      playerShip: ship,
      playerCrew: [actor],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip,
    });

    // distance: 4, maxRange: 1 + 3 = 4 (Technologist bonus) so scan should be allowed
    const scanAction: PlayerAction = {
      playerId: scenario.playerId,
      crewId: scenario.actorCrewId,
      type: 'scan',
      target: { objectId },
    };

    const after = applyPlayerActions(scenario.game, {
      [scenario.playerId]: [scanAction],
      [scenario.otherPlayerId]: [],
    });

    // Assertion is that it does not throw and state is returned.
    expect(after.turnPhase).toBe('action_execution');
  });

  it('Non-Technologist: fully powered Sci-Lab grants only +2 scan range (distance 4 is out of range)', () => {
    const baseGame = createBaseGame();

    const ship = createShipWithPoweredSciLab({ ring: 8, space: 0 });

    const actor: AnyCrew = {
      id: 'crew-1',
      name: 'Actor',
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const otherShip = createShipWithPoweredSciLab({ ring: 8, space: 10 });

    const objectId = 'debris-1';
    const debris: AnySpaceObject = {
      id: objectId,
      type: 'debris',
      position: { ring: 8, space: 4 },
    };

    const gameWithObject = {
      ...baseGame,
      board: {
        ...baseGame.board,
        objects: [debris],
      },
    };

    const scenario = addTwoPlayersAndStart({
      game: gameWithObject,
      playerCaptainType: 'merchant',
      playerShip: ship,
      playerCrew: [actor],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip,
    });

    const scanAction: PlayerAction = {
      playerId: scenario.playerId,
      crewId: scenario.actorCrewId,
      type: 'scan',
      target: { objectId },
    };

    expect(() =>
      applyPlayerActions(scenario.game, {
        [scenario.playerId]: [scanAction],
        [scenario.otherPlayerId]: [],
      })
    ).toThrow(/out of range/);
  });

  it('Launch: requires explicit valid launchType (no default)', () => {
    const baseGame = createBaseGame();

    const shipBase = createInitialShip({ ring: 8, space: 0 });
    const ship: Ship = {
      ...shipBase,
      sections: {
        ...shipBase.sections,
        [SHIP_SECTIONS.BRIDGE]: {
          ...shipBase.sections[SHIP_SECTIONS.BRIDGE],
          hull: 1,
          powerDice: [6],
        },
      },
    };

    const actor: AnyCrew = {
      id: 'crew-1',
      name: 'Actor',
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const otherShip = createInitialShip({ ring: 8, space: 10 });

    const scenario = addTwoPlayersAndStart({
      game: baseGame,
      playerCaptainType: 'merchant',
      playerShip: ship,
      playerCrew: [actor],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip,
    });

    const launchWithoutType: PlayerAction = {
      playerId: scenario.playerId,
      crewId: scenario.actorCrewId,
      type: 'launch',
      target: { position: { ring: 8, space: 1 } },
      parameters: {},
    };

    expect(() =>
      applyPlayerActions(scenario.game, {
        [scenario.playerId]: [launchWithoutType],
        [scenario.otherPlayerId]: [],
      })
    ).toThrow(/launchType is missing or invalid/);
  });

  it('Imperialist: fully powered Defense auto-generates +3 shields (vs +2 baseline)', () => {
    const baseGame = createBaseGame();

    const makeShipWithFullyPoweredDefense = (): Ship => {
      const shipBase = createInitialShip({ ring: 8, space: 0 });
      return {
        ...shipBase,
        shields: 0,
        sections: {
          ...shipBase.sections,
          [SHIP_SECTIONS.DEFENSE]: {
            ...shipBase.sections[SHIP_SECTIONS.DEFENSE],
            hull: 1,
            powerDice: [6],
            conduitConnections: {
              ...shipBase.sections[SHIP_SECTIONS.DEFENSE].conduitConnections,
              [SHIP_SECTIONS.ENGINEERING]: 1,
            },
          },
        },
      };
    };

    const actor: AnyCrew = {
      id: 'crew-1',
      name: 'Actor',
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const scenarioImperialist = addTwoPlayersAndStart({
      game: baseGame,
      playerCaptainType: 'imperialist',
      playerShip: makeShipWithFullyPoweredDefense(),
      playerCrew: [actor],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip: createInitialShip({ ring: 8, space: 10 }),
    });

    const afterImperialist = applyAutoGenerate(scenarioImperialist.game);
    const imperialistPlayer = afterImperialist.players.get(scenarioImperialist.playerId);
    expect(imperialistPlayer).toBeTruthy();
    expect(imperialistPlayer!.ship.shields).toBe(3);

    const baseGame2 = createBaseGame();
    const scenarioBaseline = addTwoPlayersAndStart({
      game: baseGame2,
      playerCaptainType: 'merchant',
      playerShip: makeShipWithFullyPoweredDefense(),
      playerCrew: [actor],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip: createInitialShip({ ring: 8, space: 10 }),
    });

    const afterBaseline = applyAutoGenerate(scenarioBaseline.game);
    const baselinePlayer = afterBaseline.players.get(scenarioBaseline.playerId);
    expect(baselinePlayer).toBeTruthy();
    expect(baselinePlayer!.ship.shields).toBe(2);
  });

  it('Explorer: +5 life support reduces unconscious from life support shortage', () => {
    const baseGameExplorer = createBaseGame();

    const makeShipWithZeroLifeSupport = (): Ship => {
      const shipBase = createInitialShip({ ring: 8, space: 0 });
      return {
        ...shipBase,
        lifeSupportPower: 0,
        sections: {
          ...shipBase.sections,
          [SHIP_SECTIONS.BRIDGE]: {
            ...shipBase.sections[SHIP_SECTIONS.BRIDGE],
            powerDice: [1],
          },
        },
      };
    };

    const crew: AnyCrew[] = Array.from({ length: 5 }).map((_, index) => ({
      id: `crew-${index + 1}`,
      name: `Crew ${index + 1}`,
      type: 'basic' as const,
      role: 'pilot',
      status: 'active' as const,
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    }));

    const explorerScenario = addTwoPlayersAndStart({
      game: baseGameExplorer,
      playerCaptainType: 'explorer',
      playerShip: makeShipWithZeroLifeSupport(),
      playerCrew: crew,
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip: createInitialShip({ ring: 8, space: 10 }),
    });

    const afterExplorer = applyAutoGenerate(explorerScenario.game);
    const explorerPlayer = afterExplorer.players.get(explorerScenario.playerId);
    expect(explorerPlayer).toBeTruthy();
    expect(explorerPlayer!.crew.filter(c => c.status === 'unconscious').length).toBe(4);
    expect(explorerPlayer!.captain.status).toBe('active');

    const baseGameNonExplorer = createBaseGame();
    const nonExplorerScenario = addTwoPlayersAndStart({
      game: baseGameNonExplorer,
      playerCaptainType: 'merchant',
      playerShip: makeShipWithZeroLifeSupport(),
      playerCrew: crew,
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip: createInitialShip({ ring: 8, space: 10 }),
    });

    const afterNonExplorer = applyAutoGenerate(nonExplorerScenario.game);
    const nonExplorerPlayer = afterNonExplorer.players.get(nonExplorerScenario.playerId);
    expect(nonExplorerPlayer).toBeTruthy();
    expect(nonExplorerPlayer!.crew.filter(c => c.status === 'unconscious').length).toBe(5);
    expect(nonExplorerPlayer!.captain.status).toBe('unconscious');
  });

  it('Emissary and Mission Specialist: completed mission points are multiplied by 1.5', () => {
    const mission = {
      id: 'mission-1',
      name: 'Mission',
      description: 'Test',
      objectives: {
        primary: { description: 'Primary', points: 10, completed: true },
      },
    };

    const baseGameEmissary = createBaseGame();
    const ship = createInitialShip({ ring: 8, space: 0 });
    const otherShip = createInitialShip({ ring: 8, space: 10 });

    const actor: AnyCrew = {
      id: 'crew-1',
      name: 'Actor',
      type: 'basic',
      role: 'pilot',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const emissaryScenario = addTwoPlayersAndStart({
      game: baseGameEmissary,
      playerCaptainType: 'emissary',
      playerShip: ship,
      playerCrew: [actor],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip,
    });

    const emissaryPlayer = emissaryScenario.game.players.get(emissaryScenario.playerId)!;
    const emissaryPoints = calculateVictoryPoints({
      ...emissaryPlayer,
      missions: [mission],
    });
    expect(emissaryPoints).toBe(20);

    const baseGameMissionSpecialist = createBaseGame();
    const missionSpecialist: AnyCrew = {
      id: 'officer-1',
      name: 'Mission Specialist',
      type: 'officer',
      role: 'mission_specialist',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
      stimPacksUsed: 0,
    };

    const missionSpecialistScenario = addTwoPlayersAndStart({
      game: baseGameMissionSpecialist,
      playerCaptainType: 'merchant',
      playerShip: ship,
      playerCrew: [actor, missionSpecialist],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip,
    });

    const missionSpecialistPlayer = missionSpecialistScenario.game.players.get(missionSpecialistScenario.playerId)!;
    const missionSpecialistPoints = calculateVictoryPoints({
      ...missionSpecialistPlayer,
      missions: [mission],
    });
    expect(missionSpecialistPoints).toBe(22);

    const baseGameBaseline = createBaseGame();
    const baselineScenario = addTwoPlayersAndStart({
      game: baseGameBaseline,
      playerCaptainType: 'merchant',
      playerShip: ship,
      playerCrew: [actor],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip,
    });

    const baselinePlayer = baselineScenario.game.players.get(baselineScenario.playerId)!;
    const baselinePoints = calculateVictoryPoints({
      ...baselinePlayer,
      missions: [mission],
    });
    expect(baselinePoints).toBe(15);
  });

  it('Technologist: basic crew with an attack bonus gets an additional +1 damage', () => {
    const baseGameTech = createBaseGame();

    const shipBase = createInitialShip({ ring: 8, space: 0 });
    const shipWithDefensePower: Ship = {
      ...shipBase,
      sections: {
        ...shipBase.sections,
        [SHIP_SECTIONS.DEFENSE]: {
          ...shipBase.sections[SHIP_SECTIONS.DEFENSE],
          hull: 1,
          powerDice: [1],
          conduitConnections: {
            ...shipBase.sections[SHIP_SECTIONS.DEFENSE].conduitConnections,
            [SHIP_SECTIONS.ENGINEERING]: 1,
          },
        },
      },
    };

    const tactician: AnyCrew = {
      id: 'crew-1',
      name: 'Tactician',
      type: 'basic',
      role: 'tactician',
      status: 'active',
      location: SHIP_SECTIONS.DEFENSE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    }; 

    const objectId = 'hostile-1';
    const hostile: AnySpaceObject = {
      id: objectId,
      type: 'hostile_ship',
      position: { ring: 8, space: 1 },
      hull: 20,
      hasTorpedo: false,
    };

    const gameWithHostile = {
      ...baseGameTech,
      board: {
        ...baseGameTech.board,
        objects: [hostile],
      },
    };

    const scenarioTech = addTwoPlayersAndStart({
      game: gameWithHostile,
      playerCaptainType: 'technologist',
      playerShip: shipWithDefensePower,
      playerCrew: [tactician],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip: createInitialShip({ ring: 8, space: 10 }),
    });

    const attackAction: PlayerAction = {
      playerId: scenarioTech.playerId,
      crewId: scenarioTech.actorCrewId,
      type: 'attack',
      target: { objectId },
    };

    const afterTech = applyPlayerActions(scenarioTech.game, {
      [scenarioTech.playerId]: [attackAction],
      [scenarioTech.otherPlayerId]: [],
    });

    const techHostileAfter = afterTech.board.objects.find(obj => obj.id === objectId) as any;
    expect(techHostileAfter.hull).toBe(11);

    const baseGameNonTech = createBaseGame();
    const gameWithHostile2 = {
      ...baseGameNonTech,
      board: {
        ...baseGameNonTech.board,
        objects: [hostile],
      },
    };

    const scenarioNonTech = addTwoPlayersAndStart({
      game: gameWithHostile2,
      playerCaptainType: 'merchant',
      playerShip: shipWithDefensePower,
      playerCrew: [tactician],
      playerCaptainLocation: SHIP_SECTIONS.BRIDGE,
      otherShip: createInitialShip({ ring: 8, space: 10 }),
    });

    const afterNonTech = applyPlayerActions(scenarioNonTech.game, {
      [scenarioNonTech.playerId]: [attackAction],
      [scenarioNonTech.otherPlayerId]: [],
    });

    const nonTechHostileAfter = afterNonTech.board.objects.find(obj => obj.id === objectId) as any;
    expect(nonTechHostileAfter.hull).toBe(12);
  });
});
