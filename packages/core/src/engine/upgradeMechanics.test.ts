import { describe, expect, it } from 'vitest';

import type { AnyCrew, Captain } from '../models/Crew';
import type { AnySpaceObject } from '../models/Board';
import type { GameSettings, PlayerAction, UpgradeCard } from '../models/Game';
import type { Ship } from '../models/Ship';
import { SHIP_SECTIONS } from '../constants/GameConfig';
import {
  addPlayerToGame,
  applyAutoGenerate,
  applyPlayerActions,
  createInitialShip,
  createNewGame,
  startGame,
  updateOrbitsAndObjects,
} from './index';

function createTwoPlayerGame(params: {
  playerShip: Ship;
  playerCrew: AnyCrew[];
  playerCaptain: Captain;
  installedUpgrades?: UpgradeCard[];
  boardObjects?: AnySpaceObject[];
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
    id: 'upgrade-mechanics-test-game',
    createdAt,
    settings,
    boardSpeedByRing,
  });

  if (params.boardObjects) {
    game = {
      ...game,
      board: {
        ...game.board,
        objects: params.boardObjects,
      },
    };
  }

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
    ship: createInitialShip({ ring: 8, space: 10 }),
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

describe('upgrade mechanics', () => {
  it('Tactical Bridge allows attack from Bridge when powered', () => {
    const baseShip = createInitialShip({ ring: 8, space: 0 });
    const ship: Ship = {
      ...baseShip,
      sections: {
        ...baseShip.sections,
        [SHIP_SECTIONS.BRIDGE]: {
          ...baseShip.sections[SHIP_SECTIONS.BRIDGE],
          hull: 3,
          powerDice: [6],
          conduitConnections: {
            ...baseShip.sections[SHIP_SECTIONS.BRIDGE].conduitConnections,
            [SHIP_SECTIONS.SCI_LAB]: 1,
          },
        },
      },
    };

    const actorId = 'crew-1';
    const actor: AnyCrew = {
      id: actorId,
      name: 'Actor',
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

    const tacticalBridge: UpgradeCard = {
      id: 'tactical_bridge',
      name: 'Tactical Bridge',
      description: 'Test',
      powerRequired: 0,
      storedPower: 0,
      section: SHIP_SECTIONS.BRIDGE,
      effects: {},
    };

    const hostileId = 'hostile-1';
    const hostile: AnySpaceObject = {
      id: hostileId,
      type: 'hostile_ship',
      position: { ring: 8, space: 1 },
      hull: 20,
      hasTorpedo: true,
    } as AnySpaceObject;

    const { game, playerId, otherPlayerId } = createTwoPlayerGame({
      playerShip: ship,
      playerCrew: [actor],
      playerCaptain: captain,
      installedUpgrades: [tacticalBridge],
      boardObjects: [hostile],
    });

    const beforePower = game.players
      .get(playerId)!
      .ship.sections[SHIP_SECTIONS.BRIDGE].powerDice.reduce((sum, die) => sum + die, 0);

    const attackAction: PlayerAction = {
      playerId,
      crewId: actorId,
      type: 'attack',
      target: { objectId: hostileId },
    };

    const next = applyPlayerActions(game, {
      [playerId]: [attackAction],
      [otherPlayerId]: [],
    });

    const nextPlayer = next.players.get(playerId);
    expect(nextPlayer).toBeTruthy();
    if (!nextPlayer) {
      return;
    }

    const afterPower = nextPlayer.ship.sections[SHIP_SECTIONS.BRIDGE].powerDice.reduce((sum, die) => sum + die, 0);
    expect(beforePower - afterPower).toBe(1);

    const updatedHostile = next.board.objects.find((obj) => obj.id === hostileId) as any;
    expect(updatedHostile).toBeTruthy();
    expect(updatedHostile.hull).toBe(12);
  });

  it('Tachyon Beam removes an adjacent hazard when scanning from Sci-Lab', () => {
    const baseShip = createInitialShip({ ring: 8, space: 0 });
    const ship: Ship = {
      ...baseShip,
      sections: {
        ...baseShip.sections,
        [SHIP_SECTIONS.SCI_LAB]: {
          ...baseShip.sections[SHIP_SECTIONS.SCI_LAB],
          hull: 2,
          powerDice: [6],
          conduitConnections: {
            ...baseShip.sections[SHIP_SECTIONS.SCI_LAB].conduitConnections,
            [SHIP_SECTIONS.BRIDGE]: 1,
          },
        },
      },
    };

    const actorId = 'crew-1';
    const actor: AnyCrew = {
      id: actorId,
      name: 'Scientist',
      type: 'basic',
      role: 'scientist',
      status: 'active',
      location: SHIP_SECTIONS.SCI_LAB,
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

    const tachyonBeam: UpgradeCard = {
      id: 'tachyon_beam',
      name: 'Tachyon Beam',
      description: 'Test',
      powerRequired: 6,
      storedPower: 6,
      section: SHIP_SECTIONS.SCI_LAB,
      effects: {},
    };

    const hazardId = 'hazard-1';
    const hazard: AnySpaceObject = {
      id: hazardId,
      type: 'hazard',
      position: { ring: 8, space: 1 },
    };

    const { game, playerId, otherPlayerId } = createTwoPlayerGame({
      playerShip: ship,
      playerCrew: [actor],
      playerCaptain: captain,
      installedUpgrades: [tachyonBeam],
      boardObjects: [hazard],
    });

    const beforePower = game.players
      .get(playerId)!
      .ship.sections[SHIP_SECTIONS.SCI_LAB].powerDice.reduce((sum, die) => sum + die, 0);

    const scanAction: PlayerAction = {
      playerId,
      crewId: actorId,
      type: 'scan',
      target: { objectId: hazardId },
    };

    const next = applyPlayerActions(game, {
      [playerId]: [scanAction],
      [otherPlayerId]: [],
    });

    const nextPlayer = next.players.get(playerId);
    expect(nextPlayer).toBeTruthy();
    if (!nextPlayer) {
      return;
    }

    const afterPower = nextPlayer.ship.sections[SHIP_SECTIONS.SCI_LAB].powerDice.reduce((sum, die) => sum + die, 0);
    expect(beforePower - afterPower).toBe(1);

    const remaining = next.board.objects.find((obj) => obj.id === hazardId);
    expect(remaining).toBeUndefined();
  });

  it('Power Coils prevents the first conduit overload each turn when routing power', () => {
    const baseShip = createInitialShip({ ring: 8, space: 0 });
    const ship: Ship = {
      ...baseShip,
      sections: {
        ...baseShip.sections,
        [SHIP_SECTIONS.BRIDGE]: {
          ...baseShip.sections[SHIP_SECTIONS.BRIDGE],
          hull: 3,
          powerDice: [6],
          conduitConnections: {
            ...baseShip.sections[SHIP_SECTIONS.BRIDGE].conduitConnections,
            [SHIP_SECTIONS.ENGINEERING]: 1,
          },
        },
        [SHIP_SECTIONS.ENGINEERING]: {
          ...baseShip.sections[SHIP_SECTIONS.ENGINEERING],
          hull: 3,
          powerDice: [6, 6],
          conduitConnections: {
            ...baseShip.sections[SHIP_SECTIONS.ENGINEERING].conduitConnections,
            [SHIP_SECTIONS.BRIDGE]: 1,
          },
        },
      },
    };

    const actorId = 'crew-1';
    const actor: AnyCrew = {
      id: actorId,
      name: 'Actor',
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

    const powerCoils: UpgradeCard = {
      id: 'power_coils',
      name: 'Power Coils',
      description: 'Test',
      powerRequired: 6,
      storedPower: 6,
      section: SHIP_SECTIONS.ENGINEERING,
      effects: {},
    };

    const { game, playerId, otherPlayerId } = createTwoPlayerGame({
      playerShip: ship,
      playerCrew: [actor],
      playerCaptain: captain,
      installedUpgrades: [powerCoils],
    });

    const beforePlayer = game.players.get(playerId);
    expect(beforePlayer).toBeTruthy();
    if (!beforePlayer) {
      return;
    }

    const beforeBridgeToEng = beforePlayer.ship.sections[SHIP_SECTIONS.BRIDGE].conduitConnections[SHIP_SECTIONS.ENGINEERING] ?? 0;

    const routeAction: PlayerAction = {
      playerId,
      crewId: actorId,
      type: 'route',
      parameters: {
        sourceSection: 'life_support',
        targetSection: SHIP_SECTIONS.ENGINEERING,
        amount: 4,
      },
    };

    const next = applyPlayerActions(game, {
      [playerId]: [routeAction],
      [otherPlayerId]: [],
    });

    const nextPlayer = next.players.get(playerId);
    expect(nextPlayer).toBeTruthy();
    if (!nextPlayer) {
      return;
    }

    const afterBridgeToEng = nextPlayer.ship.sections[SHIP_SECTIONS.BRIDGE].conduitConnections[SHIP_SECTIONS.ENGINEERING] ?? 0;
    expect(afterBridgeToEng).toBe(beforeBridgeToEng);
    expect(nextPlayer.powerCoilsLastUsedTurn).toBe(next.currentTurn);
  });

  it('Energy Hull heals +1 hull each turn on its installed section when powered', () => {
    const baseShip = createInitialShip({ ring: 8, space: 0 });
    const ship: Ship = {
      ...baseShip,
      sections: {
        ...baseShip.sections,
        [SHIP_SECTIONS.BRIDGE]: {
          ...baseShip.sections[SHIP_SECTIONS.BRIDGE],
          hull: 1,
          powerDice: [6],
          conduitConnections: {
            ...baseShip.sections[SHIP_SECTIONS.BRIDGE].conduitConnections,
            [SHIP_SECTIONS.MED_LAB]: 1,
          },
        },
      },
    };

    const actorId = 'crew-1';
    const actor: AnyCrew = {
      id: actorId,
      name: 'Actor',
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

    const energyHull: UpgradeCard = {
      id: 'energy_hull',
      name: 'Energy Hull',
      description: 'Test',
      powerRequired: 6,
      storedPower: 6,
      section: SHIP_SECTIONS.BRIDGE,
      effects: {},
    };

    const { game, playerId } = createTwoPlayerGame({
      playerShip: ship,
      playerCrew: [actor],
      playerCaptain: captain,
      installedUpgrades: [energyHull],
    });

    const before = game.players.get(playerId);
    expect(before).toBeTruthy();
    if (!before) {
      return;
    }

    const beforeHull = before.ship.sections[SHIP_SECTIONS.BRIDGE].hull;
    const after = applyAutoGenerate(game);
    const afterPlayer = after.players.get(playerId);
    expect(afterPlayer).toBeTruthy();
    if (!afterPlayer) {
      return;
    }

    const afterHull = afterPlayer.ship.sections[SHIP_SECTIONS.BRIDGE].hull;
    expect(afterHull - beforeHull).toBe(1);
  });

  it('Decoys evades one hostile torpedo per turn when powered', () => {
    const baseShip = createInitialShip({ ring: 8, space: 0 });
    const ship: Ship = {
      ...baseShip,
      shields: 5,
      sections: {
        ...baseShip.sections,
        [SHIP_SECTIONS.DEFENSE]: {
          ...baseShip.sections[SHIP_SECTIONS.DEFENSE],
          hull: 2,
          powerDice: [6],
          conduitConnections: {
            ...baseShip.sections[SHIP_SECTIONS.DEFENSE].conduitConnections,
            [SHIP_SECTIONS.ENGINEERING]: 1,
          },
        },
      },
    };

    const actorId = 'crew-1';
    const actor: AnyCrew = {
      id: actorId,
      name: 'Actor',
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

    const decoys: UpgradeCard = {
      id: 'decoys',
      name: 'Decoys',
      description: 'Test',
      powerRequired: 6,
      storedPower: 6,
      section: SHIP_SECTIONS.DEFENSE,
      effects: {},
    };

    const hostileId = 'hostile-1';
    const hostile: AnySpaceObject = {
      id: hostileId,
      type: 'hostile_ship',
      position: { ring: 8, space: 3 },
      hull: 8,
      hasTorpedo: true,
    };

    const { game, playerId } = createTwoPlayerGame({
      playerShip: ship,
      playerCrew: [actor],
      playerCaptain: captain,
      installedUpgrades: [decoys],
      boardObjects: [hostile],
    });

    const before = game.players.get(playerId);
    expect(before).toBeTruthy();
    if (!before) {
      return;
    }

    const beforeShields = before.ship.shields;
    const beforeHull = before.ship.sections[SHIP_SECTIONS.BRIDGE].hull;

    const after = updateOrbitsAndObjects(game);
    const afterPlayer = after.players.get(playerId);
    expect(afterPlayer).toBeTruthy();
    if (!afterPlayer) {
      return;
    }

    expect(afterPlayer.ship.shields).toBe(beforeShields);
    expect(afterPlayer.ship.sections[SHIP_SECTIONS.BRIDGE].hull).toBe(beforeHull);
    expect(afterPlayer.decoysLastUsedTurn).toBe(after.currentTurn);

    const updatedHostile = after.board.objects.find((obj) => obj.id === hostileId) as any;
    expect(updatedHostile).toBeTruthy();
    expect(updatedHostile.hasTorpedo).toBe(false);
  });

  it('Cloaking Device blocks the first hostile attack and records a scan instead', () => {
    const baseShip = createInitialShip({ ring: 8, space: 0 });
    const ship: Ship = {
      ...baseShip,
      shields: 5,
      sections: {
        ...baseShip.sections,
        [SHIP_SECTIONS.SCI_LAB]: {
          ...baseShip.sections[SHIP_SECTIONS.SCI_LAB],
          hull: 2,
          powerDice: [6],
          conduitConnections: {
            ...baseShip.sections[SHIP_SECTIONS.SCI_LAB].conduitConnections,
            [SHIP_SECTIONS.BRIDGE]: 1,
          },
        },
      },
    };

    const actorId = 'crew-1';
    const actor: AnyCrew = {
      id: actorId,
      name: 'Actor',
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

    const cloaking: UpgradeCard = {
      id: 'cloaking_device',
      name: 'Cloaking Device',
      description: 'Test',
      powerRequired: 6,
      storedPower: 6,
      section: SHIP_SECTIONS.SCI_LAB,
      effects: {},
    };

    const hostileId = 'hostile-1';
    const hostile: AnySpaceObject = {
      id: hostileId,
      type: 'hostile_ship',
      position: { ring: 8, space: 1 },
      hull: 8,
      hasTorpedo: true,
    };

    const { game, playerId } = createTwoPlayerGame({
      playerShip: ship,
      playerCrew: [actor],
      playerCaptain: captain,
      installedUpgrades: [cloaking],
      boardObjects: [hostile],
    });

    const before = game.players.get(playerId);
    expect(before).toBeTruthy();
    if (!before) {
      return;
    }

    const beforeShields = before.ship.shields;
    const beforeHull = before.ship.sections[SHIP_SECTIONS.BRIDGE].hull;

    const after = updateOrbitsAndObjects(game);
    const afterPlayer = after.players.get(playerId);
    expect(afterPlayer).toBeTruthy();
    if (!afterPlayer) {
      return;
    }

    expect(afterPlayer.ship.shields).toBe(beforeShields);
    expect(afterPlayer.ship.sections[SHIP_SECTIONS.BRIDGE].hull).toBe(beforeHull);

    const scans = afterPlayer.hostilesScannedPlayerByObjectId ?? {};
    expect(scans[hostileId]).toBe(after.currentTurn);
  });

  it('Shield Modulator halves shield loss from hostile weapon damage', () => {
    const baseShip = createInitialShip({ ring: 8, space: 0 });
    const ship: Ship = {
      ...baseShip,
      shields: 5,
      sections: {
        ...baseShip.sections,
        [SHIP_SECTIONS.DEFENSE]: {
          ...baseShip.sections[SHIP_SECTIONS.DEFENSE],
          hull: 2,
          powerDice: [6],
          conduitConnections: {
            ...baseShip.sections[SHIP_SECTIONS.DEFENSE].conduitConnections,
            [SHIP_SECTIONS.ENGINEERING]: 1,
          },
        },
      },
    };

    const actorId = 'crew-1';
    const actor: AnyCrew = {
      id: actorId,
      name: 'Actor',
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

    const shieldModulator: UpgradeCard = {
      id: 'shield_modulator',
      name: 'Shield Modulator',
      description: 'Test',
      powerRequired: 6,
      storedPower: 6,
      section: SHIP_SECTIONS.DEFENSE,
      effects: {},
    };

    const hostileId = 'hostile-1';
    const hostile: AnySpaceObject = {
      id: hostileId,
      type: 'hostile_ship',
      position: { ring: 8, space: 1 },
      hull: 8,
      hasTorpedo: true,
    };

    const { game, playerId } = createTwoPlayerGame({
      playerShip: ship,
      playerCrew: [actor],
      playerCaptain: captain,
      installedUpgrades: [shieldModulator],
      boardObjects: [hostile],
    });

    const after = updateOrbitsAndObjects(game);
    const afterPlayer = after.players.get(playerId);
    expect(afterPlayer).toBeTruthy();
    if (!afterPlayer) {
      return;
    }

    // Adjacent hostile attack damage is at least 6, so with 5 shields:
    // - without Shield Modulator, shields would drop to 0
    // - with Shield Modulator, shield loss is ceil(5/2)=3 so shields become 2
    expect(afterPlayer.ship.shields).toBe(2);
  });
});
