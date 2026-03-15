# Enemy Bot Process & Logging Plan

## Objectives
- Deliver robust, deterministic bot decision-making for enemy/bot players.
- Emit structured, reviewable console logs each turn: bot choices, action results, end-of-turn ship/object status.
- Keep implementation modular, testable, and compliant with existing engine patterns.

## Current Baseline
- Bot logic: `generateBotActions` and `selectBotActionForCrew` in `packages/core/src/engine/index.ts` (simple priority list).
- Batch: `generateAllBotActions` collects per-bot actions.
- Turn resolution: `processTurn` executes actions during `action_execution` phase.
- Web store: `packages/web/src/store/gameStore.ts` currently disables bot actions (`shouldDisableBotActions = true`).
- No structured logging to console for bot decisions or action resolution.

## Feasibility Review Findings
- The current bot logic is small enough to extract safely without changing behavior.
- The current turn engine is large and central, so invasive action-by-action instrumentation should be phased in carefully.
- A raw positional `logger` parameter would work, but an options object is more resilient for commercial maintenance because it avoids repeated API churn as rollout controls expand.
- The safest first implementation slice is:
  1. preserve existing bot choice behavior,
  2. move bot choice logic behind a strategy registry,
  3. add structured logging hooks,
  4. emit bot choice logs and end-of-turn summaries,
  5. enable bots behind an explicit store-level flag.
- Detailed per-action result logging should be a second-phase enhancement after the first phase proves stable, because the engine currently resolves actions in grouped rulebook batches rather than a single isolated action pipeline.

## Target Architecture
- Strategy-driven bots: Registry of strategies keyed by `player.botStrategy` with a default fallback.
- Deterministic scoring: Per-crew candidate generation + scoring (survival > escape > defense > support > economy) with tie-breaker by crew order.
- Validation-first: Every generated action is prevalidated (crew status/location, section power/intact, target existence/range, resource availability).
- Structured logging: Engine accepts optional instrumentation options; default no-op logger, dev logger prints concise structured lines to console.
- Backward-compatible public APIs: existing callers continue working without passing instrumentation options.
- Staged rollout: logging and bot enablement are independently controllable so debugging can happen before bots affect normal play.

## Commercial-Quality Requirements
- **Backward compatibility**
  - Do not break existing `@gravity/core` consumers.
  - Extend public APIs with an optional options object instead of replacing existing signatures.
- **Determinism**
  - Bot decisions must be deterministic for the same game state.
  - Log ordering must be deterministic to support debugging and snapshot tests.
- **Observability boundaries**
  - Console output must be concise and structured.
  - Logging must support multiple verbosity levels to avoid flooding the browser console.
  - Engine logging must remain optional and side-effect free when disabled.
- **Rollout safety**
  - Bot action execution and bot logging must be separate toggles.
  - Initial rollout should keep bot execution disabled by default in the web store until test coverage is in place.
- **Saved game compatibility**
  - Existing bot players may not have an explicit `botStrategy` value persisted.
  - Strategy resolution must treat the standard strategy as an explicit engine contract, not as an untracked silent behavior change.
- **Performance**
  - Turn summary generation must avoid deep-cloning the full game state for logging.
  - Console formatting should be linear in player/object count and only occur when logging is enabled.

## Modules to Introduce
1) **Bot Strategy Module** (`packages/core/src/engine/bot/DefaultBotStrategy.ts`)
   - Exports `defaultBotStrategy(game, player, options?) => PlayerAction[]`.
   - Contains candidate builders, scoring, and validation helpers.
   - Replaces inlined logic in `index.ts`; `generateBotActions` delegates to the registry.

2) **Bot Registry** (`packages/core/src/engine/bot/BotStrategyRegistry.ts`)
   - Map of strategy name → strategy function.
   - Resolves the engine-standard strategy name for bots that do not yet persist a strategy string.
   - Throws when a non-standard strategy name is requested but not registered.

3) **Logging and Instrumentation**
   - `packages/core/src/engine/logging/BotLogger.ts`
   - `packages/core/src/engine/logging/ConsoleBotLogger.ts`
   - `packages/core/src/engine/logging/NoopBotLogger.ts`
   - `packages/core/src/engine/logging/EngineInstrumentation.ts`
   - `BotLogger` interface with methods: `botDecision`, `actionResolution`, `turnSummary`, `warning`.
   - `EngineInstrumentationOptions` carries `logger`, log verbosity, and future rollout settings.

4) **Engine Integration**
   - Extend `processTurn`, `generateBotActions`, `generateAllBotActions`, and `applyPlayerActions` to accept an optional `options?: EngineInstrumentationOptions`.
   - Thread instrumentation through the call chain so bot decisions and action resolution can emit logs without requiring every caller to care about logging details.

## Decision Pipeline (Default Strategy)
- **Context building**: Threat map (ring danger, hazards, nearby hostiles), section health/power, available actions per crew.
- **Candidates per crew** (ordered generation):
  1. Repair critical hull (<4) in reachable sections.
  2. Restore power in Engineering if low (e.g., <2 dice) when crew in ENG.
  3. Maneuver outward/away from hazards if in danger rings or adjacent hostiles and underpowered.
  4. Attack adjacent hostiles (or torpedo at 2-3 range if available) with proper section/power checks.
  5. Revive unconscious crew when in MED_LAB and safe.
  6. Scan/acquire/economy (optional extension point).
  7. Fallback restore power.
- **Scoring**: Survival > escape > defense > support > economy. Apply distance, threat level, and ship state modifiers. Tie-break by crew order for determinism.
- **Validation**: Before accepting, ensure section powered/intact, target in range, paths valid (repair), and no duplicate crew actions. If invalid, log `warning` with reason and consider next candidate.
- **Selection**: Pick highest-scoring valid candidate; emit `botDecision` log with chosen + discarded candidates.

