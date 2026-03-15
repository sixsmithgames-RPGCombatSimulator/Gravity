# Gravity Commercial Polish Work Statement

## Purpose
This document defines the work required to bring Gravity from its current prototype and playtest state to a commercially credible, player-ready product. It is intended to serve as the planning baseline for sequencing design, engineering, QA, UX, infrastructure, and launch-readiness work.

The immediate goal is not to add more features. The immediate goal is to make the game trustworthy, testable, teachable, and repeatable so that future polish and monetization efforts are built on a stable rules foundation.

## Executive Summary
Gravity already has three valuable assets:

- A substantial core rules engine in `packages/core/src/engine/index.ts`
- A polished professional videogame browser-facing UI shell in `packages/web`
- A body of written game rules and product planning documentation

However, it is not yet ready for commercial play because the project currently has rule drift, implementation drift, failing tests, incomplete multiplayer infrastructure, and an app shell that still behaves more like a local sandbox than a true product.

The highest-priority commercialization work is:

- Establish one canonical rules source
- Align engine behavior to that rules source
- Restore a fully green automated test suite
- Convert the web app from local mock play into a real session-based multiplayer experience
- Raise UX, onboarding, reliability, telemetry, and release discipline to commercial standards

Until those steps are complete, additional UI, monetization, or content work will increase product risk instead of reducing it.

## Current State Summary
Based on the current project review, the major commercialization blockers are:

### 1. Rules parity is not reliable
Scoring, spawn behavior, ship starting values, and damage values are not consistently defined across the rules draft and the engine. This means the app cannot yet be trusted as the authoritative version of the tabletop game.

### 2. The engine is the real source of gameplay behavior, but not yet the authoritative source of design truth
The most important gameplay logic currently lives in `packages/core/src/engine/index.ts`, while the written rules in `Gravity_Rules_Draft.txt` still contain contradictions. This creates a design-to-implementation gap that will produce invalid playtest feedback.

### 3. The browser app is still a development shell
The web client starts from mock data in `packages/web/src/App.tsx`, and bot flow is disabled in `packages/web/src/store/gameStore.ts`. That means the app does not yet provide the persistent, asynchronous, multiplayer-ready experience expected from a commercial product.

### 4. Automated verification is currently broken
The test suite is not green because several tests still use one-player fixtures while `startGame()` now enforces a two-player minimum. A failing default test suite blocks confident iteration.

### 5. Commercial product layers are premature until the simulation is stable
Monetization planning exists in docs, but entitlement, session, backend, telemetry, support, and operational workflows are not yet production-grade.

## Product Standard for Commercial Release
A commercially polished Gravity release should meet all of the following conditions:

- The digital game matches the approved tabletop rules with documented exceptions only where intentionally designed
- All game-critical calculations are covered by deterministic automated tests
- New players can learn the game through the app without external facilitation
- Multiplayer sessions can be created, resumed, and completed reliably
- Bots, if offered, behave consistently and support solo/testing use cases
- End-of-game scoring, rankings, and outcome explanations are transparent and auditable
- Errors are actionable, recoverable where appropriate, and never silent
- The UI communicates game state clearly across desktop-first play conditions
- Telemetry exists for funnel, tutorial, balance, and failure analysis
- Release operations support regression testing, staging, deployment, and rollback
- Monetization, if enabled, sits on top of a stable entitlement model and never conflicts with core gameplay access

## Recommended Delivery Strategy
The recommended path is a seven-phase program. The phases are sequential at the foundation level, then partially parallel after rules parity and test health are restored.

## Phase 0 - Canonical Rules Decision and Product Definition
### Objective
Choose the single authoritative rules source that every implementation, test, UI explanation, and future design change must follow.

### Why this phase comes first
The biggest present risk is not rendering quality or lack of commerce. The biggest risk is that the app may teach and simulate the wrong game. No commercial polish effort can succeed while rules authority is ambiguous.

### Work required
- Identify the decision owner for rules truth
  - This should be a single role or named person responsible for final rules adjudication.
