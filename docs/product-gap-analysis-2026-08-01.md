# Gravity Product Gap Analysis

**Assessment date:** 2026-08-02  
**Evaluated state:** Current workspace, including uncommitted changes  
**Target standard:** A trustworthy, polished, commercially supportable asynchronous multiplayer game  
**Current maturity:** Beta candidate; production-like local staging/recovery certification complete, external staging remains

## Executive Summary

Gravity has a substantial game-engine foundation, a visually coherent game surface, and now a real private multiplayer path. The current workspace passes an npm 10 clean install, lint across all workspaces, 84 core tests, 24 server tests plus a real PostgreSQL integration test, 2 web tests, committed memory and PostgreSQL/Redis two-browser journeys, all production builds, enforceable core coverage thresholds, and both no-cache Docker image builds. The durable rehearsal includes two waves of 12 authenticated reconnects and a logical backup/restore verification. The production UI renders without framework overlays or console errors, scrolls correctly without horizontal overflow at 390 px, and includes real create/join, lobby, Help, and scoring surfaces. The dependency audit reports no known vulnerabilities.

The release baseline, beta-critical rules tranche, and private-session vertical slice are now implemented. The product is still not ready for a broad external beta; three release blockers dominate the remaining roadmap:

1. **External staging certification is incomplete.** The committed journey passes against isolated PostgreSQL and password-protected Redis and backup/restore is rehearsed, but the repository is not linked to Vercel, a Node container platform is not selected, and the journey has not run with real Clerk accounts or provider-native recovery.
2. **The setup and lifecycle product are incomplete.** Beta start uses deterministic captain/officer defaults; explicit setup choices, leave/forfeit, abandoned-session handling, match history, and completion recovery remain.
3. **The operating model is incomplete.** Staging, promotion, rollback, and backup procedures now exist, but structured telemetry, alerts, support tooling, privacy operations, sustained load testing, distributed multi-replica coordination, and a focused threat model remain.

The completed epics are **Release Baseline and Rules Contract — beta-critical tranche** and **Server-authoritative Private Session — functional slice**. The correct next epic is **Beta Certification and Operations**. More content and monetization should still wait until that path passes production-like E2E, security, and recovery gates.

## Scope and Method

This assessment covered:

- Product promise and first-run experience
- Canonical rules and implementation parity
- Core engine structure and automated tests
- Web UX, responsive behavior, accessibility contracts, and error handling
- Server, persistence, real-time architecture, authentication, and security
- Build reproducibility, containers, CI, deployment, telemetry, and supportability
- Maintainability, performance, documentation, and commercial readiness

It did not include a multi-person playtest, production traffic analysis, penetration test, real-Clerk remote staging run, or sustained load test because external staging services and test identities were not available in this workspace.

## Validation Evidence

| Check | Result | Interpretation |
| --- | --- | --- |
| `npx npm@10.8.2 ci --ignore-scripts` | Pass: 521 packages installed, 0 vulnerabilities | The pinned lockfile is reproducible with the repository npm version |
| `npm test` | Pass: 17 core files / 84 tests; 7 server files / 24 tests plus 1 intentionally gated PostgreSQL test; 1 web file / 2 tests | Every workspace has a real suite; auth, hosted Redis configuration, abuse controls, HTTP, socket, lifecycle, and turn contracts are covered |
| `npm run test:e2e` | Pass: Chromium, two isolated browser contexts | Host and guest create, join, ready, launch, commit a full authoritative turn, receive turn 2, and refresh-resume with no page/console errors |
| `npm run test:e2e:staging` | Pass against isolated PostgreSQL and password-protected Redis | The same browser journey persists durable state and survives two waves of 12 authenticated Socket.IO reconnects under shared abuse controls |
| Staging PostgreSQL backup/restore rehearsal | Pass | Logical restore preserved 1 session, 2 participants, 2 snapshots, and 2 submissions; repository integration passed after restore |
| PostgreSQL migration + integration | Pass | Generated migrations apply cleanly; create/join/start/turn state survives a fresh repository instance |
| `npm run build` | Pass with explicit public Clerk build key; keyless build intentionally fails | Strict TypeScript and Vite production builds are healthy and cannot emit an unusable unauthenticated artifact |
| `npm run lint` | Pass | Core, server, and web are all linted |
| `npm run test:coverage -w @gravity/core` | Pass: 59.89% statements, 47.02% branches, 73.45% functions, 59.65% lines | Coverage has enforceable non-regression thresholds |
| `docker compose config --quiet` | Pass | Compose syntax is valid and the obsolete version field is removed |
| `docker compose build --no-cache server web` | Pass | Both images install and compile from an isolated no-cache context |
| Production image boundary inspection | Pass | E2E identity harnesses and operations tooling are absent from both images |
| Live production desktop review | Loads, meaningful content, no overlay or console/page errors | Help, Roster, board, and ship dashboard render correctly |
| Live production mobile review at 390 x 844 | No horizontal overflow; lobby scrolls to all controls; dialogs remain contained | The browser check caught and closed a global vertical-clipping defect |
| Axe WCAG A/AA scan | 0 violations | Automated smoke check passes; two contrast/aria-hidden items remain manual-review incomplete |
| Keyboard dialog journey | Pass | Focus trap, Escape close, and focus restoration verified for Help and Roster |
| Production controls | Help works; developer Settings is absent | The dead-control defect is closed |

