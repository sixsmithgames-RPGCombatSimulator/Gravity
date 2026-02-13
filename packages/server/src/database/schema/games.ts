/**
 * Purpose: Define games and game_state tables for game management
 * Single source of truth: Game metadata and current state stored here only
 * Side effects: None (schema definition)
 */

import { pgTable, uuid, integer, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Game status enumeration
 * - setup: Game created, waiting for players
 * - in_progress: Game started, actively playing
 * - completed: Game finished normally
 * - abandoned: Game cancelled or all players left
 */
export const gameStatusEnum = pgEnum('game_status', ['setup', 'in_progress', 'completed', 'abandoned']);

/**
 * Turn phase enumeration
 * Defines the current phase of turn execution
 */
export const turnPhaseEnum = pgEnum('turn_phase', [
  'event',
  'action_planning',
  'action_execution',
  'environment',
  'resolution'
]);

/**
 * Games table - stores game metadata and configuration
 *
 * Key fields:
 * - id: Unique game identifier
 * - created_by: User who created the game
 * - status: Current game status (setup, in_progress, etc.)
 * - max_players: Maximum number of players (2-6)
 * - current_turn: Current turn number (starts at 1)
 * - turn_phase: Current phase of turn execution
 * - settings: Game configuration as JSONB (variant rules, etc.)
 * - winner_id: ID of winning player (null if game not complete)
 *
 * Single source of truth: Game configuration stored once
 */
export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Game ownership
  created_by: uuid('created_by')
    .notNull()
    .references(() => users.id),

  // Game state
  status: gameStatusEnum('status').notNull().default('setup'),
  max_players: integer('max_players').notNull().default(4),
  current_turn: integer('current_turn').notNull().default(0),
  turn_phase: turnPhaseEnum('turn_phase').notNull().default('action_planning'),

  // Game configuration (JSONB for flexibility)
  settings: jsonb('settings').notNull().default({}),

  // Timestamps
  created_at: timestamp('created_at').notNull().defaultNow(),
  started_at: timestamp('started_at'),
  ended_at: timestamp('ended_at'),

  // Winner (null if game not complete)
  winner_id: uuid('winner_id').references(() => users.id),
});

/**
 * Game State table - stores current authoritative game state
 *
 * Key fields:
 * - id: Unique identifier
 * - game_id: Reference to parent game (one-to-one relationship)
 * - board: Board state as JSONB (rings, objects, positions)
 * - event_deck: Remaining event cards as JSONB array
 * - upgrade_deck: Remaining upgrade cards as JSONB array
 * - updated_at: Last state update timestamp
 *
 * Single source of truth: Current game state stored once
 * Player-specific state stored in player_state table
 */
export const game_state = pgTable('game_state', {
  id: uuid('id').primaryKey().defaultRandom(),

  // One-to-one relationship with games
  game_id: uuid('game_id')
    .notNull()
    .unique()
    .references(() => games.id, { onDelete: 'cascade' }),

  // Board state (JSONB for flexible schema)
  // Structure: { rings: [...], objects: [...] }
  board: jsonb('board').notNull(),

  // Deck states (JSONB arrays)
  event_deck: jsonb('event_deck').notNull(),
  upgrade_deck: jsonb('upgrade_deck').notNull(),

  // Timestamp
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Type exports for use in application code
 */
export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type GameState = typeof game_state.$inferSelect;
export type NewGameState = typeof game_state.$inferInsert;
