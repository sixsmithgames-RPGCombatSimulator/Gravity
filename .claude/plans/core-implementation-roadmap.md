# Gravity Core Implementation Roadmap

This document provides a definitive, sequenced TODO list for completing the `@gravity/core` game engine. Each task builds on prior work to prevent technical debt.

---

## Current State Assessment

### Completed
- **Phase 1 - Setup Helpers**: `createBoardFromConfig`, `createInitialShip`, `createPlayerState`, `createNewGame`, `addPlayerToGame`, `startGame`
- **Models**: `GameState`, `PlayerState`, `Ship`, `Board`, `Crew`, `PlayerAction`, `TurnActions`
- **Constants**: `BOARD_CONFIG`, `SHIP_SECTIONS`, `INITIAL_SHIP_STATE`, `ENVIRONMENT_DAMAGE`, `TURN_CONFIG`
- **Card Data**: `CORE_EVENT_CARDS`, `CORE_MISSION_CARDS`, `CORE_ACTION_CARDS`, `CORE_UPGRADE_CARDS`, `CORE_CAPTAIN_CARDS`, `CORE_OFFICER_CARDS`
- **Environment**: `applyEnvironmentDamage`, `updateOrbitsAndObjects` (rotation, falling, hostile movement)
- **Turn Lifecycle**: `processTurn`, `advanceTurn`, `getNextTurnPhase`
- **Action Validation**: `applyPlayerActions` structural validation skeleton

### Incomplete
- Collision damage resolution (currently throws error)
- Action effect resolution (validation only, no state changes)
- Auto-generate phase (shields, life support)
- Wrecked ship state transitions
- Escape/slingshot mechanics

---

## Implementation Sequence

### Block A: Complete Environment Phase (Foundation)

Before actions can work correctly, the environment must be fully functional.

#### A.1 Collision Damage Constants
**File**: `constants/GameConfig.ts`
**Goal**: Define collision damage values as single source of truth (from rulebook).

```
COLLISION_DAMAGE = {
  asteroid_cluster: 12,
  debris: 6,
  hostile_ship: 4,     // Adjacent attack damage
  wrecked_ship: 9,
  functional_station: 12,
  hazard: { damage: 3, range: 2 }  // Radiation damage within range
}
```

**Exit Criteria**: Constants exported, no magic numbers elsewhere.

#### A.2 Collision Resolution Helper
**File**: `engine/index.ts`
**Goal**: Pure function `resolveCollision(ship, objectType) → Ship` that applies collision damage.

**Requirements**:
- Use `COLLISION_DAMAGE` constants
- Apply damage to random section (or player-chosen per rules variant)
- Return new Ship state with damage applied
- Validate inputs, fail fast with clear errors

**Exit Criteria**: Function exists, tested with unit tests.

#### A.3 Integrate Collision Resolution into updateOrbitsAndObjects
**File**: `engine/index.ts`
**Goal**: Replace collision detection errors with actual damage resolution.

**Requirements**:
- When player ship collides with object: apply `resolveCollision`
- When objects collide: handle per rulebook (hostiles become debris, etc.)
- Update `PlayerState.status` if ship becomes wrecked via `ShipUtils.isWrecked`
- Pure function, return new GameState

**Exit Criteria**: No more thrown errors for collisions; damage applied correctly.

#### A.4 Hazard Proximity Damage
**File**: `engine/index.ts`
**Goal**: Apply hazard radiation damage to ships within 2 spaces during environment phase.

**Requirements**:
- Check distance from each active player ship to each hazard
- If distance ≤ 2: apply 3 hull damage + 2 life support reduction
- Integrate into `applyEnvironmentDamage` or separate helper

**Exit Criteria**: Hazard damage applied per rulebook.

---

### Block B: Auto-Generate Phase

This runs at the end of actions, before environment, per rulebook sequence.

#### B.1 Auto-Generate Helper
**File**: `engine/index.ts`
**Goal**: Pure function `applyAutoGenerate(game) → GameState`.

**Requirements**:
- For each active player with functional Defense section: increase shields by 2 (if fully powered)
- Compute life support from `ShipUtils.calculateLifeSupport`
- If life support < active crew count: mark excess crew as unconscious
- Return new GameState

**Exit Criteria**: Function wired into `processTurn` at correct sequence point.

---

### Block C: Action Resolution Pipeline

This is the largest block. Actions are resolved in strict rulebook order.

