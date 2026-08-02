import {
  SHIP_SECTIONS,
  addPlayerToGame,
  createInitialShip,
  createNewGame,
  processTurn,
  seedStandardBoardObjects,
  serializeGameStateSnapshot,
  startGame,
  type AnyCrew,
  type Captain,
  type CaptainType,
} from '@gravity/core';

import type { SessionGameFactory, SessionParticipant } from './types';

const BOARD_SPEED_BY_RING = [4, 3, 3, 2, 2, 1, 1, 1];
const CAPTAIN_TYPES: CaptainType[] = [
  'merchant',
  'imperialist',
  'space_pirate',
  'technologist',
  'emissary',
  'explorer',
];

function createCaptain(participant: SessionParticipant): Captain {
  return {
    id: `${participant.playerId}:captain`,
    name: `Captain ${participant.displayName}`,
    type: 'captain',
    captainType: CAPTAIN_TYPES[(participant.seatNumber - 1) % CAPTAIN_TYPES.length],
    status: 'active',
    location: SHIP_SECTIONS.BRIDGE,
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  };
}

function createCrew(participant: SessionParticipant): AnyCrew[] {
  const base = {
    reviveProgress: 0,
    assembleProgress: 0,
    assembleItemType: null,
  };
  return [
    {
      ...base,
      id: `${participant.playerId}:first-officer`,
      name: 'First Officer',
      type: 'officer',
      role: 'first_officer',
      status: 'active',
      location: SHIP_SECTIONS.BRIDGE,
      stimPacksUsed: 0,
    },
    {
      ...base,
      id: `${participant.playerId}:chief-engineer`,
      name: 'Chief Engineer',
      type: 'officer',
      role: 'chief_engineer',
      status: 'active',
      location: SHIP_SECTIONS.ENGINEERING,
      stimPacksUsed: 0,
    },
    ...(['pilot', 'engineer', 'medic', 'scientist', 'tactician'] as const).map((role) => ({
      ...base,
      id: `${participant.playerId}:${role}`,
      name: role[0].toUpperCase() + role.slice(1),
      type: 'basic' as const,
      role,
      status: 'unconscious' as const,
      location: null,
    })),
  ];
}

/** Create the first server-authored, deterministic beta snapshot from durable lobby seats. */
export const gravitySessionGameFactory: SessionGameFactory = {
  create({ sessionId, participants, maxPlayers, now }) {
    let game = createNewGame({
      id: sessionId,
      createdAt: now,
      settings: {
        maxPlayers,
        rotationDirection: 'clockwise',
        expansions: ['core'],
      },
      boardSpeedByRing: BOARD_SPEED_BY_RING,
    });

    for (const participant of [...participants].sort(
      (left, right) => left.seatNumber - right.seatNumber,
    )) {
      game = addPlayerToGame(game, {
        id: participant.playerId,
        userId: participant.userId,
        isBot: false,
        ship: createInitialShip({ ring: 8, space: 0 }),
        crew: createCrew(participant),
        captain: createCaptain(participant),
      });
    }

    game = seedStandardBoardObjects(game);
    game = startGame(game, { startedAt: now });
    // Resolve the server-only opening event so players reconnect directly into planning.
    game = processTurn(game, {});
    return serializeGameStateSnapshot(game, 1);
  },
};
