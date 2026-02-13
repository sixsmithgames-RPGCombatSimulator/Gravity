# Coding Standards - Iron-Clad Rules

## 1. Error Handling - No Fallbacks Policy
**RULE**: Never use fallback values, default assumptions, or silent failure handling.

**REQUIREMENTS**:
- Implement explicit error trapping for all operations that can fail
- Every error message MUST include:
  - What went wrong (specific error condition)
  - Why it went wrong (root cause)
  - How to fix it (actionable steps for the user)
- Use try-catch blocks with specific error types where applicable
- Validate inputs at boundaries and fail fast with clear messages
- No `|| defaultValue` patterns - require explicit values

**EXAMPLE**:
```javascript
// ❌ BAD: Silent fallback
const config = loadConfig() || {};

// ✅ GOOD: Explicit error with guidance
const config = loadConfig();
if (!config) {
  throw new Error(
    'Configuration file not found. ' +
    'Root cause: config.json is missing from the project root. ' +
    'Fix: Create config.json using the template at config.template.json'
  );
}
```

## 2. Code Documentation - Full Context Required
**RULE**: All code must be fully commented with purpose and context.

**REQUIREMENTS**:
- Every function must have a comment explaining:
  - Purpose (what it does)
  - Parameters (what they represent)
  - Return value (what it returns)
  - Side effects (if any)
- Every code change must include:
  - Comment explaining what changed
  - Comment explaining why it changed
- When fixing bugs, MUST include root cause analysis in comments
- No self-evident comments - focus on the "why" not the "what"

**EXAMPLE**:
```javascript
/**
 * Purpose: Validates and normalizes user input before database insertion
 * Root cause of addition: Users were able to inject SQL through unescaped quotes
 * Parameters:
 *   - rawInput: Untrusted user input string
 * Returns: Sanitized string safe for database queries
 * Side effects: None
 */
function sanitizeInput(rawInput) {
  // Escape single quotes to prevent SQL injection (root cause of bug #142)
  return rawInput.replace(/'/g, "''");
}
```

## 3. Code Understanding - Never Assume
**RULE**: Never assume the purpose or function of any code.

**REQUIREMENTS**:
- ALWAYS use Read tool to fully read files before modifying
- Read entire file, not just sections (unless file is very large)
- Trace dependencies to understand full context
- If purpose is unclear, search for usage examples in codebase
- Document your understanding in comments

## 4. Modularity - Reusable Components
**RULE**: All code must be modular and easily reusable.

**REQUIREMENTS**:
- Functions should do one thing well (single responsibility)
- Avoid hardcoded values - use parameters or configuration
- Keep coupling loose - functions should not depend on global state
- Functions should be pure where possible (same input = same output)
- Extract common logic into shared utilities

## 5. Code Reuse - Check Before Writing
**RULE**: Always search for existing code before writing new code.

**REQUIREMENTS**:
- Use Grep/Glob to search for similar functionality before implementing
- Check for existing utilities, helpers, or libraries that solve the problem
- Reuse existing code where practical
- If existing code is close but not perfect, extend/modify it rather than duplicate
- Document why new code was needed if similar code exists

**PROCESS**:
1. Search codebase for similar function names
2. Search for similar patterns or logic
3. Check project dependencies for libraries
4. Only write new code if nothing suitable exists

## 6. Single Source of Truth
**RULE**: Any data stored must have exactly one authoritative source.

**REQUIREMENTS**:
- No duplicate storage of the same data
- No cached values without clear cache invalidation strategy
- No derived data stored alongside source data (compute on demand or use views)
- Configuration values must be defined in one place only
- Use references/IDs instead of copying data across entities

**EXAMPLE**:
```javascript
// ❌ BAD: User email stored in multiple places
const user = { id: 1, email: 'user@example.com' };
const profile = { userId: 1, email: 'user@example.com' }; // Duplicate!

// ✅ GOOD: Email stored once, referenced by ID
const user = { id: 1, email: 'user@example.com' };
const profile = { userId: 1 }; // Reference only
```

## 7. Naming and Style Conventions
**RULE**: Use consistent, explicit naming and file structure across the monorepo.

**REQUIREMENTS**:
- TypeScript types, interfaces, classes, and enums MUST use `PascalCase`.
- Functions, variables, and parameters MUST use `camelCase`.
- Configuration and rule constants (including exported constant objects) MUST use `SCREAMING_SNAKE_CASE` (for example `SHIP_SECTIONS`, `BOARD_CONFIG`, `ENVIRONMENT_DAMAGE`).
- Core model and constant files SHOULD use `PascalCase` filenames when they export a primary type (for example `Game.ts`, `Ship.ts`, `Board.ts`, `GameConfig.ts`), and `index.ts` for barrel files.
- Import paths SHOULD favor barrel exports (such as `@gravity/core/models`, `@gravity/core/constants`, `@gravity/core`) instead of deep relative imports from outside the package.
- Avoid ambiguous or abbreviated names unless they are domain-standard (for example `id`, `API`, `UUID`).

**EXAMPLE**:
```ts
// ✅ GOOD
export interface PlayerState { /* ... */ }
export const BOARD_CONFIG = { /* ... */ };
function computeEnvironmentDamage() { /* ... */ }

// ❌ BAD
export interface player_state { /* ... */ }
export const config = { /* ... */ };
function doStuff() { /* ... */ }
```

---

## Usage Instructions

Reference this document at the start of any coding session to ensure all code follows these standards. These rules are designed to:
- Prevent silent failures and improve debugging
- Maintain clear documentation for future developers
- Avoid assumptions that lead to bugs
- Keep code maintainable and reusable
- Eliminate data inconsistencies

**For AI Assistants**: These rules must be followed rigorously for all code written or modified in this project.
