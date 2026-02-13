/**
 * Purpose: Drizzle ORM configuration for database migrations and schema management
 * Root cause of creation: Need centralized configuration for database operations
 */

import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL environment variable is not set.',
    {
      cause: {
        rootCause: 'Missing DATABASE_URL in environment variables',
        fix: 'Copy .env.example to .env and set DATABASE_URL to your PostgreSQL connection string'
      }
    }
  );
}

export default {
  schema: './src/database/schema/*.ts',
  out: './src/database/migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: DATABASE_URL,
  },
  verbose: true,
  strict: true,
} satisfies Config;