The authenticated Vite output is approximately 226 kB gzip of JavaScript across the runtime, main, and vendor bundles. That is acceptable for the present beta feature set, although the roughly 438 kB raw main chunk, 391 kB raw vendor chunk, and limited route-level splitting should be monitored as the product grows. Production source maps are disabled.

## Product Maturity Scorecard

Scale: `0` absent, `1` prototype, `2` functional alpha, `3` external-beta ready, `4` first-class.

| Area | Score | Assessment |
| --- | ---: | --- |
| Core engine capability | 2 | Broad mechanics, bots, scoring, deterministic helpers, and meaningful tests; concentrated in a very large module |
| Rules correctness and governance | 2 | Beta-critical setup, life support, infall, placement, First Officer copy, and standard-object drift are reconciled and contract-tested; full deck parity remains |
| Web game experience | 2 | Coherent game surface plus real create/join/lobby/resume; guided setup and onboarding remain |
| Accessibility | 2 | Shared semantic dialogs, focus management, named fields, mobile containment, reduced-motion handling, and an axe smoke pass are in place; broader manual review remains |
| Multiplayer/session product | 2 | Functional private create/join/ready/start/turn/resume with durable staging rehearsal and reconnect waves; real-Clerk remote staging, leave/forfeit, and history remain |
| Backend and persistence | 2 | Product APIs, generated migrations, durable membership/snapshots, optimistic concurrency, and restart-resume tests are implemented |
| Automated quality system | 3 | All workspaces have lint/build/test gates, core coverage thresholds, PostgreSQL integration, container builds, and a committed two-browser multiplayer journey in CI |
| Security and privacy | 3 | Pinned bundled Clerk bootstrap, issuer/signature/authorized-party checks, REST/socket authorization, CSP headers, hashed Redis rate limits, and stable abuse responses are implemented; threat modeling and external review remain |
| Release and operations | 2 | Clean installs, CI, containers, isolated staging compose, environment contract, migration order, rollback runbook, and backup/restore rehearsal exist; external deployment and monitoring remain |
| Observability and support | 0 | Console logging and a health endpoint only; no product analytics, tracing, alerts, or admin support surface |

## What Is Already Strong

- The monorepo split between platform-neutral core, server, and web is the right top-level shape.
- Strict TypeScript builds succeed across all packages.
- The core engine covers a large portion of the intended rules: turn phases, actions, upgrades, bots, collision, hazards, orbit, scoring, and game-end transitions.
- Seeded randomness and bot instrumentation provide a useful basis for reproducible simulations and balance analysis.
- The current test work has restored a green baseline and added targeted coverage for life support, infall, maneuvering, and victory scoring.
- The end-game overlay now uses the canonical scoring function, exposes category-level points, and documents tie-break order.
- The web interface has strong thematic direction, a useful phase briefing, informative system states, and a responsive two-column-to-stacked layout.
- The live page showed no runtime console errors at desktop or mobile sizes.
- Server configuration fails fast, and the current server already uses Helmet, restricted CORS, JSON size limits, graceful shutdown, PostgreSQL, Redis, and Winston.
- `docs/Gravity_Rules_Current.md` explicitly declares rules authority and change order. That is the right governance model even though enforcement is not yet working.
- The private-session implementation follows the architecture outline with PostgreSQL authority, authenticated socket rooms, full reconnect snapshots, and idempotent state-versioned commits.

## Implementation Progress After the Audit

