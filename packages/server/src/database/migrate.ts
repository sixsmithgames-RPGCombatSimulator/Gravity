/**
 * Purpose: Database migration script
 * Executes: Pending database migrations in order
 * Side effects: Modifies database schema
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Run database migrations
 * Purpose: Apply pending schema changes to database
 * Root cause of creation: Need automated migration execution
 */
async function runMigrations() {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    throw new Error(
      'Cannot run migrations: DATABASE_URL not set.\n' +
      'Root cause: Environment variable DATABASE_URL is missing.\n' +
      'Fix: Copy .env.example to .env and configure DATABASE_URL.'
    );
  }

  console.log('Starting database migrations...');

  // Create migration connection
  // Note: Use different connection for migrations to avoid conflicts
  const migrationClient = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    // Execute migrations from migrations folder
    await migrate(db, { migrationsFolder: './src/database/migrations' });
    console.log('✓ Database migrations completed successfully');
  } catch (error) {
    console.error('✗ Migration failed:');
    console.error(error);
    throw new Error(
      'Database migration failed.\n' +
      `Root cause: ${error instanceof Error ? error.message : 'Unknown error'}\n` +
      'Fix: Check database connection, review migration files, and ensure database is accessible.'
    );
  } finally {
    // Close connection
    await migrationClient.end();
  }
}

// Execute migrations if run directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migration process completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration process failed:', error);
      process.exit(1);
    });
}

export default runMigrations;