- Audit all known contradictory rule areas
  - Scoring rules
  - Ship starting values
  - Event spawn cadence and composition
  - Hazard and environmental damage values
  - Any additional contradictions uncovered during deeper audit
- Produce a canonical rules spec
  - Create a new versioned document such as `docs/canonical-rules-spec.md`
  - For every rule, record:
    - Approved behavior
    - Source rationale
    - Whether current engine behavior matches
    - Whether UI behavior matches
    - Whether tests cover it
- Freeze rules changes during parity implementation except for explicit approval decisions
- Define release target
  - Decide whether the first commercial milestone is:
    - Closed alpha for trusted playtesters
    - Paid early access
    - Free open beta
    - Full commercial launch

### Deliverables
- Canonical rules document approved by product/design owner
- Issue list of all engine/rules mismatches
- Release definition for the next public milestone

### Acceptance criteria
- There is exactly one authoritative gameplay rules source
- All known contradictions are resolved or logged as explicit open decisions
- Engineers and designers can point to the same document for gameplay truth

## Phase 1 - Rules Engine Parity and Data Single Source of Truth
### Objective
Align the engine to the canonical rules and remove gameplay drift.

### Workstream A: scoring system unification
#### Current issue
Scoring exists in at least three incompatible forms:

- Rule draft scoring table
- Legacy `Game.calculateVictoryPoints(...)` helper in `packages/core/src/models/Game.ts`
- Active engine scorer in `packages/core/src/engine/index.ts`

#### Required next steps
- Decide the approved scoring model from the canonical rules phase
- Remove or deprecate stale scoring paths that are no longer authoritative
- Implement one scoring module only
  - Prefer a dedicated scorer module in core if separation improves maintainability
- Ensure the web UI consumes only the canonical scorer
- Add a score breakdown API/utility
  - End-of-game UI should not only show total score
  - It should show category-level contributions such as missions, escape, crew survival, resources, upgrades, and any bonuses
- Add test coverage for:
  - Baseline scoring
  - Edge cases
  - Tie scenarios
  - Captain/officer modifiers
  - Escaped versus wrecked player scoring rules

### Workstream B: starting ship state alignment
#### Current issue
The rules draft and `GameConfig.ts` disagree on core starting ship values, especially Med-Lab hull and speed.

#### Required next steps
- Decide approved starting values in the canonical rules spec
- Move all default ship initialization values behind one source of truth
- Audit all code that assumes starting hull, speed, power, or upgrades
- Update any UI labels, tutorial text, or examples that imply outdated defaults
- Add snapshot-style tests for initial ship state generation

### Workstream C: event and object spawn parity
#### Current issue
The written rules and engine disagree on object spawn timing, counts, and distributions.

#### Required next steps
- Decide whether the rules draft or current engine behavior is the intended design
- Centralize spawn configuration into one rules config structure
- Make spawn cadence and probability weights data-driven where possible
- Add deterministic tests around spawn rounds and object distributions
- Add developer diagnostics so playtesters can inspect why objects spawned

### Workstream D: damage rules alignment
#### Current issue
Hazard and environmental damage values are inconsistent within the rules draft, and the engine has already committed to one interpretation.

#### Required next steps
- Resolve damage contradictions in the canonical rules document
- Move damage values into one authoritative config surface
- Validate UI tooltips and combat explanations against those values
- Add tests around damage application and downstream effects such as life-support penalties and destruction thresholds

### Deliverables
- Unified gameplay constants and rules behavior across scoring, setup, spawn, and damage
- Removal of stale or misleading gameplay helper logic
- Expanded engine test coverage around canonical rules

### Acceptance criteria
- All audited parity gaps are either fixed or explicitly documented as accepted exceptions
- One scorer exists
- One setup configuration exists
- One damage configuration exists
- One spawn configuration exists
- UI text and gameplay behavior align with the same rules definitions

## Phase 2 - Test Health, Simulation Safety, and CI Discipline
### Objective
Make the codebase safe to change.