| Gap | Current status | Evidence |
| --- | --- | --- |
| G-001 Rules contract | Beta-critical tranche closed; full catalog parity remains | Canonical rules corrected; setup/infall/life-support/placement/card copy aligned; `rules-parity-matrix.md` and conformance tests added |
| G-002 Reproducible release | Closed for beta baseline | npm 10 pinned, lock regenerated, nested build caches excluded, clean install and no-cache server/web images pass, CI added |
| G-003 Multiplayer | Functional slice complete | Create/join/ready/start/full-turn/resume, Socket.IO rejoin, PostgreSQL snapshots, state versions, idempotency, and durable local staging E2E are implemented; real-Clerk remote staging, leave/forfeit, and history remain |
| G-004 Authorization | Closed for beta boundary | Bundled pinned Clerk React SDK, JWKS plus `azp` verification, participant/host authorization, Vercel CSP, and shared Redis REST/socket rate limits are covered; focused threat model remains |
| G-005 Quality system | Local beta gate complete | Auth, abuse controls, lifecycle, HTTP, socket, PostgreSQL restart-resume, durable two-browser turn/resume, 24 reconnects, backup/restore, lint, coverage, CI, and Docker gates exist; remote identity and sustained-load certification remain |
| G-006 First-run UX | Partially closed | Real home/create/join/lobby/resume and Help exist; guided setup/tutorial and setup choices remain |
| G-007 Accessibility | Partially closed | Shared Radix dialog shell, named fields, mobile scrolling, focus trap/restore, Escape, reduced-motion handling, zero axe violations; contrast, touch-target, and screen-reader review remain |
| G-008 Operations | Rehearsal foundation complete | Liveness/readiness, hosted TLS Redis configuration, staging environment contract, guarded backup/restore tooling, promotion/rollback/recovery runbook, and CI rehearsal exist; telemetry, alerts, provider deployment, privacy, and support tools remain |
| G-010 Delivery policy | Partially closed | Production source maps are disabled and clean bundle sizes are recorded; explicit budgets, lazy overlays, profiling, and hardened static hosting remain |

The detailed gaps below describe the current residual work. Historical findings that have been closed are summarized in the progress table rather than repeated as active defects.

## Priority Gap Register

### P0 — Release Blockers

#### G-001: Rules parity is proven only for the beta-critical tranche

**Evidence**

- The authoritative rules, setup constants, life-support model, event infall, First Officer effects, standard objects, and scoring now agree and have deterministic contract tests.
- `docs/rules-parity-matrix.md` records the reviewed beta-critical contracts.
- The broader card, mission, upgrade, event, difficulty, and bot catalog has not yet received the same row-by-row implementation/copy/test audit.

**Impact**

The beta-critical path is trustworthy, but unreviewed content can still introduce rule drift as the playable catalog expands.

**Required work**

- Extend the parity matrix across every card, mission, upgrade, event, difficulty modifier, and bot behavior.
- Give every remaining row an approved value, config/engine reference, UI-copy reference, and deterministic test reference.
- Move duplicated role and card effect copy behind shared structured definitions; generate human-readable summaries from those definitions where practical.
- Add longer golden-state fixtures covering multiple turn cycles and representative content combinations.

**Exit criteria**

- No unresolved parity-matrix row remains in the beta content catalog.
- Every Tier-1 rule has one implementation and at least one conformance test.
- Standard New Game state exactly matches the approved setup.
- Engine previews, execution, roster/card copy, tooltips, and score output agree.

#### G-002: Reproducible artifacts are not yet promoted through a real release environment

**Evidence**

- The pinned npm 10 lockfile passes a clean install with zero known dependency vulnerabilities.
- Lint, unit/integration tests, coverage, durable E2E, backup/restore, and no-cache images are enforced in GitHub Actions.
- The production images exclude E2E identities and operations tooling.
- No Vercel project, container host, immutable beta tag, protected environment, or provider deployment is linked from this workspace.

**Impact**

The repository can create reproducible artifacts, but it has not yet proven promotion, rollback, or secret/configuration correctness on the actual beta providers.

**Required work**

- Link the Vercel project and selected Node container platform; provision protected staging and production environments.
- Tag images immutably with commit SHA and rules version, record deployment metadata, and retain the last known-good artifact.
- Enable required CI checks and branch/environment protection in the Git host.
- Execute the committed promotion and rollback runbook against staging before inviting players.

**Exit criteria**

- The exact CI-produced artifacts are deployed to staging and promoted without rebuilding.
- A recorded rollback restores the previous web and API versions without data loss.
- Provider configuration, secrets, domains, CSP, readiness, and migrations are verified by the remote smoke test.

