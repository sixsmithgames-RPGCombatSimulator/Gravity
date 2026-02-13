/**
 * Purpose: Central export point for all database schemas
 * Exports: All tables, types, and enums for use throughout the application
 * Side effects: None (re-exports only)
 */

// Export all tables
export * from './users';
export * from './games';
export * from './players';
export * from './turns';

// Note: This file serves as the single point of import for database schemas
// Usage: import { users, games, players } from '@/database/schema';
