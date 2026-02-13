# Gravity Core Implementation Plan (Phase 2)

This document describes a concrete implementation plan for the Phase 2 work around the Gravity game engine and its integration.

---

## Phase 0 – Baseline (Done / In Progress)

- Core models, constants, and basic utilities exist:
  - `GameState`, `PlayerState`, `Ship`, `Board`, `Crew`.
  - `GameConfig` with ship, board, environment, player, and turn constants.
  - Utilities like `ShipUtils`, `BoardUtils`, `CrewUtils`, `GameUtils`.
- Initial engine scaffolding:
  - `getNextTurnPhase(turnPhase)` and `advanceTurn(game)` in `src/engine`.
  - Environment damage calculators:
    - `computeEnvironmentDamageForPosition(position, board)`.
    - `computeEnvironmentDamageForActivePlayers(game)`.

---

## Phase 1 – Game Setup Helpers (`@gravity/core`)

### 1.1 Board and Ship Initialization

- **Goal:** Deterministic, reusable helpers to create a valid `Board` and starting `Ship` states from `GameConfig`.

- **Tasks:**
  - `createBoardFromConfig(options?) → Board`
    - Build `OrbitRing[]` from `BOARD_CONFIG` and `GameSettings.rotationDirection`.
    - Ensure `speedRequirement` and ring colors align with the rulebook.
  - `createInitialShip(position: ShipPosition, overrides?) → Ship`
    - Use `INITIAL_SHIP_STATE` for sections, hull, power, and conduits/corridors.
    - Place ship at a specified starting position on the outer ring.
    - Leave `speed` and `shields` consistent with rules (or allow overrides for variants).

### 1.2 Player and Game Creation

- **Goal:** Pure helper functions to construct lobby games and add players before starting.

- **Tasks:**
  - `createPlayerState(input) → PlayerState`
    - Inputs: `id`, `userId | null`, `isBot`, optional `botStrategy`, `playerOrder`.
    - Initialize:
      - `ship` via `createInitialShip` (without placing on board yet if needed).
      - Base `crew`, `captain`, and empty card/resource collections.
    - Defer mission and upgrade assignment to game start.
  - `createNewGame(settings: GameSettings & { id; createdAt; }) → GameState`
    - Initialize empty `players` map, `board`, empty decks.
    - Set `status: 'setup'`, `turnPhase: 'event'`, `currentTurn: 1`.
  - `addPlayerToGame(game, playerInput) → GameState`
    - Validate:
      - Game status is `setup`.
      - Player count does not exceed `PLAYER_CONFIG.MAX_PLAYERS`.
      - No duplicate `userId` or `playerId`.
    - Assign next `playerOrder` and insert `PlayerState` into `game.players`.

### 1.3 Start Game

- **Goal:** Transition from lobby to an in-progress game in a deterministic way.

- **Tasks:**
  - `startGame(game, options?) → GameState`
    - Validate:
      - Game status is `setup`.
      - Player count is within `MIN_PLAYERS` / `MAX_PLAYERS`.
    - Place ships on the outer ring, spaced according to rulebook (equidistant).
    - Initialize:
      - Mission cards per player (initial simple placeholder can be used until full deck exists).
      - Event and upgrade decks (accept them as inputs or inject RNG).
    - Set:
      - `status: 'in_progress'`.
      - `startedAt` timestamp (supplied by caller).
      - `turnPhase: 'event'`, `currentTurn: 1`.

---

## Phase 2 – Turn Lifecycle & Environment (`@gravity/core`)

### 2.1 Turn Lifecycle Integration

- **Goal:** Connect setup with the existing `advanceTurn` logic and prepare for full turn processing.

- **Tasks:**
  - Confirm `TurnPhase` sequence matches rulebook and docs.
  - Add a higher-level entry point like:
    - `processTurn(game, actionsByPlayer) → GameState` (stub initially).
  - Keep it pure by returning a new `GameState` without mutating input.

### 2.2 Environment & Orbits

- **Goal:** Implement orbiting/falling and environment damage application.

- **Tasks:**
  - `applyEnvironmentDamage(game) → GameState`
    - Use `computeEnvironmentDamageForActivePlayers`.
    - Apply hull/conduit/corridor damage to each active player ship.
    - Respect wrecked ship rules from `ShipUtils.isWrecked`, updating `PlayerState.status` when necessary.
  - `updateOrbitsAndObjects(game) → GameState`
    - Move orbit rings and objects according to the rules draft:
      - Per-turn rotation.
      - Falling (descending orbits) and optional decaying orbits.
      - Hostile movement toward closest ship and attacks.
    - Detect collisions and apply damage.
  - Integrate both into the `environment` phase so that `advanceTurn` (or future `processTurn`) calls them at the correct point in the turn.

---

## Phase 3 – Action System Skeleton (`@gravity/core`)

### 3.1 Action Model

- **Goal:** Define a serializable action model that the server/web can use.

- **Tasks:**
  - Define types:
    - `ActionType` union (generate, revive, repair, maneuver, scan, acquire, attack, launch, retaliate, assemble, integrate).
    - `PlayerAction` interface with:
      - `playerId`, `crewId`, `type`, `target`, and any parameters.
    - `TurnActions` as a map of `playerId → PlayerAction[]`.

### 3.2 Resolution Pipeline (High-Level)

- **Goal:** Provide a core function to resolve a batch of actions for all players according to the global sequence.

- **Tasks:**
  - `applyPlayerActions(game, actionsByPlayer) → GameState`
    - Validate all actions (structure, ownership, available crew, power, etc.).
    - Apply actions in rulebook-defined order (Revive → Repair → Generate → Maneuver → Scan → Acquire → Combat → Assemble → Auto-generate).
  - Defer full numeric tuning and all edge cases to later phases to keep initial implementation tractable.