#### G-003: The multiplayer vertical slice lacks a complete beta lifecycle

**Evidence**

- Two authenticated browser contexts can create, join, ready, start, commit a server-authoritative turn, refresh, and resume from PostgreSQL.
- The server enforces membership, host authority, turn ownership, state version, and idempotency; versioned serialization preserves `Map` and `Date` values.
- Durable membership is separated from socket presence, and the staging journey survives 24 authenticated reconnects.
- Leave/forfeit, abandoned-session expiry, completion recovery, match history, replay/turn log, and explicit setup choices remain absent.

**Impact**

Invited players can exercise the thin multiplayer path, but normal lifecycle interruptions still require operator intervention or leave unclear outcomes.

**Required work**

- Implement explicit leave and forfeit commands with deterministic host/turn consequences.
- Define abandoned-session expiry and recovery behavior, including background cleanup and participant messaging.
- Add setup choices, match completion persistence, history, and a player-readable turn/event log.
- Run the complete journey with real Clerk identities in remote staging.

**Exit criteria**

- Two real invited accounts can start, interrupt, resume, forfeit, and complete a match without database or operator intervention.
- Abandoned sessions expire predictably and completed matches remain inspectable.
- All lifecycle paths preserve deterministic authorization, idempotency, and durable state.

#### G-004: The implemented authorization boundary still needs external security and privacy certification

**Evidence**

- The bundled Clerk client is pinned, and the server verifies JWT signatures, issuer, expiry, and authorized party for REST and Socket.IO.
- Participant/host authorization, restrictive CSP, stable generic error responses, Redis-backed hashed identity/IP rate limits, and disabled production source maps are covered by tests.
- The implementation has not been exercised against the real staging Clerk instance, reviewed with a focused threat model, or paired with retention/deletion and incident-response policies.

**Impact**

The code boundary is suitable for a private beta, but configuration mistakes, privacy gaps, and unreviewed abuse paths could still undermine it in the real environment.

**Required work**

- Configure real staging Clerk domains, keys, authorized parties, redirect URLs, and CSP; run the committed two-browser journey with real accounts.
- Threat-model token theft/replay, enumeration, join-code abuse, reconnect storms, stale submissions, privilege transitions, and data exposure.
- Define data retention, account/session deletion, privacy notice, incident handling, and secret-rotation procedures.
- Add dependency and container scanning to the hosted release gate.

**Exit criteria**

- The real staging configuration passes authorization and abuse tests with no test-identity bypass present in production artifacts.
- The threat model has owners and closed beta-blocking findings.
- Privacy, deletion, retention, and incident procedures match the deployed data model.

### P1 — Required Before an External Beta

#### G-005: Local certification is broad, but remote, sustained-load, and lifecycle coverage remain

- All workspaces have real lint/build/test gates; core has enforceable coverage thresholds.
- Auth, abuse controls, lifecycle, HTTP, Socket.IO, PostgreSQL restart-resume, durable two-browser play, reconnect waves, migration, backup/restore, accessibility smoke, and clean images are automated.
- Real-Clerk remote E2E, sustained concurrent-session load, provider failure injection, leave/forfeit/completion, and broader component/screen-reader coverage remain.

Required outcome:

- Execute the same journey remotely with real identity and managed dependencies.
- Add lifecycle E2E for leave, forfeit, expiry, completion, and history.
- Establish a sustained-load model for concurrent sessions, turn commits, reconnect storms, and recovery objectives.
- Expand web component, axe, keyboard, and manual screen-reader/contrast/touch-target coverage.

#### G-006: First-run UX reaches a real lobby but does not teach or configure the game

- The product now opens on a real home/create/join surface and includes waiting, reconnect, failure, Help, roster, and scoring states.
- Production no longer exposes the developer Settings control.
- Setup uses deterministic captain/officer defaults; there is no guided first match, explicit setup choice, progressive rules teaching, or safe pre-match cancellation/exit path.

Required outcome:

- Provide a short guided first game and contextual explanations for why actions are available, blocked, or recommended.
- Add captain/officer and supported game-option selection with shared validation.
- Expand Help into a searchable approved-rules surface and add contextual links from blocked actions.
- Add safe cancellation, leave, and progress-loss confirmations.

#### G-007: Accessibility automation passes, but WCAG certification is incomplete

