/**
 * Purpose: Persist the authoritative multiplayer lobby, membership, snapshots, and submission dedupe records.
 * Single source of truth: PostgreSQL owns durable membership and game-state versions; sockets own presence only.
 */

import type { GameStateSnapshotV1, PlayerAction } from '@gravity/core';
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './users';

export const sessionStatusEnum = pgEnum('session_status', [
  'lobby',
  'active',
  'ended',
  'abandoned',
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: sessionStatusEnum('status').notNull().default('lobby'),
  join_code_hash: varchar('join_code_hash', { length: 64 }).notNull().unique(),
  max_players: integer('max_players').notNull(),
  created_by: uuid('created_by')
    .notNull()
    .references(() => users.id),
  state_version: integer('state_version').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  started_at: timestamp('started_at', { withTimezone: true }),
  ended_at: timestamp('ended_at', { withTimezone: true }),
});

export const session_participants = pgTable(
  'session_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    session_id: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .references(() => users.id),
    player_id: uuid('player_id').notNull().defaultRandom(),
    display_name: varchar('display_name', { length: 50 }).notNull(),
    seat_number: integer('seat_number').notNull(),
    is_ready: boolean('is_ready').notNull().default(false),
    is_bot: boolean('is_bot').notNull().default(false),
    joined_at: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('session_participants_session_user_unique').on(table.session_id, table.user_id),
    uniqueIndex('session_participants_session_seat_unique').on(table.session_id, table.seat_number),
    uniqueIndex('session_participants_session_player_unique').on(table.session_id, table.player_id),
  ],
);

export const state_snapshots = pgTable(
  'state_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    session_id: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    state_version: integer('state_version').notNull(),
    turn_number: integer('turn_number').notNull(),
    schema_version: integer('schema_version').notNull(),
    state: jsonb('state').$type<GameStateSnapshotV1>().notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('state_snapshots_session_version_unique').on(table.session_id, table.state_version),
  ],
);

export const turn_submissions = pgTable(
  'turn_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    session_id: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    participant_id: uuid('participant_id')
      .notNull()
      .references(() => session_participants.id, { onDelete: 'cascade' }),
    submission_id: uuid('submission_id').notNull(),
    expected_state_version: integer('expected_state_version').notNull(),
    actions: jsonb('actions').$type<PlayerAction[]>().notNull(),
    result_state_version: integer('result_state_version'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    committed_at: timestamp('committed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('turn_submissions_session_submission_unique').on(
      table.session_id,
      table.submission_id,
    ),
    uniqueIndex('turn_submissions_player_version_unique').on(
      table.session_id,
      table.participant_id,
      table.expected_state_version,
    ),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type SessionParticipantRow = typeof session_participants.$inferSelect;
export type StateSnapshotRow = typeof state_snapshots.$inferSelect;