### Work required
- Restore the test suite to green immediately
  - Update one-player fixtures in maneuver/orbit tests or revise helpers so tests reflect valid game constraints
- Add missing regression tests for all newly unified rules behavior
- Split tests by category
  - Unit tests
  - Engine simulation tests
  - Store integration tests
  - UI component tests for key game-end and dashboard flows
- Add coverage for invalid-state protection
  - Invalid player counts
  - Illegal actions
  - Broken state transitions
  - End-game edge cases
- Add CI gates
  - Install verification for lint, typecheck, tests, and build
- Add a release checklist that requires green CI before merges to protected branches
- Add seed-based simulation tests if randomness is central to gameplay balance
- Add golden-state fixtures for critical turns and end-game results

### Deliverables
- Fully green default test suite
- CI pipeline with enforced quality gates
- Regression coverage for all high-risk rules systems

### Acceptance criteria
- `npm test` passes consistently on a clean checkout
- Core gameplay logic changes fail loudly when behavior drifts
- There is no known broken default verification path

## Phase 3 - Multiplayer Architecture and Real Session Flow
### Objective
Replace the local demo shell with a real product session model.

### Why this phase matters commercially
A commercial strategy game must support reliable session creation, player identity, persistence, reconnect/resume behavior, and clear turn ownership. Without this, the app remains a prototype even if the rules engine is correct.

### Work required
- Define the product session model
  - Matchmaking or private room creation
  - Invite/join flow
  - Save/resume strategy
  - Turn ownership and turn locking
  - Reconnect behavior
  - Host migration or authoritative server policy
- Expand `packages/server/src/server.ts` into a real game-session service
- Choose and document the game authority model
  - Server-authoritative recommended for commercial fairness and reliability
- Persist game sessions
  - Session metadata
  - Game state snapshots or event log
  - Player roster and identity
  - Move history / turn log
- Replace mock bootstrapping in `packages/web/src/App.tsx`
- Add authenticated session load, create, join, and resume flows
- Re-enable and formalize bot turn handling if bots are part of the near-term offering
- Design failure handling for disconnects and stale turns
- Add auditing so players can understand how the current state was reached

### Deliverables
- Real multiplayer session lifecycle
- Persistence layer for games and player participation
- Authenticated web flow instead of local mock initialization

### Acceptance criteria
- Players can create, join, leave, and resume real games
- Game state survives page refresh and reconnect
- The server is the trusted arbiter for turn progression and final results

## Phase 4 - UX, Onboarding, and Game Feel Polish
### Objective
Make the game legible, teachable, and satisfying for first-time and returning players.

### Workstream A: onboarding and learnability
- Add a guided first-game experience
- Add contextual rules explanations in the UI
- Explain why actions are available, unavailable, or recommended
- Add hover/state explanations for ship systems, crew roles, resources, orbit, damage, and scoring
- Add a post-game score breakdown with plain-language rationale

### Workstream B: readability and information hierarchy
- Audit `GameBoard.tsx` and `ShipDashboard.tsx` for state clarity
- Improve hierarchy for:
  - Current player turn
  - Phase and round timing
  - Urgent failures or hazards
  - Required player decisions
  - Resource deficits and damage severity
- Add clear action confirmations for destructive or irreversible actions
- Add animation and feedback carefully, with performance budget limits

### Workstream C: accessibility and usability
- Improve keyboard support and focus order
- Add color-contrast validation and non-color indicators for state
- Improve responsive behavior for likely playtest device sizes
- Standardize iconography and terminology
- Add loading, empty, and error states that explain next steps

### Workstream D: game-end presentation
- Upgrade the end-of-game overlay from score list to full match report
  - Final placement
  - Score breakdown
  - Outcome summary
  - Key moments / major events
  - Mission completion summary
  - Ship survival summary
  - Shareable summary for community playtests or social posting

### Deliverables
- First-session onboarding flow
- Improved state clarity in main board and dashboard surfaces
- Commercial-grade game-end summary and explanation layer