Positive signals include semantic landmarks, accessible names, shared dialog semantics, focus trapping/restoration, Escape handling, reduced-motion behavior, no horizontal overflow at 390 px, and a zero-violation automated axe smoke.

Remaining gaps:

- Dense labels and board controls still need manual contrast and touch-target verification.
- A screen-reader journey has not been completed.
- Automated coverage is a smoke path, not a representative scan of every setup, error, action, and end-state surface.

Required outcome:

- Meet WCAG 2.2 AA for keyboard access, focus management, contrast, non-color cues, touch targets, and reduced motion.
- Expand axe/keyboard coverage and complete manual screen-reader, zoom/reflow, contrast, and touch-target reviews at desktop and mobile breakpoints.

#### G-008: Recovery is rehearsed, but operational visibility and support tooling are absent

- Liveness/readiness, container health, a staging environment contract, remote smoke checks, migration order, guarded backup/restore, and promotion/rollback/recovery procedures now exist.
- Winston still lacks consistent request/session correlation, and there is no client error reporting, tracing, metrics backend, product analytics, alerting, or admin session inspector.
- Provider-native restore, incident response, privacy operations, and recovery-time/recovery-point objectives have not been exercised.

Required outcome:

- Add structured logs, correlation IDs, error reporting, request/turn latency, rejection reasons, reconnect rate, match completion, and funnel events.
- Define alert thresholds and service-level/recovery objectives; exercise provider-native restore and rollback.
- Add incident, secret-rotation, privacy-request, and support-escalation runbooks.
- Add a read-only admin/support view for stuck sessions and turn/event history before public scale.

### P2 — Required for First-Class Quality

#### G-009: Core and UI maintainability will slow every future change

- `packages/core/src/engine/index.ts` is about 10,077 lines and contains roughly 132 functions.
- `ShipDashboard.tsx` is about 7,955 lines; `GameBoard.tsx` is about 1,753; `gameStore.ts` is about 1,167.
- Rules, validation, execution, presentation previews, and user-facing summaries are duplicated across these large files.

Required outcome:

- Split engine domains by action/rule area behind stable pure-function contracts.
- Split dashboard panels and action editors into independently tested components.
- Centralize role/effect definitions and derive both preview and execution from the same calculation functions.
- Enforce module boundaries and complexity budgets in lint/CI.

#### G-010: Performance and delivery policy need explicit budgets

- The current JavaScript payload is acceptable, but the main chunk will grow rapidly if the existing monoliths continue.
- Production source maps are disabled and the static web/API split is documented.
- Fonts and auth code add third-party runtime dependencies.
- The remote CDN/web deployment and single-replica container API have not yet been provisioned or profiled under beta traffic.

Required outcome:

- Set bundle, interaction-latency, board-render, and turn-resolution budgets.
- Lazy-load secondary overlays and development tooling.
- Profile large object counts and long matches.
- Serve immutable static assets through the production CDN/web platform and deploy the API separately with proper health and secrets policy.
- Keep the API at one replica until Socket.IO fan-out and the turn critical section use distributed coordination; then certify multi-replica behavior before scaling.

#### G-011: Documentation and product packaging are inconsistent

- README says `npm run dev` starts core, server, and web; the root script starts only web. `dev:all` is the actual all-workspace command.
- README requires Node `>=20.0.0`; `package.json` requires `>=20.19.0`.
- `docs/commercial-polish-work-statement.md` still reports a broken default test suite and no canonical rules source. Those statements are now partly stale.
- Monetization/unlock documentation still contains placeholder checkout values.

Required outcome:

- Update onboarding, architecture, environment, testing, and release documentation to match executable commands.
- Mark older assessments as superseded rather than leaving contradictory status reports active.
- Add an architecture decision record for product mode, auth, state serialization, persistence, and deployment topology.
- Complete privacy, terms, support, data retention/deletion, and commercial packaging before paid launch.

## Recommended Execution Sequence

### Milestone A: Release Baseline and Rules Contract

Status: **Beta-critical tranche implemented; broad catalog parity remains.**

1. Partial — beta-critical contradictions are resolved and a parity matrix exists; every card/mission/upgrade still needs review.
2. Complete — setup, life support, infall, First Officer copy, ship placement, and standard mock objects align.
3. Complete — the pinned npm 10 lock passes clean install and both no-cache Docker builds.
4. Complete — CI gates install, lint, build, tests, coverage, images, disposable PostgreSQL/Redis migrations, durable E2E, and restore rehearsal.
5. Complete for baseline — coverage thresholds and canonical setup/infall/wire tests are active; full-turn golden fixtures remain desirable.
6. Complete — Help is implemented and developer Settings is hidden from production.

