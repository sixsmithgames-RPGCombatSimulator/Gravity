import { describe, expect, it } from 'vitest';

import type { AnyCrew, Captain } from '../models/Crew';
import type { GameSettings, PlayerAction } from '../models/Game';
import type { Ship } from '../models/Ship';
import { SHIP_SECTIONS } from '../constants/GameConfig';
import { addPlayerToGame, applyPlayerActions, createInitialShip, createNewGame, startGame } from './index';

function createGameForReviveTest(): {
  game: ReturnType<typeof createNewGame>;
  playerId: string;
  otherPlayerId: string;
  targetCrewId: string;
  doctorCrewId: string;
  captainCrewId: string;
} {
  const settings: GameSettings = {
    maxPlayers: 2,
    rotationDirection: 'clockwise',
    expansions: ['core'],
  };

  const gameId = 'revive-bonus-test-game';
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const boardSpeedByRing = [1, 1, 1, 1, 1, 1, 1, 1];

  let game = createNewGame({
    id: gameId,
    createdAt,
    settings,
    boardSpeedByRing,
  });

  const shipBase = createInitialShip({ ring: 8, space: 0 });
  const shipWithMedLabPower: Ship = {
    ...shipBase,
    sections: {
      ...shipBase.sections,
      [SHIP_SECTIONS.MED_LAB]: {
        ...shipBase.sections[SHIP_SECTIONS.MED_LAB],
        powerDice: [1],
      },
    },
  };

  const targetCrewId = 'crew-target';
  const doctorCrewId = 'crew-doctor';
  const captainCrewId = 'captain';

  const doctor: AnyCrew = {
    id: doctorCrewId,
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

  const target: AnyCrew = {
    id: targetCrewId,
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
    id: captainCrewId,
    name: 'Captain',
    type: 'captain',
    captainType: 'merchant',
    status: 'active',
    location: SHIP_SECTIONS.MED_LAB,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  };

  const playerId = 'player-1';
  const otherPlayerId = 'player-2';

  game = addPlayerToGame(game, {
    id: playerId,
    userId: 'user-1',
    isBot: false,
    ship: shipWithMedLabPower,
    crew: [doctor, target],
    captain,
  });

  game = addPlayerToGame(game, {
    id: otherPlayerId,
    userId: null,
    isBot: true,
    ship: shipWithMedLabPower,
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

  return {
    game,
    playerId,
    otherPlayerId,
    targetCrewId,
    doctorCrewId,
    captainCrewId,
  };
}

function createGameForFullyPoweredMedLabTest(): {
  game: ReturnType<typeof createNewGame>;
  playerId: string;
  otherPlayerId: string;
  targetCrewId: string;
  doctorCrewId: string;
  captainCrewId: string;
} {
  const settings: GameSettings = {
    maxPlayers: 2,
    rotationDirection: 'clockwise',
    expansions: ['core'],
  };

  const gameId = 'revive-bonus-fully-powered-test-game';
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const boardSpeedByRing = [1, 1, 1, 1, 1, 1, 1, 1];

  let game = createNewGame({
    id: gameId,
    createdAt,
    settings,
    boardSpeedByRing,
  });

  const shipBase = createInitialShip({ ring: 8, space: 0 });
  const shipWithMedLabPower: Ship = {
    ...shipBase,
    sections: {
      ...shipBase.sections,
      [SHIP_SECTIONS.MED_LAB]: {
        ...shipBase.sections[SHIP_SECTIONS.MED_LAB],
        powerDice: [6],
      },
    },
  };

  const targetCrewId = 'crew-target';
  const doctorCrewId = 'crew-doctor';
  const captainCrewId = 'captain';

  const doctor: AnyCrew = {
    id: doctorCrewId,
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

  const target: AnyCrew = {
    id: targetCrewId,
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
    id: captainCrewId,
    name: 'Captain',
    type: 'captain',
    captainType: 'merchant',
    status: 'active',
    location: SHIP_SECTIONS.MED_LAB,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  };

  const playerId = 'player-1';
  const otherPlayerId = 'player-2';

  game = addPlayerToGame(game, {
    id: playerId,
    userId: 'user-1',
    isBot: false,
    ship: shipWithMedLabPower,
    crew: [doctor, target],
    captain,
  });

  game = addPlayerToGame(game, {
    id: otherPlayerId,
    userId: null,
    isBot: true,
    ship: shipWithMedLabPower,
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

  return {
    game,
    playerId,
    otherPlayerId,
    targetCrewId,
    doctorCrewId,
    captainCrewId,
  };
}

describe('revive bonus', () => {
  it('applies +2 revive bonus for Doctor and 0 for Captain', () => {
    const doctorScenario = createGameForReviveTest();
    const doctorAction: PlayerAction = {
      playerId: doctorScenario.playerId,
      crewId: doctorScenario.doctorCrewId,
      type: 'revive',
      parameters: {
        targetCrewId: doctorScenario.targetCrewId,
      },
    };

    const afterDoctor = applyPlayerActions(doctorScenario.game, {
      [doctorScenario.playerId]: [doctorAction],
      [doctorScenario.otherPlayerId]: [],
    });

    const doctorPlayer = afterDoctor.players.get(doctorScenario.playerId);
    expect(doctorPlayer).toBeDefined();

    const doctorTarget = doctorPlayer?.crew.find((c) => c.id === doctorScenario.targetCrewId);
    expect(doctorTarget).toBeDefined();
    expect(doctorTarget?.reviveProgress).toBe(8);

    const captainScenario = createGameForReviveTest();
    const captainAction: PlayerAction = {
      playerId: captainScenario.playerId,
      crewId: captainScenario.captainCrewId,
      type: 'revive',
      parameters: {
        targetCrewId: captainScenario.targetCrewId,
      },
    };

    const afterCaptain = applyPlayerActions(captainScenario.game, {
      [captainScenario.playerId]: [captainAction],
      [captainScenario.otherPlayerId]: [],
    });

    const captainPlayer = afterCaptain.players.get(captainScenario.playerId);
    expect(captainPlayer).toBeDefined();

    const captainTarget = captainPlayer?.crew.find((c) => c.id === captainScenario.targetCrewId);
    expect(captainTarget).toBeDefined();
    expect(captainTarget?.reviveProgress).toBe(7);
  });

  it('applies Powered Med Lab bonus based on power before spending action cost', () => {
    const doctorScenario = createGameForFullyPoweredMedLabTest();
    const doctorAction: PlayerAction = {
      playerId: doctorScenario.playerId,
      crewId: doctorScenario.doctorCrewId,
      type: 'revive',
      parameters: {
        targetCrewId: doctorScenario.targetCrewId,
      },
    };

    const afterDoctor = applyPlayerActions(doctorScenario.game, {
      [doctorScenario.playerId]: [doctorAction],
      [doctorScenario.otherPlayerId]: [],
    });

    const doctorPlayer = afterDoctor.players.get(doctorScenario.playerId);
    expect(doctorPlayer).toBeDefined();
    const doctorTarget = doctorPlayer?.crew.find((c) => c.id === doctorScenario.targetCrewId);
    expect(doctorTarget).toBeDefined();
    expect(doctorTarget?.reviveProgress).toBe(10);

    const captainScenario = createGameForFullyPoweredMedLabTest();
    const captainAction: PlayerAction = {
      playerId: captainScenario.playerId,
      crewId: captainScenario.captainCrewId,
      type: 'revive',
      parameters: {
        targetCrewId: captainScenario.targetCrewId,
      },
    };

    const afterCaptain = applyPlayerActions(captainScenario.game, {
      [captainScenario.playerId]: [captainAction],
      [captainScenario.otherPlayerId]: [],
    });

    const captainPlayer = afterCaptain.players.get(captainScenario.playerId);
    expect(captainPlayer).toBeDefined();
    const captainTarget = captainPlayer?.crew.find((c) => c.id === captainScenario.targetCrewId);
    expect(captainTarget).toBeDefined();
    expect(captainTarget?.reviveProgress).toBe(9);
  });
});
