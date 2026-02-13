/**
 * Purpose: Define players and player_state tables for player management
 * Single source of truth: Player metadata and ship state stored here only
 * Side effects: None (schema definition)
 */

import { pgTable, uuid, integer, varchar, boolean, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { games } from './games';
import { users } from './users';

/**
 * Player status enumeration
 * - active: Player is actively playing
 * - eliminated: Player's ship was destroyed
 * - escaped: Player successfully escaped the gravity well
 * - wrecked: Player's ship is wrecked but can recover
 */
export const playerStatusEnum = pgEnum('player_status', ['active', 'eliminated', 'escaped', 'wrecked']);

/**
 * Players table - stores player metadata for each game
 *
 * Key fields:
 * - id: Unique player identifier
 * - game_id: Reference to parent game
 * - user_id: Reference to user (null for bots)
 * - is_bot: Flag indicating bot player
 * - bot_strategy: AI strategy name if bot (e.g., 'rule_based')
 * - player_order: Turn order (0-based index)
 * - status: Current player status
 * - joined_at: Timestamp when player joined
 *
 * Single source of truth: Player metadata stored once
 * Constraints: Unique (game_id, player_order) ensures no duplicate turn orders
 */
export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Game association
  game_id: uuid('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),

  // User association (null for bots)
  user_id: uuid('user_id').references(() => users.id),

  // Bot configuration
  is_bot: boolean('is_bot').notNull().default(false),
  bot_strategy: varchar('bot_strategy', { length: 50 }),

  // Player order (0-based, used for turn sequence)
  player_order: integer('player_order').notNull(),

  // Player status
  status: playerStatusEnum('status').notNull().default('active'),

  // Timestamp
  joined_at: timestamp('joined_at').notNull().defaultNow(),
});

/**
 * Player State table - stores current player-specific game state
 *
 * Key fields:
 * - id: Unique identifier
 * - player_id: Reference to parent player (one-to-one relationship)
 * - ship: Ship state as JSONB (sections, speed, shields, position)
 * - crew: Crew state as JSONB (active, unconscious, dead)
 * - captain: Captain card as JSONB
 * - officers: Officer cards as JSONB array
 * - missions: Mission cards as JSONB array
 * - action_deck: Remaining action cards as JSONB array
 * - resources: Resources as JSONB object
 * - upgrades: Installed upgrades as JSONB array
 * - pending_upgrades: Upgrades not yet integrated as JSONB array
 * - updated_at: Last update timestamp
 *
 * Single source of truth: Player state stored once, no duplication
 * Ship state structure:
 * {
 *   sections: { bridge: {...}, engineering: {...}, ... },
 *   speed: number,
 *   shields: number,
 *   position: { ring: number, space: number }
 * }
 */
export const player_state = pgTable('player_state', {
  id: uuid('id').primaryKey().defaultRandom(),

  // One-to-one relationship with players
  player_id: uuid('player_id')
    .notNull()
    .unique()
    .references(() => players.id, { onDelete: 'cascade' }),

  // Ship state (JSONB for flexible schema)
  ship: jsonb('ship').notNull(),

  // Crew state (JSONB)
  crew: jsonb('crew').notNull(),

  // Cards (JSONB)
  captain: jsonb('captain').notNull(),
  officers: jsonb('officers').notNull(),
  missions: jsonb('missions').notNull(),
  action_deck: jsonb('action_deck').notNull(),

  // Resources and upgrades (JSONB)
  resources: jsonb('resources').notNull().default({}),
  upgrades: jsonb('upgrades').notNull().default([]),
  pending_upgrades: jsonb('pending_upgrades').notNull().default([]),

  // Timestamp
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Type exports for use in application code
 */
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type PlayerState = typeof player_state.$inferSelect;
export type NewPlayerState = typeof player_state.$inferInsert;