#### C.1 Action Resolution Skeleton
**File**: `engine/index.ts`
**Goal**: Extend `applyPlayerActions` with ordered resolution pipeline.

**Structure**:
```ts
function applyPlayerActions(game, actionsByPlayer): GameState {
  // 1. Validate all actions (DONE)
  // 2. Group actions by type
  // 3. Resolve in order:
  //    - revive
  //    - repair
  //    - generate
  //    - maneuver
  //    - scan
  //    - acquire
  //    - attack/launch/retaliate
  //    - assemble
  //    - integrate
  // 4. Return new GameState
}
```

**Exit Criteria**: Pipeline structure in place, each action type calls a stub resolver.

#### C.2 Generate Action
**File**: `engine/index.ts`
**Goal**: Implement `resolveGenerateAction(game, action) → GameState`.

**Effects** (from rulebook):
- Base: +1 power in Engineering
- If Engineering fully powered: +3 power total
- Crew bonuses: Engineer +2, Chief Engineer +3, etc.
- Can route power to other sections (within conduit limits)
- Tactician: can also add +1 shield

**Requirements**:
- Validate crew is active and in correct section
- Validate power routing doesn't overload conduits
- Apply power changes immutably
- Use `CrewUtils.getBonuses` for crew modifiers

**Exit Criteria**: Generate action fully functional with crew bonuses.

#### C.3 Repair Action
**File**: `engine/index.ts`
**Goal**: Implement `resolveRepairAction(game, action) → GameState`.

**Effects**:
- Must be adjacent to damaged section (or in it for hull repair)
- Restore 1 hull point, or restore 1 conduit, or restore 1 corridor
- Engineer: 2x repairs for cost of 1
- Chief Engineer/Android: 3x repairs for cost of 1
- Consumes 1 power from adjacent section

**Requirements**:
- Validate crew location and section accessibility
- Validate power available
- Apply hull/conduit/corridor changes immutably

**Exit Criteria**: Repair action fully functional.

#### C.4 Revive Action
**File**: `engine/index.ts`
**Goal**: Implement `resolveReviveAction(game, action) → GameState`.

**Effects**:
- Roll d6, accumulate toward 6 points to revive
- Powered Med Lab: +2 to roll
- Medic: +1, Doctor: +2
- Med-Kit resource: +2
- If result ≥ 8: crew can act same turn

**Requirements**:
- Track revive progress on crew (use `reviveProgress` field)
- When progress ≥ 6: set crew status to 'active'
- Pure function (caller provides RNG or use deterministic seed)

**Exit Criteria**: Revive action fully functional.

#### C.5 Maneuver Action
**File**: `engine/index.ts`
**Goal**: Implement `resolveManeuverAction(game, action) → GameState`.

**Effects**:
- Generate acceleration from power spent + bonuses
- Move ship: in/out (ring change) or forward/backward (space change)
- Pilot: +1 acceleration, evasion tactics
- Ace Pilot: +2 acceleration, full evasion
- Bridge fully powered: +1 acceleration

**Requirements**:
- Validate crew on Bridge
- Validate power available in Drives
- Update `ship.position` and `ship.speed`
- Check new position validity

**Exit Criteria**: Maneuver action fully functional.

#### C.6 Scan Action
**File**: `engine/index.ts`
**Goal**: Implement `resolveScanAction(game, action) → GameState`.

**Effects**:
- Check range (adjacent, or +2 if Sci-Lab fully powered)
- Roll d6 for resource discovery based on object type:
  - Asteroid: 6+ = random resource
  - Debris: 4+ = random resource
  - Wreck: 2+ = resource, 5+ = upgrade
  - Station: auto resource, 4+ = upgrade
  - Hostile: +2 damage to next attack

**Requirements**:
- Validate crew in Sci-Lab or with range bonus
- Track scan results for later Acquire
- Store discovered resources/upgrades in pending state

**Exit Criteria**: Scan action fully functional.

#### C.7 Acquire Action
**File**: `engine/index.ts`
**Goal**: Implement `resolveAcquireAction(game, action) → GameState`.

**Effects**:
- Collect scanned resources/upgrades
- Add to `PlayerState.resources` or `PlayerState.pendingUpgrades`

**Requirements**:
- Validate scan was performed first
- Validate range

**Exit Criteria**: Acquire action fully functional.

