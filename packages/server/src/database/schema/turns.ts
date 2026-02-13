/**
 * Purpose: Define turns, player_actions, action_results, and game_events tables
 * Single source of truth: Immutable history of game turns and events
 * Side effects: None (schema definition)
 */

import { pgTable, uuid, integer, varchar, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { games } from './games';
import { players } from './players';

/**
 * Turns table - stores immutable turn history
 *
 * Key fields:
 * - id: Unique turn identifier
 * - game_id: Reference to parent game
 * - turn_number: Sequential turn number (1-based)
 * - phase: Turn phase name
 * - started_at: Turn start timestamp
 * - completed_at: Turn completion timestamp (null if in progress)
 * - event_card: Event card drawn this turn (null if not event phase)
 *
 * Immutable: Records are never modified after creation
 * Constraint: Unique (game_id, turn_number)
 */
export const turns = pgTable('turns', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Game association
  game_id: uuid('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),

  // Turn identification
  turn_number: integer('turn_number').notNull(),
  phase: varchar('phase', { length: 50 }).notNull(),

  // Timestamps
  started_at: timestamp('started_at').notNull().defaultNow(),
  completed_at: timestamp('completed_at'),

  // Event card (JSONB, null if not event phase)
  event_card: jsonb('event_card'),
});

/**
 * Player Actions table - stores submitted actions per player per turn
 *
 * Key fields:
 * - id: Unique identifier
 * - turn_id: Reference to parent turn
 * - player_id: Reference to player
 * - actions: Array of action objects as JSONB
 * - submitted_at: Action submission timestamp
 * - processed_at: Action processing timestamp (null if not yet processed)
 *
 * Immutable: Records are never modified after creation
 * Constraint: Unique (turn_id, player_id) - one submission per player per turn
 *
 * Actions structure:
 * [
 *   { type: 'generate', crewId: '...', routing: [...] },
 *   { type: 'repair', crewId: '...', target: '...' },
 *   ...
 * ]
 */
export const player_actions = pgTable('player_actions', {
  id: uuid('id').primaryKey().defaultRandom(),

  // References
  turn_id: uuid('turn_id')
    .notNull()
    .references(() => turns.id, { onDelete: 'cascade' }),

  player_id: uuid('player_id')
    .notNull()
    .references(() => players.id, { onDelete: 'cascade' }),

  // Actions (JSONB array)
  actions: jsonb('actions').notNull(),

  // Timestamps
  submitted_at: timestamp('submitted_at').notNull().defaultNow(),
  processed_at: timestamp('processed_at'),
});

/**
 * Action Results table - stores execution results for each action
 *
 * Key fields:
 * - id: Unique identifier
 * - turn_id: Reference to parent turn
 * - player_id: Reference to player
 * - action_index: Order in submitted actions array (0-based)
 * - action_type: Type of action (e.g., 'generate', 'repair')
 * - success: Whether action succeeded
 * - result: Detailed results as JSONB
 * - errors: Error details if action failed (JSONB, null if succeeded)
 * - executed_at: Execution timestamp
 *
 * Immutable: Records are never modified after creation
 *
 * Result structure examples:
 * - Generate: { powerGenerated: 5, powerRouted: [...], overloadedConduits: [...] }
 * - Attack: { damageDealt: 12, targetShields: 8, targetHull: 4, ... }
 * - Repair: { hullRestored: 2, conduitsRepaired: 1, ... }
 */
export const action_results = pgTable('action_results', {
  id: uuid('id').primaryKey().defaultRandom(),

  // References
  turn_id: uuid('turn_id')
    .notNull()
    .references(() => turns.id, { onDelete: 'cascade' }),

  player_id: uuid('player_id')
    .notNull()
    .references(() => players.id, { onDelete: 'cascade' }),

  // Action identification
  action_index: integer('action_index').notNull(),
  action_type: varchar('action_type', { length: 50 }).notNull(),

  // Result
  success: boolean('success').notNull(),
  result: jsonb('result').notNull(),
  errors: jsonb('errors'),

  // Timestamp
  executed_at: timestamp('executed_at').notNull().defaultNow(),
});

/**
 * Game Events table - stores immutable event log
 *
 * Key fields:
 * - id: Unique identifier
 * - game_id: Reference to parent game
 * - turn_id: Reference to turn (null for non-turn events like player_joined)
 * - event_type: Type of event
 * - data: Event data as JSONB
 * - created_at: Event timestamp
 *
 * Immutable: Records are never modified after creation
 *
 * Event types:
 * - player_joined, player_left, game_started, game_ended
 * - combat, collision, ship_damaged, ship_wrecked, ship_escaped
 * - crew_revived, crew_knocked_out, section_damaged, section_repaired
 * - resource_acquired, upgrade_installed, mission_completed
 *
 * Event data structure varies by type
 */
export const game_events = pgTable('game_events', {
  id: uuid('id').primaryKey().defaultRandom(),

  // References
  game_id: uuid('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),

  turn_id: uuid('turn_id').references(() => turns.id, { onDelete: 'cascade' }),

  // Event data
  event_type: varchar('event_type', { length: 50 }).notNull(),
  data: jsonb('data').notNull(),

  // Timestamp
  created_at: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Type exports for use in application code
 */
export type Turn = typeof turns.$inferSelect;
export type NewTurn = typeof turns.$inferInsert;
export type PlayerAction = typeof player_actions.$inferSelect;
export type NewPlayerAction = typeof player_actions.$inferInsert;
export type ActionResult = typeof action_results.$inferSelect;
export type NewActionResult = typeof action_results.$inferInsert;
export type GameEvent = typeof game_events.$inferSelect;
export type NewGameEvent = typeof game_events.$inferInsert;