## Phased Rollout Plan
- **Phase 1: Safe extraction and observability**
  - Extract current bot logic into a default strategy module.
  - Add strategy registry and instrumentation types.
  - Emit bot choice logs and end-of-turn summaries.
  - Keep bot execution behind an explicit web-store gate.
- **Phase 2: Action result instrumentation**
  - Add grouped action resolution logging inside the engine pipeline.
  - Capture per-action-type or per-submitted-action deltas without destabilizing resolution order.
- **Phase 3: Smarter decision-making**
  - Replace ordered heuristics with scored candidates.
  - Add stronger threat assessment, safer movement rules, and improved target selection.
- **Phase 4: UX and support tooling**
  - Optional in-app debug panel or downloadable turn trace if console review becomes insufficient.

## Logging Shapes (structured, console-friendly)
- **Bot decision**
  ```ts
  botDecision({
    type: 'BOT_DECISION',
    turn,
    playerId,
    crewId,
    chosen, // PlayerAction
    priority, // string label
    rationale: string[],
    discarded: Array<{ action: PlayerAction; reason: string }>,
  });
  ```
- **Action resolution**
  ```ts
  actionResolution({
    type: 'ACTION_RESOLUTION',
    turn,
    playerId,
    crewId,
    actionType,
    target,
    result: 'success' | 'failed_validation' | 'no_effect',
    details: string,
  });
  ```
- **Turn summary**
  ```ts
  turnSummary({
    type: 'TURN_SUMMARY',
    turn,
    players: [
      {
        playerId,
        status,
        position,
        sections: Record<ShipSection, { hull: number; power: number }>,
      },
    ],
    hostiles: [
      { id, hull, position },
    ],
    objectsAdded?: string[],
    objectsRemoved?: string[],
  });
  ```
- **Warning**
  ```ts
  warning({
    type: 'BOT_WARNING',
    turn,
    playerId,
    crewId,
    message,
  });
  ```

## Logging Policy
- `off`: No logs.
- `summary`: End-of-turn summaries only.
- `choices`: Bot choices plus end-of-turn summaries.
- `verbose`: Bot choices, grouped action resolution logs, warnings, and end-of-turn summaries.
- Production default should remain `off` unless explicitly enabled.
- Development default can be `choices` once bots are stable enough for regular review.

## Engine Signature Changes
- `processTurn(game, actionsByPlayer, options?)` → thread to `applyPlayerActions` and any logging sites.
- `generateBotActions(game, playerId, options?)` → registry + strategy call.
- `generateAllBotActions(game, options?)` → pass to per-bot generation.
- `applyPlayerActions(game, actionsByPlayer, options?)` → emit grouped action logs once resolution instrumentation is added.
- `EngineInstrumentationOptions` should support:
  - `logger?: BotLogger`
  - `logLevel?: 'off' | 'summary' | 'choices' | 'verbose'`
  - future rollout fields without further signature changes

## Web Integration
- In `packages/web/src/store/gameStore.ts`:
  - Replace `shouldDisableBotActions` gate with explicit store-level constants for `enableBotActions` and `enableBotLogging`.
  - When enabled, call `generateAllBotActionsFromEngine(game, options)` and pass the same `options` into `processTurn`.
  - In dev builds, use `ConsoleBotLogger`; in prod, `NoopBotLogger`.
  - Keep the initial default as logging-enabled but bot-execution-disabled only if that can be done without misleading output; otherwise keep both off until bot execution is enabled intentionally.
  - Ensure logs print after turn execution: decisions, action results when available, turn summary.

## Testing Plan
- **Unit (core)**:
  - Registry returns the expected strategy for explicit and engine-standard strategy names.
  - Strategy selection priorities: repair over attack, outward maneuver in danger, attack when adjacent, revive when possible.
  - Validation skips invalid actions and logs `BOT_WARNING`.
  - Logger receives expected events; deterministic ordering.
  - Instrumentation options preserve behavior when omitted.
- **Integration**:
  - Simulate turn with bots + hostiles; assert resulting state and log sequence.
  - Snapshot formatting for `ConsoleBotLogger` in dev mode.
  - Web store honors bot enablement and logging toggles independently.

## Acceptance Criteria
- Bot-enabled turns can be toggled on without breaking human-only flow.
- The engine can run with no instrumentation options and produce identical game results.
- Console output is structured, readable, and deterministic.
- End-of-turn summaries provide enough ship/object detail to review what happened without inspecting raw state.
- The architecture supports later AI improvements without reworking the public API again.

## Migration Steps
1. Add instrumentation types and logger implementations (Noop, Console) in `logging/`.
2. Create bot strategy registry and default strategy module; refactor existing bot code to delegate without changing behavior.
3. Extend engine function signatures to accept optional instrumentation options.
4. Emit bot decision logs and end-of-turn summaries.
5. Add tests for registry, logging, option compatibility, and current bot behavior parity.
6. Update web store to use explicit enablement toggles and pass instrumentation options.
7. Add grouped action result instrumentation after the first logging pass is stable.

## Example Console Lines (dev)
- `BOT_DECISION t=5 P=bot-1 crew=C1 priority=attack target=hostile#h3 reason=["adjacent hostile","defense powered"]`
- `ACTION_RESOLUTION t=5 P=bot-1 crew=C1 action=attack target=hostile#h3 result=success details="dealt 6 hull, hostile destroyed -> debris"`
- `TURN_SUMMARY t=5 players=[...] hostiles=[...] objectsAdded=["debris#h3"]`