---

## Phase 4 – AI / Bot Hooks (`@gravity/core`)

### 4.1 Strategy Interface

- **Goal:** Provide a clear hook for bots and later, assistive hints.

- **Tasks:**
  - Define a function like:
    - `chooseActionsForBot(game, playerId, strategyId) → PlayerAction[]`.
  - Keep strategies deterministic for a given seed.

---

## Phase 5 – Server Integration (`@gravity/server`)

### 5.1 REST & WebSocket API

- **Goal:** Wrap core engine in a clean API.

- **Tasks:**
  - Map HTTP endpoints to core functions:
    - `POST /games` → `createNewGame`.
    - `POST /games/:id/join` → `addPlayerToGame`.
    - `POST /games/:id/start` → `startGame`.
    - `POST /games/:id/actions` → `applyPlayerActions` + `advanceTurn`.
  - Implement WebSocket events:
    - `gameUpdated`, `turnResolved`, `playerJoined`, etc.

### 5.2 Persistence

- **Goal:** Store and retrieve `GameState` snapshots and action logs using the existing schema.

- **Tasks:**
  - Implement serialization/deserialization between `GameState` and DB rows.
  - Use Redis for transient lobby data and turn locks if needed.

---

## Phase 6 – Web Client Hooks (`@gravity/web`)

### 6.1 Minimal UI to Exercise the Stack

- **Goal:** Provide enough UI to drive and test the engine end-to-end.

- **Tasks:**
  - Lobby screen:
    - Create/join/start game using server endpoints.
  - Basic game view:
    - Show ring positions, ships, and a text-based console for ship state.
  - Action UI:
    - Simple forms to choose crew and actions, then submit to `POST /games/:id/actions`.

---

## Notes on Standards

- All new core functions must:
  - Be pure (no side effects or I/O).
  - Use `GameConfig` and models as single sources of truth (no duplicated rule values).
  - Have clear error messages (what/why/how to fix) when validation fails.
- All server and client work must treat `@gravity/core` as the authority for rules.
- All code changes across `@gravity/core`, `@gravity/server`, and `@gravity/web` MUST adhere to `CODING_STANDARDS.md` at the repo root; each phase in this plan should be implemented and reviewed with that document in hand.

---

## Milestones and Exit Criteria

- **Phase 1 – Game Setup Helpers**
  - *Exit criteria:*
    - Functions `createBoardFromConfig`, `createInitialShip`, `createPlayerState`, `createNewGame`, `addPlayerToGame`, and `startGame` implemented and exported from `@gravity/core`.
    - Unit tests cover:
      - Player count validation.
      - Ship and board initial positions and values matching the rulebook.
      - Transition from `setup` to `in_progress` only under valid conditions.
    - At least one server integration test calls these functions via a thin wrapper.

- **Phase 2 – Turn Lifecycle & Environment**
  - *Exit criteria:*
    - `applyEnvironmentDamage` and `updateOrbitsAndObjects` implemented and invoked during an `environment` phase.
    - Tests verify:
      - Environment damage per ring color matches `ENVIRONMENT_DAMAGE`.
      - Wrecked-ship rules and status updates are correct.
      - Objects and hostiles move as defined in the rules draft.
    - A simple CLI or script can progress a game through multiple turns deterministically.

- **Phase 3 – Action System Skeleton**
  - *Exit criteria:*
    - Action types and `PlayerAction` model defined and stable.
    - `applyPlayerActions` resolves a minimal subset of actions end-to-end (e.g. `Generate`, `Maneuver`, `Revive`) according to the sequence.
    - Invalid actions are rejected with clear error messages.

- **Phase 4 – AI / Bot Hooks**
  - *Exit criteria:*
    - A basic `chooseActionsForBot` implementation exists for at least one strategy.
    - Bot actions pass through the same validation and resolution pipeline as human actions.

- **Phase 5 – Server Integration**
  - *Exit criteria:*
    - Core functions are available through REST endpoints and basic WebSocket events.
    - Integration tests cover the main flows: create game, join, start, submit actions, advance turn.

- **Phase 6 – Web Client Hooks**
  - *Exit criteria:*
    - A developer can create a game, join with multiple players (or bots), play several turns, and see the board/console update via the web client.

---

## Risks and Mitigations

- **Risk:** Rules implementation diverges from the written rulebook over time.
  - *Mitigations:*
    - Maintain rulebook-parity tests in `@gravity/core` that encode critical examples.
    - Require linking code changes to specific rulebook sections in comments.

- **Risk:** Core API becomes difficult to evolve.
  - *Mitigations:*
    - Keep a narrow set of public engine entry points (setup, turn processing, actions, AI) and hide implementation details behind them.
    - Introduce versioning (e.g. `rulesVersion`) when making breaking rule changes.

- **Risk:** Performance issues when many games are running concurrently.
  - *Mitigations:*
    - Keep engine functions pure and efficient; profile pure logic separately from I/O.
    - Use server-level batching or scheduling to control how often environment updates are processed.

- **Risk:** Overly complex initial action system.
  - *Mitigations:*
    - Start with a small subset of actions and expand incrementally.
    - Defer advanced options and variants to later phases or feature flags.

---

## Stretch Goals and Backlog

- **Replay and history tools**
  - Persist per-turn action logs and snapshots to support replay or auditing.

- **Analytics and telemetry**
  - Aggregate statistics about missions, captains, and strategies to inform balance.

- **Additional clients**
  - CLI or desktop client that also talks to `@gravity/server`.

- **Advanced AI**
  - Stronger bot strategies or ML-driven hints built on top of the same `chooseActionsForBot` interface.

