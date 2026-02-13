/**
 * Purpose: Define users table schema for player authentication and profiles
 * Single source of truth: User identity and credentials stored here only
 * Side effects: None (schema definition)
 */

import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

/**
 * Users table - stores both registered users and guest accounts
 *
 * Key fields:
 * - id: Unique identifier for user
 * - username: Display name (unique)
 * - email: Email address (nullable for guests, unique for registered users)
 * - password_hash: Hashed password (nullable for guests)
 * - is_guest: Flag indicating guest account
 * - created_at: Account creation timestamp
 * - last_active: Last activity timestamp for cleanup
 *
 * Single source of truth: User identity stored once, referenced by foreign keys
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),

  // User identity
  username: varchar('username', { length: 50 }).notNull().unique(),
  email: varchar('email', { length: 255 }).unique(),

  // Authentication (nullable for guest accounts)
  password_hash: varchar('password_hash', { length: 255 }),

  // Account type
  is_guest: boolean('is_guest').notNull().default(false),

  // Timestamps
  created_at: timestamp('created_at').notNull().defaultNow(),
  last_active: timestamp('last_active').notNull().defaultNow(),
});

/**
 * Type exports for use in application code
 */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