#### C.8 Combat Actions (Attack, Launch, Retaliate)
**File**: `engine/index.ts`
**Goal**: Implement combat resolution.

**Effects**:
- Attack: roll damage dice, apply to target shields then hull
- Launch: fire torpedo (6 damage) at target
- Retaliate: free attack response when attacked

**Requirements**:
- Validate Defense section functional and powered
- Validate range
- Apply damage to target (player or object)
- Handle hostile ship destruction → becomes debris
- Track torpedo usage

**Exit Criteria**: Combat actions fully functional.

#### C.9 Assemble Action
**File**: `engine/index.ts`
**Goal**: Implement resource crafting.

**Effects**:
- Roll d6 to accumulate toward 6 points
- Craft: spare parts, med-kits, probes, torps

**Requirements**:
- Track assembly progress
- Add completed items to resources

**Exit Criteria**: Assemble action fully functional.

#### C.10 Integrate Action
**File**: `engine/index.ts`
**Goal**: Implement upgrade activation.

**Effects**:
- Move upgrade from `pendingUpgrades` to `installedUpgrades`
- Activate upgrade effects

**Requirements**:
- Validate crew in appropriate section
- Validate power requirements

**Exit Criteria**: Integrate action fully functional.

---

### Block D: Game State Transitions

#### D.1 Wrecked Ship Handling
**File**: `engine/index.ts`
**Goal**: Proper state transitions when ship becomes wrecked.

**Requirements**:
- When `ShipUtils.isWrecked(ship)` becomes true:
  - Set `PlayerState.status` to 'wrecked'
  - Ship falls toward center with objects
  - Player can only perform basic recovery actions
- Recovery conditions: 3 functional sections, 15+ hull, 6+ conduits, 2+ corridors

**Exit Criteria**: Wrecked state correctly entered/exited.

#### D.2 Escape Mechanics
**File**: `engine/index.ts`
**Goal**: Implement slingshot escape maneuver.

**Requirements**:
- Player declares escape from outer green ring
- Multi-turn sequence per rulebook
- Success: set `PlayerState.status` to 'escaped'
- Check end-game condition when half+ players escaped

**Exit Criteria**: Full escape sequence functional.

#### D.3 Game End and Victory Points
**File**: `engine/index.ts`
**Goal**: Implement final scoring.

**Requirements**:
- Calculate victory points per rulebook formula
- Return final scores when game ends

**Exit Criteria**: Victory point calculation accurate.

---

### Block E: Bot/AI Hooks

#### E.1 Bot Action Selection
**File**: `engine/index.ts` or new `ai/index.ts`
**Goal**: Implement `chooseActionsForBot(game, playerId, strategyId) → PlayerAction[]`.

**Requirements**:
- At least one basic strategy (survival-focused)
- Deterministic given seed
- Actions pass through same validation pipeline

**Exit Criteria**: Bots can play full games.

---

## Recommended Execution Order

Execute blocks in dependency order:

1. **A.1** → **A.2** → **A.3** → **A.4** (Complete environment)
2. **B.1** (Auto-generate)
3. **C.1** (Pipeline skeleton)
4. **C.2** (Generate - most basic action)
5. **C.3** (Repair - needed for recovery)
6. **C.4** (Revive - needed for crew)
7. **C.5** (Maneuver - needed for movement)
8. **C.6** → **C.7** (Scan/Acquire - needed for resources)
9. **C.8** (Combat - complex but self-contained)
10. **C.9** → **C.10** (Assemble/Integrate - depends on resources)
11. **D.1** (Wrecked handling)
12. **D.2** → **D.3** (Escape and scoring)
13. **E.1** (Bots)

---

## Coding Standards Checklist (Apply to Every Task)

- [ ] Pure functions (no side effects, no I/O)
- [ ] Explicit validation at boundaries (fail fast)
- [ ] Error messages include: what/why/how-to-fix
- [ ] No fallback values or `|| default` patterns
- [ ] Constants from `GameConfig`, no magic numbers
- [ ] Single source of truth (no duplicated data)
- [ ] Full function comments (purpose, params, return, side effects)
- [ ] PascalCase for types/interfaces, camelCase for functions, SCREAMING_SNAKE_CASE for constants

---

## Notes

- Each task should be completable in isolation once dependencies are met
- Unit tests should accompany each resolver function
- Integration tests should verify full turn cycles work correctly
- Defer edge cases and variant rules to later; get core mechanics working first
