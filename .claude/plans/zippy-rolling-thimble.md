# Gravity Architecture Plan (Phase 2)

This document describes the high-level architecture for the Gravity project, with a focus on Phase 2 game engine work and how it connects to the backend and web client.

---

## 1. Monorepo Overview

- **@gravity/core**
  - Platform-agnostic game engine and rules logic.
  - Pure TypeScript, no I/O or framework dependencies.
  - Single source of truth for:
    - Game state models (`GameState`, `PlayerState`, `Ship`, `Board`, `Crew`, cards, resources).
    - Game configuration and rule constants (`GameConfig`, environment damage, turn cadence, etc.).
    - Deterministic engine functions (setup, turn progression, action resolution, environment handling, AI decisions).

- **@gravity/server**
  - Node.js backend API and services.
  - Responsibilities:
    - HTTP/REST endpoints (game lifecycle, actions, querying state).
    - WebSocket channels for real-time game updates and turn resolution events.
    - Persistence (PostgreSQL via Drizzle), caching/queues (Redis, BullMQ).
    - User identity, authentication, authorization.
  - Uses `@gravity/core` for all game-related logic; does **not** reimplement rules.

- **@gravity/web**
  - React client (Vite, Tailwind, Zustand, etc.).
  - Responsibilities:
    - UI for lobby, game view, and turn submission.
    - Visual representation of board, ships, crew, and actions.
  - Talks to `@gravity/server` only; no direct dependency on `@gravity/core`.

---

## 2. Core Package Layering (`@gravity/core`)

`@gravity/core` is organized into the following conceptual layers:

1. **Models Layer** (`src/models`)
   - Type definitions and utility classes for:
     - `GameState`, `GameSettings`, `GameUtils`.
     - `PlayerState`, mission/upgrade/event cards, resources.
     - `Ship`, `ShipUtils` (sections, hull, power, wrecked criteria).
     - `Board`, `BoardUtils` (rings, objects, distances, positions, colors).
     - `Crew`, `CrewUtils` (roles, bonuses, movement and life support rules).
   - Properties:
     - Pure TypeScript types and pure helpers.
     - No knowledge of turn order, networking, or persistence.

2. **Constants / Configuration Layer** (`src/constants`)
   - `GameConfig.ts`:
     - Ship sections, hull and power requirements, storage, crew slots.
     - Board configuration (ring counts, colors, spaces per ring).
     - Environment damage per color zone.
     - Player limits, turn cadence (`EVENT_FREQUENCY`, `CYCLE_LENGTH`).
     - Power routing limits, initial ship state, crew thresholds.
   - Properties:
     - Single source of truth for numeric and structural rule parameters.
     - All engine logic reads from here; no hard-coded rule numbers elsewhere.

3. **Engine Layer** (`src/engine`)
   - Pure functions implementing the rulebook on top of models + constants.
   - Sub-domains (logical, can be separated into files over time):

     - **Setup**
       - `createBoardFromConfig(configOverrides?) → Board`
       - `createInitialShip(position, settings?) → Ship`
       - `createPlayerState(input) → PlayerState`
       - `createNewGame(settings) → GameState`
       - `addPlayerToGame(game, input) → GameState`
       - `startGame(game) → GameState`
       - Responsibilities:
         - Initialize a consistent game with valid boards, ships, players, decks, and starting positions.
         - Enforce player-count rules and configuration validity.

     - **Turn Lifecycle**
       - `getNextTurnPhase(turnPhase) → TurnPhase | null`
       - `advanceTurn(game) → GameState`
       - Later: `processTurn(game, actionsByPlayer) → GameState`.
       - Responsibilities:
         - Enforce global turn sequence: Event → Action planning → Action execution → Environment → Resolution.
         - Determine when to end the game using `GameUtils.shouldEndGame`.

     - **Actions & Resolution**
       - Future functions along the lines of:
         - `applyPlayerActions(game, actionsByPlayer) → GameState`
         - Specific resolvers for each advanced/basic action:
           - `resolveGeneratePower`, `resolveRevive`, `resolveRepair`, `resolveManeuver`, `resolveScan`, `resolveAcquire`, `resolveCombat`, `resolveAssemble`, etc.
       - Responsibilities:
         - Enforce prerequisites (crew location, power availability, ship section state).
         - Apply crew bonuses, upgrades, and resource effects.
         - Ensure deterministic resolution given inputs.

     - **Environment & Board Dynamics**
       - Functions such as:
         - `computeEnvironmentDamageForPosition(position, board) → { hull, conduits, corridors }`
         - `computeEnvironmentDamageForActivePlayers(game) → Record<playerId, Damage>`
         - `applyEnvironmentDamage(game) → GameState`
         - `updateOrbitsAndObjects(game) → GameState` (rotation, falling, decaying orbits, hostile movement, collisions).
       - Responsibilities:
         - Encode orbiting/falling rules and environment damage zones.
         - Move objects and ships according to speed, rings, events, and options.

     - **AI & Bots** (Phase 2+)
       - Pure strategy functions:
         - `chooseActionsForBot(game, playerId, strategyId) → PlayerActions`.
       - Responsibilities:
         - Suggest or fully decide actions for bot or hint systems, without side effects.

     - **Validation & Helpers**
       - Optional submodule for reusable validations:
         - Input validation for actions and setups.
         - Invariant checks for `GameState`.