**Milestone exit:** A clean checkout produces a tested artifact that demonstrably plays the approved rules.

### Milestone B: Server-Authoritative Session Vertical Slice

Status: **Functional slice implemented and certified on the durable local stack.**

1. Complete — invite-only asynchronous multiplayer is the beta promise.
2. Complete — verified identity, session/participant schema, and versioned state serialization exist.
3. Complete — private create/join/ready/start is implemented.
4. Complete — a full turn is server-authoritative with idempotency and optimistic concurrency.
5. Complete — snapshots/submissions survive refresh, reconnect, and server restart.
6. Complete for the beta slice — turn processing and bot decisions run under server authority.

**Milestone exit:** Two browsers can complete and resume a private match without trusted client mutation.

### Milestone C: External Beta Hardening

1. Provision/link the Vercel web project, one-replica Node API, managed PostgreSQL/Redis, Clerk staging instance, domains, and secrets.
2. Run the committed remote smoke and two-real-account journey, then rehearse provider-native restore and artifact rollback.
3. Add structured telemetry, client error reporting, dashboards, alerts, and a read-only session support view.
4. Implement setup choices, leave/forfeit, abandonment expiry, completion recovery, and match history/turn log.
5. Ship guided first-game onboarding and complete manual WCAG review.
6. Run focused threat modeling, sustained load, failure injection, and multi-user playtest exercises.

**Milestone exit:** Invited players can learn, complete, resume, and understand matches while the team can detect and repair failures.

### Milestone D: First-Class and Commercial Polish

1. Refactor the engine/dashboard hotspots behind stable contracts.
2. Add match history, replay/turn log, shareable results, and support/admin tools.
3. Add balance simulation reports and playtest funnel analysis.
4. Finalize entitlement, packaging, privacy, terms, support policy, and storefront assets.
5. Establish go/no-go release gates and a post-launch incident/live-ops cadence.

## First-Class Definition of Done

Gravity should not be called first-class until all of the following are true:

- One internally consistent, versioned rules source governs config, engine, tests, and UI copy.
- A clean checkout and CI produce identical passing builds and deployable artifacts.
- A new player can understand how to start and finish a match without developer coaching.
- Real sessions can be created, joined, persisted, resumed, and completed by distinct users.
- The server verifies identity, membership, state version, turn ownership, and every mutation.
- Duplicate and stale submissions are safe; committed turns survive refresh and server restart.
- Core rule contracts, API integration, web components, and critical E2E journeys are automated.
- Keyboard, screen-reader, mobile, reduced-motion, and contrast requirements meet WCAG 2.2 AA.
- Production has staging, migrations, backups, rollback, telemetry, alerts, and support inspection.
- Security, privacy, data retention, and commercial policies match the actual deployed experience.
- Balance and funnel decisions are based on instrumented matches rather than developer scenarios alone.

## Immediate Backlog: Next 10 Work Items

1. Link the Vercel staging project and configure the web domain, environment values, CSP, and immutable preview promotion.
2. Select/provision a one-replica Node container target for the API and configure its domain, health checks, and secret policy.
3. Provision managed PostgreSQL, managed TLS Redis, and a Clerk staging instance; apply migrations and validate authorized parties/redirects.
4. Run `npm run staging:smoke` and the two-real-account multiplayer journey against external staging.
5. Rehearse provider-native database recovery and code rollback; record actual recovery time and data-loss window.
6. Add correlated structured logs, client/server error capture, beta dashboards, and alerts for readiness, error rate, turn latency, and reconnect rate.
7. Implement leave/forfeit and abandoned-session expiry with full API, socket, persistence, and E2E coverage.
8. Implement setup choices plus match completion/history and a player-readable turn log.
9. Complete the focused threat model, privacy/retention/deletion procedures, and manual WCAG 2.2 AA review.
10. Run sustained load/failure tests and a multi-person invite playtest; resolve every beta-blocking finding.

## Final Recommendation

Treat Gravity as an **external-beta certification project**, not a content or monetization project, for the next phase.

The repository now has a trustworthy beta-critical rules baseline, reproducible artifacts, and a durable server-authoritative player journey. The fastest route forward is to deploy that exact path to real staging, prove identity/recovery/rollback and operational visibility, then close lifecycle, onboarding, accessibility, security, and playtest findings before expanding content or commercial scope.