### Acceptance criteria
- New players can complete a first match without external coaching for core interactions
- The app clearly explains current state, options, and outcome
- UX playtests identify polish issues, not fundamental clarity failures

## Phase 5 - Bots, Solo Experience, and Balance Tooling
### Objective
Decide whether bots are a product pillar, a test tool, or both, then implement them to that standard.

### Work required
- Define bot product role
  - Solo mode content
  - Fill for missing multiplayer seats
  - Internal simulation/testing only
- If bots are player-facing:
  - Re-enable turn execution
  - Build behavior profiles by skill level or temperament
  - Ensure bots obey exactly the same game rules and timing constraints as humans
- Add simulation tooling for large-volume match runs
- Track balance metrics
  - Win rates by captain
  - Mission completion rates
  - Survival rates
  - Average score by strategy path
  - Session duration
- Build internal debug views for balance review
- Add replay or event-log export for problematic matches

### Deliverables
- Clear bot strategy and implementation scope
- Bot-capable simulation harness if required
- Balance dashboards or exports for playtest analysis

### Acceptance criteria
- Bots are either intentionally excluded from launch scope or support a clearly defined user promise
- Balance feedback is based on real metrics, not anecdotal observation only

## Phase 6 - Production Readiness, Telemetry, and Operations
### Objective
Make the app supportable in the real world.

### Work required
- Add structured telemetry across the player funnel
  - App open
  - Session create/join
  - Tutorial progress
  - Turn completion
  - Match completion
  - Drop-off points
  - Error boundaries and fatal state failures
- Add observability for backend services
  - Request tracing
  - Error logging
  - Performance metrics
  - Game-state mutation auditing
- Define environment strategy
  - Local
  - Staging
  - Production
- Create deployment and rollback procedures
- Add data backup and recovery policies for persisted sessions
- Define support tooling
  - Admin visibility into session state
  - Ability to inspect failed or stuck games
  - Safe remediation workflow
- Perform performance profiling for larger sessions and complex board states
- Add security review for auth, session ownership, entitlement gates, and server actions

### Deliverables
- Instrumented application and backend
- Deployment/runbook documentation
- Operational readiness baseline for live users

### Acceptance criteria
- The team can detect, diagnose, and respond to failures in production
- Releases can be rolled out and rolled back safely
- User-impacting issues are observable within minutes, not discovered by accident

## Phase 7 - Monetization, Packaging, and Commercial Launch Readiness
### Objective
Add commerce only after the gameplay and service foundations are trustworthy.

### Work required
- Finalize the free-core versus paid-unlock product model from `docs/unlock-plan.md`
- Implement entitlement as a single source of truth
- Connect auth identity to entitlement checks
- Add locked-content UX that is informative and non-disruptive
- Build a purchase success reconciliation flow
- Define launch packaging
  - Demo or free-core version
  - Founder edition or supporter bundle
  - Captain pack / cosmetic pack / expansion roadmap
- Add storefront assets
  - Screenshots
  - Trailer capture flow
  - Copy and feature bullets
  - FAQ
  - Support policy
- Define release channels
  - Web only
  - Steam later
  - Closed alpha mailing list
  - Creator / streamer preview access
- Run a commercial readiness review covering:
  - Technical quality
  - Rules trustworthiness
  - UX clarity
  - Monetization fairness
  - Support readiness
  - Community expectations

### Deliverables
- Production entitlement flow
- Commercial packaging decision
- Launch checklist and go/no-go process

### Acceptance criteria
- Monetization does not block core gameplay reliability
- Entitlements are trustworthy and supportable
- Launch materials match the actual game experience

## Cross-Functional Workstreams That Should Run Throughout
### Rules and documentation governance
- Every approved gameplay change updates:
  - Canonical rules doc
  - Engine implementation
  - Tests
  - Player-facing explanation where relevant
- Establish a change log for gameplay rule changes
- Require product sign-off for any rules-affecting PR