4. **Public API Layer** (`src/index.ts`)
   - Re-exports:
     - Models: `export * from './models';`
     - Constants: `export * from './constants';`
     - Engine: `export * from './engine';`
   - This is the only import surface `@gravity/server` and tests should use.

---

## 3. Server Architecture (`@gravity/server`)

The server acts as the I/O boundary around the core engine. It never encodes rules itself.

### 3.1 Responsibilities

- Expose **REST endpoints** for game lifecycle and inspection:
  - `POST /games` → create new game using `createNewGame`.
  - `POST /games/:id/join` → add player via `addPlayerToGame`.
  - `POST /games/:id/start` → move game to `in_progress` via `startGame`.
  - `POST /games/:id/actions` → submit player actions (later `applyPlayerActions`).
  - `GET /games/:id` → fetch serialized `GameState`.

- Provide **WebSocket** or similar for real-time updates:
  - Subscribe to game state changes and turn resolutions.
  - Broadcast state after calls to `advanceTurn` / `processTurn`.

- Handle **persistence** and **identity**:
  - Map `GameState.id` and `PlayerState.userId` to database records.
  - Store serialized game states and action histories.
  - Use Redis for matchmaking, lobbies, locks, and queues where needed.

### 3.2 Interaction with Core

- Server code calls into `@gravity/core` functions only at well-defined points:
  - **Setup**: uses the setup functions to build games.
  - **Turn**: uses `advanceTurn` and (later) `processTurn`.
  - **Environment/AI**: uses pure engine helpers for non-player-driven changes.

- All error handling and validation from core bubbles up as structured errors the server converts into HTTP/WebSocket responses.

---

## 4. Web Client Architecture (`@gravity/web`)

### 4.1 Responsibilities

- Provide visual UI for:
  - Game lobby (list/join/create games).
  - In-game board view and ship consoles.
  - Turn planning and action submission.

- Talk only to `@gravity/server` via:
  - REST (create/join/start game, submit actions).
  - WebSockets or SSE (subscribe to state updates and events).

### 4.2 State Management

- Use client-side state (e.g. Zustand) for:
  - Current user session information.
  - Active game state mirror (normalized from server JSON).
  - Local UI-only flags (loading, toasts, modals).

- Avoid encoding rules in the client:
  - The client should interpret the state (e.g. show that an action is invalid) based on server-provided metadata, not its own alternate rule system.

---

## 5. Cross-Cutting Concerns

### 5.1 Single Source of Truth

- All rule numbers and configuration live in `@gravity/core/src/constants/GameConfig.ts`.
- All state structures live in `@gravity/core/src/models`.
- No derived/cached values are stored in multiple places; they are computed via utility functions or engine functions.

### 5.2 Purity and Determinism

- `@gravity/core` never performs I/O, logging, or randomness directly.
- Randomness (e.g. shuffling decks, drawing cards) is introduced by passing:
  - Pre-shuffled decks, or
  - An injected RNG function into core helpers.

### 5.3 Error Handling

- Core functions:
  - Validate inputs and state invariants.
  - Throw descriptive errors that include:
    - What failed.
    - Why it failed (root cause).
    - How to fix or avoid the error.

- Server translates these into HTTP error responses or WebSocket error messages.

### 5.4 Coding Standards Reference

- All code in this repository MUST follow the rules defined in `CODING_STANDARDS.md` at the repo root.
- The architecture and implementation plans in `.claude/plans/` assume compliance with that document; new code should be reviewed against it as part of development and code review.

---

## 6. Phase 2 Scope (High Level)

Phase 2 work in this architecture primarily covers:

- Implementing setup helpers and game initialization in `@gravity/core`.
- Building the turn lifecycle and action resolution pipeline.
- Implementing basic AI hooks.
- Wiring server endpoints and WebSockets around the new engine.
- Building minimal web UI screens that exercise the full stack end-to-end.

---

## 7. Design Principles and Constraints

- **Single source of truth**
  - All game rules and configuration values live in `@gravity/core/src/constants/GameConfig.ts`.
  - All game state shapes live in `@gravity/core/src/models`.
  - Neither `@gravity/server` nor `@gravity/web` may introduce alternate rule or state schemas.

- **Purity and determinism in core**
  - `@gravity/core` exposes **pure functions** only (no I/O, no logging, no timers, no randomness).
  - Any randomness required for gameplay (e.g. shuffles, draws) is provided **from the outside** via:
    - Pre-shuffled decks, or
    - Injected RNG functions passed as parameters.
  - Given the same inputs, all core functions must produce the same outputs.

