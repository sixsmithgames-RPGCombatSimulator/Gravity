/**
 * Purpose: Database client setup and connection management
 * Single source of truth: Database connection created once and exported
 * Side effects: Creates database connection pool
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Validate DATABASE_URL environment variable
 * Root cause check: Prevents runtime errors from missing configuration
 * Throws: Error with clear guidance if DATABASE_URL not set
 */
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL environment variable is required.\n' +
    'Root cause: Environment variable DATABASE_URL is not set.\n' +
    'Fix: Copy .env.example to .env and set DATABASE_URL to your PostgreSQL connection string.'
  );
}

/**
 * Create PostgreSQL connection
 * Purpose: Establish connection pool for database operations
 * Configuration:
 * - max: Maximum number of connections in pool
 * - idle_timeout: Close idle connections after timeout
 */
const queryClient = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

/**
 * Create Drizzle ORM instance
 * Purpose: Provide type-safe database access
 * Schema: All tables and relations loaded from schema directory
 * Logger: Enable logging in development mode only
 */
export const db = drizzle(queryClient, {
  schema,
  logger: process.env.NODE_ENV === 'development',
});

/**
 * Close database connection
 * Purpose: Graceful shutdown of connection pool
 * Use case: Called during application shutdown
 */
export async function closeDatabase(): Promise<void> {
  await queryClient.end();
}

/**
 * Type export for database instance
 */
export type Database = typeof db;