### QA and playtesting operations
- Create structured playtest scripts
- Create bug report templates with reproduction steps, seed/session identifiers, and expected-versus-actual behavior
- Tag bugs by category:
  - Rules parity
  - UX confusion
  - Performance
  - Multiplayer reliability
  - Visual polish
  - Balance

### Content and tutorial writing
- Standardize all in-app terminology against the canonical rules spec
- Create concise player-facing definitions for every major system
- Build a style guide for card text, action labels, tooltips, and end-game explanations

## Immediate Next Steps for the Next 30 Days
The highest-leverage short-term plan is:

### Week 1
- Approve one canonical rules source
- Create parity audit tracker for all known contradictions
- Fix the failing test suite so the baseline is green again

### Week 2
- Unify scoring into one authoritative implementation
- Align starting ship data with approved setup rules
- Resolve and implement approved hazard/environment damage values

### Week 3
- Align event/object spawn logic to the approved design
- Add deterministic regression tests for scoring, setup, damage, and spawn behavior
- Add score breakdown support for the end-game UI

### Week 4
- Replace local mock app bootstrapping with real session initialization design work
- Define the server-authoritative multiplayer architecture
- Produce a detailed implementation plan for persistence, reconnect, and turn ownership

## Suggested Backlog by Priority
### Tier 1 - must complete before external scale-up
- Canonical rules spec
- Rules parity implementation
- Green test suite
- Score breakdown and rules transparency
- Real session architecture definition

### Tier 2 - should complete before commercial launch announcement
- Persistence and reconnect support
- Onboarding/tutorial system
- Production telemetry and observability
- Accessibility and usability improvements
- Bot strategy decision and implementation

### Tier 3 - launch optimization and revenue readiness
- Entitlement model
- Commerce integration
- Storefront assets and launch packaging
- Support workflows and live-ops tooling
- Balance dashboards and replay tooling

## Risks if This Work Is Skipped or Sequenced Incorrectly
- Players will lose trust if the digital app does not match the approved tabletop rules
- Balance feedback will be polluted by implementation bugs rather than design reality
- UI polish work will be wasted if core rules continue changing underneath it
- Monetization added too early will amplify negative sentiment around a still-unreliable product
- Multiplayer bugs will be much more expensive to fix after public adoption than before
- A non-green test suite will slow every future gameplay iteration

## Staffing Recommendation
The work can be done by a small team, but the responsibilities should be explicit.

### Minimum roles
- Product/rules owner
- Gameplay engineer
- Frontend/UI engineer
- Backend/infrastructure engineer
- QA/playtest lead
- UX/content designer or technical writer

### If the team is very small
The minimum viable specialization is:

- One owner for rules/product decisions
- One engineer focused on engine parity and test stability
- One engineer focused on web, server, and session architecture
- One shared function for QA/playtest coordination

## Definition of Done for Commercial Readiness
Gravity should be considered commercially polished only when all of the following are true:

- Rules authority is explicit and current
- The engine matches that authority
- The app teaches the same game it simulates
- The automated test suite is green and meaningful
- Real multiplayer sessions exist and are reliable
- End-of-game outcomes are transparent and explainable
- New users can onboard without direct developer assistance
- Production telemetry and operational support are in place
- Monetization, if enabled, is fair, supportable, and layered on top of a stable product

## Recommended First Implementation Epic
If only one epic is started next, it should be:

### "Rules Authority and Engine Parity"
This epic should include:

- Canonical rules spec creation
- Scoring unification
- Starting ship state alignment
- Spawn rule alignment
- Damage rule alignment
- Regression tests for all of the above
- Removal or isolation of stale gameplay helpers that contradict the approved rules

This epic will produce the most leverage because it turns all future playtesting, UX work, and commercialization work into trustworthy work.

## Final Recommendation
Do not treat Gravity as a content-expansion or monetization project yet. Treat it first as a rules-authentication and product-foundation project.

The correct commercialization sequence is:

- Make the game correct
- Make the game testable
- Make the game session-based
- Make the game teachable
- Make the game observable
- Then make the game sellable

That order will produce a professional product with much stronger player trust, better playtest signal, and a far safer path to launch.
