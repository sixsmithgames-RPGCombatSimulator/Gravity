import type { GameState, PlayerState } from '../models/Game';

export const GAME_STATE_WIRE_VERSION = 1 as const;

type WireGameState = Omit<GameState, 'players' | 'createdAt' | 'startedAt'> & {
  players: PlayerState[];
  createdAt: string;
  startedAt: string | null;
};

export type GameStateSnapshotV1 = {
  schemaVersion: typeof GAME_STATE_WIRE_VERSION;
  stateVersion: number;
  game: WireGameState;
};

export type DeserializedGameStateSnapshot = {
  stateVersion: number;
  game: GameState;
};

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `Cannot deserialize game-state snapshot because ${context} is not an object. ` +
        `Root cause: received ${Array.isArray(value) ? 'an array' : String(value)}. ` +
        'Fix: Send a snapshot produced by serializeGameStateSnapshot.',
    );
  }

  return value as Record<string, unknown>;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(
      `Cannot deserialize game-state snapshot because ${field} is invalid. ` +
        `Root cause: expected a non-negative integer, received ${String(value)}. ` +
        'Fix: Send a snapshot with a monotonic non-negative stateVersion.',
    );
  }

  return value as number;
}

function requireIsoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(
      `Cannot deserialize game-state snapshot because ${field} is invalid. ` +
        `Root cause: expected an ISO date string, received ${String(value)}. ` +
        'Fix: Send a snapshot produced by serializeGameStateSnapshot.',
    );
  }

  return new Date(value);
}

function requireNullableIsoDate(value: unknown, field: string): Date | null {
  if (value === null) {
    return null;
  }

  return requireIsoDate(value, field);
}

function validateSerializableDate(value: Date | null, field: string): string | null {
  if (value === null) {
    return null;
  }

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(
      `Cannot serialize game-state snapshot because ${field} is invalid. ` +
        `Root cause: expected a valid Date${field === 'startedAt' ? ' or null' : ''}. ` +
        'Fix: Initialize game timestamps through the core engine before serializing.',
    );
  }

  return value.toISOString();
}

/** Convert runtime-only Map and Date fields into a versioned JSON-safe snapshot. */
export function serializeGameStateSnapshot(game: GameState, stateVersion: number): GameStateSnapshotV1 {
  requireNonNegativeInteger(stateVersion, 'stateVersion');

  const players = Array.from(game.players.entries()).map(([mapKey, player]) => {
    if (mapKey !== player.id) {
      throw new Error(
        'Cannot serialize game-state snapshot because a player Map key does not match its player id. ' +
          `Root cause: Map key is "${mapKey}" while player.id is "${player.id}". ` +
          'Fix: Store each PlayerState under its own id before serializing.',
      );
    }
    return player;
  });

  players.sort((left, right) => left.playerOrder - right.playerOrder || left.id.localeCompare(right.id));

  return {
    schemaVersion: GAME_STATE_WIRE_VERSION,
    stateVersion,
    game: {
      ...game,
      players,
      createdAt: validateSerializableDate(game.createdAt, 'createdAt')!,
      startedAt: validateSerializableDate(game.startedAt, 'startedAt'),
    },
  };
}

/** Restore the core runtime shape and reject unknown wire versions or malformed boundary fields. */
export function deserializeGameStateSnapshot(snapshot: unknown): DeserializedGameStateSnapshot {
  const envelope = requireRecord(snapshot, 'the envelope');

  if (envelope.schemaVersion !== GAME_STATE_WIRE_VERSION) {
    throw new Error(
      'Cannot deserialize game-state snapshot because its schema version is unsupported. ' +
        `Root cause: expected schemaVersion ${GAME_STATE_WIRE_VERSION}, received ${String(envelope.schemaVersion)}. ` +
        'Fix: Migrate the snapshot to the current schema before loading it.',
    );
  }

  const stateVersion = requireNonNegativeInteger(envelope.stateVersion, 'stateVersion');
  const wireGame = requireRecord(envelope.game, 'game');

  if (typeof wireGame.id !== 'string' || wireGame.id.trim().length === 0) {
    throw new Error(
      'Cannot deserialize game-state snapshot because game.id is invalid. ' +
        `Root cause: expected a non-empty string, received ${String(wireGame.id)}. ` +
        'Fix: Send a snapshot for a game with a stable id.',
    );
  }

  if (!Array.isArray(wireGame.players)) {
    throw new Error(
      'Cannot deserialize game-state snapshot because game.players is invalid. ' +
        'Root cause: expected a player array in the wire format. ' +
        'Fix: Convert the runtime player Map with serializeGameStateSnapshot.',
    );
  }

  const players = new Map<string, PlayerState>();
  for (const rawPlayer of wireGame.players) {
    const playerRecord = requireRecord(rawPlayer, 'a game.players entry');
    const playerId = playerRecord.id;

    if (typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new Error(
        'Cannot deserialize game-state snapshot because a player id is invalid. ' +
          `Root cause: expected a non-empty string, received ${String(playerId)}. ` +
          'Fix: Send PlayerState entries with stable ids.',
      );
    }
    if (players.has(playerId)) {
      throw new Error(
        'Cannot deserialize game-state snapshot because a player id is duplicated. ' +
          `Root cause: game.players contains more than one entry for "${playerId}". ` +
          'Fix: Include each player exactly once in the snapshot.',
      );
    }

    players.set(playerId, rawPlayer as PlayerState);
  }

  const createdAt = requireIsoDate(wireGame.createdAt, 'game.createdAt');
  const startedAt = requireNullableIsoDate(wireGame.startedAt, 'game.startedAt');

  return {
    stateVersion,
    game: {
      ...(wireGame as unknown as GameState),
      players,
      createdAt,
      startedAt,
    },
  };
}

export function encodeGameStateSnapshot(game: GameState, stateVersion: number): string {
  return JSON.stringify(serializeGameStateSnapshot(game, stateVersion));
}

export function decodeGameStateSnapshot(payload: string): DeserializedGameStateSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Cannot decode game-state snapshot because the payload is not valid JSON. ' +
        `Root cause: ${message}. ` +
        'Fix: Send the exact output of encodeGameStateSnapshot.',
    );
  }

  return deserializeGameStateSnapshot(parsed);
}
