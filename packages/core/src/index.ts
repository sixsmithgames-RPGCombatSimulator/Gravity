/**
 * Purpose: Main entry point for @gravity/core package
 * Exports: All public APIs from the game engine
 * Side effects: None (re-exports only)
 */

// Export all models and types
export * from './models';

// Export all constants
export * from './constants';
export * from './engine';

// Note: Engine and rules will be added in Phase 2
// export * from './engine';
// export * from './rules';
// export * from './ai';
// export * from './validation';

/**
 * Package version
 */
export const VERSION = '0.1.0';
