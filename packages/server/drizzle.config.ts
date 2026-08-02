/**
 * Purpose: Drizzle ORM configuration for database migrations and schema management
 * Root cause of creation: Need centralized configuration for database operations
 */

import { defineConfig } from 'drizzle-kit';
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

export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
