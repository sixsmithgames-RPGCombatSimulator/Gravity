import { describe, expect, it } from 'vitest';

import type { AnyCrew, Captain } from '../models/Crew';
import type { GameSettings, PlayerAction } from '../models/Game';
import type { Ship } from '../models/Ship';
import { SHIP_SECTIONS } from '../constants/GameConfig';
import { addPlayerToGame, applyPlayerActions, createInitialShip, createNewGame, startGame } from './index';

function createTwoPlayerGame(params: {
  playerShip: Ship;
  playerCrew: AnyCrew[];
  playerCaptain: Captain;
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
    id: 'stim-pack-test-game',
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

describe('Doctor stim packs', () => {
  it('consumes a stim pack and doubles revive roll value', () => {
    const baseShip = createInitialShip({ ring: 8, space: 0 });
    const shipWithMedLabPower: Ship = {
      ...baseShip,
      sections: {
        ...baseShip.sections,
        [SHIP_SECTIONS.MED_LAB]: {
          ...baseShip.sections[SHIP_SECTIONS.MED_LAB],
          powerDice: [1],
        },
      },
    };

    const doctorId = 'crew-doctor';
    const reviverId = 'crew-medic';
    const targetId = 'crew-target';

    const doctor: AnyCrew = {
      id: doctorId,
      name: 'Doctor',
      type: 'officer',
      role: 'doctor',
      status: 'active',
      location: SHIP_SECTIONS.MED_LAB,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
      stimPacksUsed: 0,
    };

    const medic: AnyCrew = {
      id: reviverId,
      name: 'Medic',
      type: 'basic',
      role: 'medic',
      status: 'active',
      location: SHIP_SECTIONS.MED_LAB,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
    };

    const target: AnyCrew = {
      id: targetId,
      name: 'Target',
      type: 'basic',
      role: 'pilot',
      status: 'unconscious',
      location: null,
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
      playerShip: shipWithMedLabPower,
      playerCrew: [doctor, medic, target],
      playerCaptain: captain,
    });

    const reviveAction: PlayerAction = {
      playerId,
      crewId: reviverId,
      type: 'revive',
      parameters: {
        targetCrewId: targetId,
        stimmed: true,
        stimDoctorId: doctorId,
      },
    };

    const next = applyPlayerActions(game, {
      [playerId]: [reviveAction],
      [otherPlayerId]: [],
    });

    const nextPlayer = next.players.get(playerId);
    expect(nextPlayer).toBeTruthy();
    if (!nextPlayer) {
      return;
    }

    const updatedDoctor = nextPlayer.crew.find(c => c.id === doctorId);
    expect(updatedDoctor).toBeTruthy();
    expect((updatedDoctor as any)?.stimPacksUsed).toBe(1);

    const updatedTarget = nextPlayer.crew.find(c => c.id === targetId);
    expect(updatedTarget).toBeTruthy();
    expect(updatedTarget?.status).toBe('active');
  });

  it('consumes a stim pack and doubles restore power generated', () => {
    const ship = createInitialShip({ ring: 8, space: 0 });

    const doctorId = 'crew-doctor';
    const engineerId = 'crew-engineer';

    const doctor: AnyCrew = {
      id: doctorId,
      name: 'Doctor',
      type: 'officer',
      role: 'doctor',
      status: 'active',
      location: SHIP_SECTIONS.ENGINEERING,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
      stimPacksUsed: 0,
    };

    const engineer: AnyCrew = {
      id: engineerId,
      name: 'Engineer',
      type: 'basic',
      role: 'engineer',
      status: 'active',
      location: SHIP_SECTIONS.ENGINEERING,
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
      playerCrew: [doctor, engineer],
      playerCaptain: captain,
    });

    const before = game.players.get(playerId);
    expect(before).toBeTruthy();
    if (!before) {
      return;
    }
    const beforeEngineeringPower = before.ship.sections[SHIP_SECTIONS.ENGINEERING].powerDice.reduce((s, d) => s + d, 0);

    const restoreAction: PlayerAction = {
      playerId,
      crewId: engineerId,
      type: 'restore',
      parameters: {
        stimmed: true,
        stimDoctorId: doctorId,
      },
    };

    const next = applyPlayerActions(game, {
      [playerId]: [restoreAction],
      [otherPlayerId]: [],
    });

    const nextPlayer = next.players.get(playerId);
    expect(nextPlayer).toBeTruthy();
    if (!nextPlayer) {
      return;
    }

    const afterEngineeringPower = nextPlayer.ship.sections[SHIP_SECTIONS.ENGINEERING].powerDice.reduce((s, d) => s + d, 0);
    expect(afterEngineeringPower - beforeEngineeringPower).toBe(6);

    const updatedDoctor = nextPlayer.crew.find(c => c.id === doctorId);
    expect((updatedDoctor as any)?.stimPacksUsed).toBe(1);
  });

  it('consumes a stim pack and applies repair overflow to other conduit edges', () => {
    const ship = createInitialShip({ ring: 8, space: 0 });
    const damagedShip: Ship = {
      ...ship,
      sections: {
        ...ship.sections,
        [SHIP_SECTIONS.BRIDGE]: {
          ...ship.sections[SHIP_SECTIONS.BRIDGE],
          conduitConnections: {
            ...ship.sections[SHIP_SECTIONS.BRIDGE].conduitConnections,
            [SHIP_SECTIONS.ENGINEERING]: 1,
            [SHIP_SECTIONS.MED_LAB]: 1,
          },
        },
        [SHIP_SECTIONS.ENGINEERING]: {
          ...ship.sections[SHIP_SECTIONS.ENGINEERING],
          conduitConnections: {
            ...ship.sections[SHIP_SECTIONS.ENGINEERING].conduitConnections,
            [SHIP_SECTIONS.BRIDGE]: 1,
          },
        },
        [SHIP_SECTIONS.MED_LAB]: {
          ...ship.sections[SHIP_SECTIONS.MED_LAB],
          conduitConnections: {
            ...ship.sections[SHIP_SECTIONS.MED_LAB].conduitConnections,
            [SHIP_SECTIONS.BRIDGE]: 1,
          },
        },
      },
    };

    const doctorId = 'crew-doctor';
    const engineerId = 'crew-engineer';

    const doctor: AnyCrew = {
      id: doctorId,
      name: 'Doctor',
      type: 'officer',
      role: 'doctor',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      reviveProgress: 0,
      assembleProgress: 0,
      assembleItemType: null,
      stimPacksUsed: 0,
    };

    const engineer: AnyCrew = {
      id: engineerId,
      name: 'Engineer',
      type: 'basic',
      role: 'engineer',
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
      playerShip: damagedShip,
      playerCrew: [doctor, engineer],
      playerCaptain: captain,
    });

    const before = game.players.get(playerId);
    expect(before).toBeTruthy();
    if (!before) {
      return;
    }

    const beforeBridgeToEng = before.ship.sections[SHIP_SECTIONS.BRIDGE].conduitConnections[SHIP_SECTIONS.ENGINEERING] ?? 0;

    const repairAction: PlayerAction = {
      playerId,
      crewId: engineerId,
      type: 'repair',
      target: { section: SHIP_SECTIONS.MED_LAB },
      parameters: {
        repairType: 'conduit',
        stimmed: true,
        stimDoctorId: doctorId,
      },
    };

    const next = applyPlayerActions(game, {
      [playerId]: [repairAction],
      [otherPlayerId]: [],
    });

    const nextPlayer = next.players.get(playerId);
    expect(nextPlayer).toBeTruthy();
    if (!nextPlayer) {
      return;
    }

    const afterBridgeToEng = nextPlayer.ship.sections[SHIP_SECTIONS.BRIDGE].conduitConnections[SHIP_SECTIONS.ENGINEERING] ?? 0;
    expect(afterBridgeToEng).toBeGreaterThan(beforeBridgeToEng);

    const updatedDoctor = nextPlayer.crew.find(c => c.id === doctorId);
    expect((updatedDoctor as any)?.stimPacksUsed).toBe(1);
  });
});