- **Clear layer boundaries**
  - Core encodes **domain rules** only.
  - Server encodes **transport, persistence, and security** only.
  - Web client encodes **presentation and interaction** only.
  - Cross-layer coupling is always `web → server → core`, never the reverse.

- **Error handling policy**
  - Core functions validate inputs and invariants and throw descriptive errors with:
    - What failed.
    - Why it failed (root cause).
    - How to fix or avoid the error.
  - Server is responsible for mapping these errors into HTTP/WebSocket responses.

- **Extensibility without breaking rules**
  - New rules or variants must be expressed as:
    - New configuration in `GameConfig` and/or
    - Additional fields on existing models (with defaults) and/or
    - New pure functions reusing existing helpers.
  - Existing engine entry points should remain stable where possible; if breaking changes are needed, they should be versioned.

---

## 8. Dependency Rules

- **@gravity/core**
  - May depend on:
    - TypeScript/standard library utilities.
    - Internal modules within `src/models`, `src/constants`, `src/engine`.
  - Must **not** depend on:
    - Node.js APIs (fs, net, process, etc.).
    - Web frameworks, HTTP libraries, or database clients.
    - `@gravity/server` or `@gravity/web` (no circular dependencies).

- **@gravity/server**
  - May depend on:
    - `@gravity/core` public API.
    - HTTP framework, DB client, Redis client, queue libraries, logging.
  - Must **not**:
    - Duplicate rule logic implemented in core.
    - Mutate core state objects in-place across async boundaries without copying.

- **@gravity/web**
  - May depend on:
    - HTTP/WebSocket clients.
    - React, Zustand, Tailwind, routing, component libraries.
  - Must **not**:
    - Import `@gravity/core` directly.
    - Re-encode rules from the rulebook; it relies on server responses.

These rules prevent tight coupling and ensure that changes to game rules are localized to `@gravity/core`.

---

## 9. Testing Strategy

- **Unit tests in core**
  - Cover all pure helpers in:
    - `ShipUtils`, `BoardUtils`, `CrewUtils`, `GameUtils`.
    - New engine functions (setup, turn lifecycle, environment, actions).
  - Use fixed seeds or deterministic inputs for any randomness injected into core functions.
  - Include **rulebook parity tests** for critical flows (e.g. environment damage per ring color, wrecked-ship criteria, end-of-game conditions).

- **Integration tests in server**
  - Exercise REST endpoints and WebSocket flows against an in-memory or test database.
  - Verify that given game states and action submissions, responses match expectations and that server never diverges from core.

- **End-to-end tests**
  - Drive the system from the web client (or a headless client) through the server into core.
  - Validate:
    - Game creation/join/start.
    - A minimal turn sequence end-to-end.
    - Basic error cases (invalid actions, too few players, etc.).

- **Regression suite**
  - When bugs are found, add tests at the **lowest possible layer** that reproduces the issue, documenting root cause in comments in accordance with `CODING_STANDARDS.md`.

---

## 10. Serialization and Persistence Contracts

- **Game state serialization**
  - `GameState`, `PlayerState`, `Ship`, `Board`, and related structures must be serializable to JSON for:
    - Storage in PostgreSQL.
    - Transmission over HTTP/WebSockets.
  - Map-like structures (e.g. `Map<string, PlayerState>`) are represented using stable JSON-friendly forms (e.g. arrays of entries or plain objects), and the server is responsible for converting to/from these forms when reading/writing to the database.

- **Backward compatibility**
  - When models evolve, schema migrations must:
    - Provide defaults for new fields.
    - Avoid destructive changes to existing data whenever feasible.
  - If a breaking change to game rules is unavoidable, it should be versioned via:
    - A `rulesVersion` field in `GameSettings` or `GameState`.
    - Server routing older games to compatible engine behavior where necessary.

---

## 11. Observability and Logging

- **Core**
  - Contains **no logging**; it returns data structures and errors only.

- **Server**
  - Responsible for:
    - Request/response logging (excluding sensitive data).
    - Structured logs for game lifecycle events (creation, join, start, turn resolved, game completed).
    - Emitting metrics (e.g. turn processing time, active games, error rates).

- **Web**
  - May log client-side events for UX and debugging but should keep game-state logging minimal to avoid leaking information in multi-tenant deployments.

Observability concerns must not leak into `@gravity/core` to preserve purity and testability.

---

## 12. Non-Goals (Phase 2)

- Real-time physics or continuous-time simulation of ship movement.
- Full-featured replay/rollback system (beyond what is necessary to store snapshots and action logs).
- Cross-platform clients beyond the web (e.g. native mobile or desktop) — these can be added later using the same `@gravity/server` APIs.
- Highly optimized AI or ML-driven bots; Phase 2 focuses on basic, rules-correct strategies.

Being explicit about non-goals helps prevent scope creep and technical debt during Phase 2.

