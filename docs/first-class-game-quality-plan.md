# Gravity game quality plan and evidence

Assessment and implementation started: 2026-10-10 (America/New_York).
Owner: Gravity engineering. This is the living execution record for visual,
interaction, performance, and multiplayer quality. Historical evidence in the
August gap analysis is not current certification.

## Outcome and acceptance standard

Gravity should make its tactical choices understandable, its space setting
beautiful, and every interaction responsive. A player must always see the same
committed mission as the authoritative server. Local visual effects and draft
plans must never become a second game simulation.

Required journey: signed-in home → create/join → configured human/bot roster →
ready/launch → plan/commit → consistent turn on both clients → reconnect/resume.
Verify the browser, REST/Socket.IO contracts, persisted snapshot, and rendered
response. No claim of zero regressions or zero debt is made without evidence.

## Prioritized gap register

| ID | Priority | Evidence / gap | Required outcome | Status |
| --- | --- | --- | --- | --- |
| Q-01 | P0 | Header exposes New Game, local AI and difficulty; Roster and ship crew edits mutate browser state in network games | Network missions expose only authorized actions; durable state changes only through server commits | Implemented and locally verified; deployment gate pending |
| Q-02 | P0 | App deduplicates snapshots by version alone; controller accepts unguarded REST/session updates | Scope snapshot identity to session; ignore obsolete responses and preserve newer committed state | Implemented and locally verified; deployment gate pending |
| Q-03 | P1 | App, board, dashboard, header and overlays subscribe to the complete Zustand store | Subscribe only to consumed data; cosmetic view changes do not rebuild unrelated panels | Implemented; render-isolation regression passes |
| Q-04 | P1 | Google Fonts stylesheet and font downloads timed out in previous browser tests | Bundle licensed fonts; app presentation and test startup have no runtime font CDN dependency | Implemented; local loading and no-CDN browser assertions pass |
| Q-05 | P1 | Existing browser tests assert mechanics but not screenshots, layout, motion or latency | Reviewed visual evidence at desktop/tablet/mobile; executable layout, motion, interaction and performance budgets | 34 baselines reviewed; local gates pass; CI gate pending |
| Q-06 | P1 | Browser suite waits for external resources and uses development serving | Deterministic production-like browser checks; traces, screenshots and performance evidence retained in CI | Production React loopback harness passes; built-bundle/device certification remains Q-12 |
| Q-07 | P1 | Network snapshots jump directly between turns; tactical causality is hard to read | Server result presentation with concise turn summary, changed-system highlights and interruptible motion | Planned, tranche 2 |
| Q-08 | P1 | Full durable-stack race/load certification and multi-instance fan-out remain incomplete | Prove duplicate/stale/concurrent mutations, reconnect under load and restart recovery; keep single API replica until distributed coordination is certified | 13 local PostgreSQL regressions pass; full-stack CI and tranche 2 endurance remain |
| Q-09 | P2 | Dense ship layout, small controls and outdated help obscure multiplayer rules | Responsive command hierarchy, accurate help, keyboard/touch access and reduced motion | In progress for touched surfaces; fuller usability review in tranche 3 |
| Q-10 | P2 | Gameplay E2E only exercises Restore and the first resolved turn | Multi-turn action/configuration, resource/crew changes, hazards, elimination and game-end scoring journeys | Planned, tranche 2 |
| Q-11 | P2 | No explicit visual asset/style acceptance system | Board/ship/object/crew hierarchy, contrast, readable icons, restrained effects and shared tokens with reviewed baselines | Foundation tranche 1; art direction tranche 3 |
| Q-12 | P1 | Current operational performance and real-identity live journey are uncertified | Current deployment commit, live health/CORS/auth, real Clerk journey and supported-device evidence | Pending final delivery gate |
| Q-13 | P2 | Lifecycle/setup and support operations remain incomplete in earlier product assessment | Authoritative setup, leave/forfeit/history, support diagnostics and retention policy | Planned, tranche 4 |
| Q-14 | P0 | Executable probe: an invalid first plan is persisted as pending; the final submission fails and the corrected first plan is rejected as duplicate | Validate each plan before locking it; invalid input cannot poison the turn | Implemented; core/service/HTTP/durable regressions pass |
| Q-15 | P0 | Executable probe: replacing a human with a bot revokes REST access but its joined socket still receives later snapshots | Revoke removed members from live rooms before further broadcasts | Implemented; removed identity cannot receive later snapshots in socket regressions |
| Q-16 | P2 | Dependency audit found vulnerable runtime patches and an unpatched development-only Tailwind 3 dependency chain | Runtime audit clean; plan a separately reviewed Tailwind 4 migration with complete screenshot comparison | Runtime patches applied; development tooling migration remains open |
| Q-17 | P0 | Individually legal shared-target Attack/Scan/Acquire/Launch plans can fail together after some players are locked | Deterministic consumed-target semantics; no permanently poisoned pending turn | Verified reproduced cases corrected, including Retaliate; broader action combinations remain Q-10 |
| Q-18 | P1 investigation | Static review found that Distress Call reward removal may leave another player's stored discovery claiming the same reserved upgrade; not yet reproduced | Reproduce unique-reward ownership across Scan/Probe → later Scan/Acquire; define and test one authoritative award before changing rules | Required investigation, tranche 2 |
| Q-19 | P2 | Ship dashboard still has separate Radix clear-plan and upgrade dialogs/drawers; this tranche measures the shared Help shell, not every panel | Inventory remaining dialog flows; certify focus, scroll, touch and latency before extending the native shell | Open, tranche 3; do not claim all dialogs are performance-certified |
| Q-20 | P0 beta sign-off | Code review proves genuinely invalid plans persisted by the OLD server remain locked: duplicate handling cannot replace them and the final transaction rolls back | Read-only inventory of current-version uncommitted plans using canonical validation; if affected rows exist, accept and execute an audited targeted repair preserving committed state | Live-data inventory blocked on Railway access; repair not implemented or claimed |

## Accepted architecture: responsive presentation without competing authority

Status: Accepted for tranche 1 on 2026-10-10 under the user's authorization to
improve the product. This document governs implementation before runtime edits.
The team reviews material departures here before changing code.

### Problem and non-goals

Network missions currently reuse local-development mutation controls and accept
asynchronous results without a uniform identity/version fence. Heavy store
subscriptions increase unrelated work. Fonts and the absence of visual budgets
make UI certification unreliable.

This tranche does not redesign game rules, persisted schema, bot intelligence,
Clerk tenants, live account data, or enable horizontal API scaling. It does not
implement speculative game progression, a second browser authority, or a new
rendering engine.

The verified shared-object contention corrections below are explicit narrow
rule clarifications. They do not certify every legal plan combination. In
particular mixed human/bot endurance and unique stored-discovery rewards remain
required investigations; future PvP damage would need its own authority and
actor-invalidation architecture (PvP damage is not currently implemented).

Audit extension accepted before implementation: Q-14 and Q-15 are included in
tranche 1 because they affect the currently shipped ready/turn flow. Validate a
player's proposed plan with the canonical core validator before persisting its
lock, using the current committed snapshot inside the existing session lock /
transaction. A rejection commits nothing; a corrected plan remains possible.
On membership changes, evict sockets for removed identities from the session
room before publishing any subsequent summary or snapshot. REST and sockets
must enforce the same durable membership; being connected is not authorization.
Readiness updates and launch use the same session-row lock and recheck lobby
status/roster identities inside the transaction. Resume reads use a consistent
read transaction so summary, participants, pending plans and snapshot describe
one committed instant. These changes use existing schema and wire fields.

The core currently combines validation and resolution in `applyPlayerActions`.
Preflight therefore runs the complete proposed player plan on a detached,
deserialized snapshot, with explicit empty plans for other players, then
discards the result. It runs inside the repository's stale/duplicate guard
before insertion. Preserve canonical action ordering (earlier actions can
enable later ones); do not add a divergent second set of game rules. Measure
the extra resolution cost and test shared-target contention separately.

Contention extension accepted 2026-10-10 before implementation: two legal
simultaneous attacks can destroy the same hostile before the later attack is
processed. Within the canonical attack stage, retain the original attackable
target identity. If that hostile has become debris from an earlier attack in
the same stage, the later assigned attack has no additional effect and grants
no duplicated damage/reward. A target that was already non-hostile or missing
at stage entry remains invalid. This narrow resolution correction must not
swallow other rule failures or discard pending plans. Add deterministic core,
server three-human pending-plan, and durable regression tests. No new wire
contract, persistence migration, or browser simulation is introduced.

The same contention policy is accepted for verified shared Scan and cross-stage
Acquire/Launch cases: retain turn-entry object identity/position and record only
objects actually removed by earlier successful canonical resolution. Validate
the later actor, crew location, range, power and required resource normally,
using that known original target only for the consumed-target check. Preserve
existing action-specific validation: Launch has no canonical range restriction,
so this correction does not invent one. A valid
later Scan/Probe/Torpedo against that consumed target spends its assigned action
and normal power/ammunition but produces no second target effect or reward.
Originally missing targets still fail; unrelated validation exceptions still
fail. Do not add catch-and-continue resolution or guess a replacement target.
Help must explain this simultaneous-target rule. Tests must cover both action
orders, resource spending, invalid actor/range/resource preservation, original
missing-target rejection, pending-plan recovery, and deterministic snapshots.
Richer per-action outcome presentation is tracked in Q-07, not silently claimed
as delivered by this rules correction.

Final audit extension accepted before implementation: the wire-supported
Retaliate resolver delegates to a later attack stage. Carry the explicit
destroyed-hostile cause through the same ephemeral turn context so a hostile
destroyed by an earlier Attack can also consume a valid later Retaliate without
poisoning the turn. Originally non-hostile targets remain invalid; normal
Retaliate prerequisites and resource costs remain unchanged. Cover this
wire-supported action even though the current UI does not offer it.
The destroyed/consumed-hostile check also covers an originally hostile target
actually removed by canonical Scan/Acquire earlier in this turn (the existing
rules allow Acquire from a stored discovery). This does not broaden which
objects can be attacked or acquired: it closes the same proven-consumption
case across stages while preserving every normal actor, power and range check.
Track hostile destruction by Torpedo as well as Attack: Launch precedes
Retaliate in canonical order. All of these exceptions require an explicit
successful earlier resolution cause against the original hostile, never an
exception-message match or a merely absent object.

Ordering extension accepted before implementation: lobby snapshots currently
share `stateVersion = 0` and can share the same clock millisecond. Preserve the
wire contract by making the repository-owned session `updatedAt` strictly
increase for every successful session mutation under its existing parent-row
lock (`max(request time, previous time + 1 ms)`). In-memory fixtures use the
same rule. The client can then order summaries using version and this server
revision timestamp; it never manufactures the timestamp. Add equal-clock,
out-of-order readiness/roster/cancellation tests. A dedicated numeric lobby
revision can be a future schema cleanup, not a prerequisite for correctness.

### Terminology, authority and state lifetimes

- Committed state: the server-authored `GameStateSnapshotV1`, identified by
  `(sessionId, stateVersion)`; PostgreSQL owns it across restarts.
- Session summary: server membership/status/readiness/pending plans. An older
  response cannot replace a newer snapshot or revive a terminal session.
- Draft: actions on the current device for the current participant and committed
  turn. Clear on a newer authoritative snapshot or session replacement.
- Presentation: board zoom/pan, selection, dialogs and animation; browser-local,
  disposable, and incapable of changing committed ship/crew/turn state.
- Network authority: explicit active session binding, independent of whether an
  asynchronous submission callback is temporarily available. Only the snapshot
  hydration path may replace game state while bound.
- Local fixture: development/test state without a network session; never an
  alternate mission surfaced to a signed-in multiplayer player.

### Versioned contracts and data flow

No database or REST contract migration is required. Preserve
`GameStateSnapshotV1`, existing session routes, submission IDs and version
preconditions. New client merge utilities operate on existing wire types.
Invalid plans continue to use the existing `INVALID_ACTION` contract and its
player-safe recovery. Room revocation is immediate for connected removed
members; their current cancellation/replacement recovery remains compatible.

1. Authenticate and create/join/resume through existing REST APIs.
2. Bind the browser to that session and participant.
3. Accept server updates only for the current session; guard obsolete async
   work and compare snapshot versions before hydration.
4. Hydrate committed state atomically with participant identity and draft reset.
5. UI selectors consume stable references for only the data each panel uses.
6. Plan actions locally and submit through the current bound server callback.
7. Server commits and broadcasts; the same acceptance rule applies to REST,
   room updates, snapshots and reconnect.

### Validation, recovery and player-visible failures

Modal performance extension accepted before implementation: replace the shared
Radix modal shell with the platform's native modal `dialog`, using `showModal`
and its top-layer inertness/focus boundary. Repeated profiling found global
body pointer-event writes and forced style/focus flushes in the existing shell.
Preserve labelled title/description, keyboard containment, Escape, outside-click
dismissal, scroll containment, and return focus to the actual opener on every
opening. Never replace a true modal with an untrapped visual overlay. Native
modal behavior requires real-browser keyboard/background tests as well as
component lifecycle tests; review all five-width screenshots again.

Containment refinement accepted before implementation: apply layout, paint and
style containment only to the already parent-sized, overflow-clipped tactical
board viewport. Its absolute inspection/control overlays remain within that
same boundary; shared modals remain portalled into the native top layer. Do not
apply size containment, hide the scene, remove object/ring artwork, or force
large compositor layers. This is a scoped rendering optimization, not a new
authority or state lifetime. Verify unchanged five-width screenshots, bounded
inspection and zoom/pan behavior, native modal keyboard/scroll isolation, and
repeated responsiveness measurements without changing acceptance thresholds.
If the measured benefit or visual safety fails, remove this isolated containment
rule rather than broadening it to content whose size depends on descendants.

Reduced-motion refinement accepted before implementation: disable CSS animation
and transitions with `animation: none` and `transition: none` when the player
requests reduced motion. The former 0.01 ms durations still created animation
lifecycles during hover/focus changes; paired native-modal diagnostics measured
less processing with genuinely disabled motion. No application behavior depends
on animation-end or transition-end events. Keep normal-motion styling and the
board's explicit SVG SMIL pause unchanged, and retain all artwork. Browser
computed-style assertions must cover animated/transitioning controls and their
pseudo-elements; repeat the unchanged visual, keyboard and performance gates.
Diagnostic measurements alone are not release certification.

Do not expose local New Game, opponent AI, difficulty, roster application or
scenario import in a network mission. Roster inspection remains available and
must clearly describe the actual server-confirmed crew. Crew movement controls
must not mutate network state without an authorized server command.

Ignore stale messages as protocol duplication, without a player error. Preserve
the latest committed state on failures. Existing player-safe session recovery,
consecutive-failure boundary and support escalation remain required. Any changed
failure path receives its mandated copy/boundary tests. Developer diagnostics
stay in logs. A blocked browser identity is recorded as unverified live play,
never a passing authentication journey.

Recovery clarification accepted before implementation: a lost mutation response
does not prove a rejected write. Explain the unconfirmed outcome truthfully;
turn retries reuse the original submission identity/actions on the same screen.
Lobby recovery may expose a read-only Refresh lobby control using existing GET,
so the player can inspect current authoritative state before another mutation
without reloading away drafts or the consecutive-failure tracker. Non-idempotent
Create with an unknown outcome must stop blind retry and offer support. Confirmed
validation rejection still permits correcting the plan and a new submission.

Recovery clarification accepted before final error-copy implementation: a lost
reply, unavailable response, or unusable successful response does not prove a
mutation was rejected. Say explicitly that Gravity cannot confirm its outcome;
only an explicit rejection or pre-send identity failure may claim nothing was
applied. Keep uncertain turn retries on the same screen with the original
submission ID and original actions. Do not instruct a reload followed by locking
a draft that reload discarded. A failed snapshot restore may offer reload only
when it explains that local planning will need to be recreated. Read the latest
authoritative lobby roster/status before retrying an uncertain lobby mutation;
never blindly repeat non-idempotent game creation. Unexpected local exceptions
use the same normalized workflow/stage tracker and support boundary as API
failures, without exposing diagnostics or counting a typed API failure twice.

The current Create uncertainty guard lasts for this page/controller lifetime,
including returning to mission home. It is not durable creation reconciliation:
reload or another device can bypass it because the existing create contract has
neither a creation idempotency key nor owned-mission lookup. The message therefore
explicitly says to keep the screen open and contact support, never reload/create
again. Durable idempotent creation and recoverable owned-mission discovery remain
an explicit Q-13 beta lifecycle gap. Validate consumed session/turn envelope fields
and canonical snapshot boundaries before treating a response as success; valid
JSON alone must never reset a repeated unusable-result failure.

### Migration, compatibility, rollout and rollback

There is no schema migration or new required API capability in this tranche.
Existing server and client contracts remain compatible. Bundle fonts through
pinned packages with their license notices; remove external font requests.
Keep E2E identities loopback-only and disallowed in deployable builds.

Run required checks, commit and push current main, then inspect GitHub/Vercel and
Railway commit/deployment evidence and live smoke. Roll back with a reviewed
revert commit if the visual or authority gates fail; never reset durable data.
Frontend rollback cannot justify keeping known competing-authority controls.

Legacy-data qualification: preflight protects new locks; it does not repair
genuinely invalid plans already persisted by the previous server. Duplicate
submission handling and the client pending guard preserve those locks. Final
resolution rolls back its transaction, keeping the completed snapshot safe but
leaving the lobby/turn unable to progress. Before beta sign-off, inventory only
current-version, uncommitted submissions under a consistent read and run the
canonical validator without writes. No affected live row has been observed yet;
absence has also not been established because Railway operator access is pending.
If any exist, accept a separate repair design before mutation: lock the session,
audit/preserve the original rejected plan, clear only proven-invalid uncommitted
locks, advance the summary revision, notify affected members, and never change
the committed snapshot or version. There is no automatic data deletion or
invented successful recovery in this tranche. Previously valid shared-target
plans use the corrected resolver transparently when the remaining player submits.

### Observability and performance budgets

Keep test console/page errors and failed first-party requests at zero. Attach
screenshots and JSON measurements to browser reports. Measure on a documented
viewport/browser with four-times CPU slowdown for interaction checks. Initial
budgets are engineering guardrails, not claims about all devices:

| Signal | Acceptance gate |
| --- | --- |
| Font loading | No Google Fonts/CDN requests; local font files load successfully |
| Layout | No document horizontal overflow at 390×844, 768×1024, 1440×900; main controls reachable |
| Interaction | p95 browser input-to-next-paint ≤ 200 ms in repeated board/dialog interactions under 4× CPU slowdown |
| Main thread | No interaction task ≥ 200 ms; report all tasks ≥ 50 ms |
| Rendering isolation | Board view-only updates do not rerender unrelated ship/header panels |
| Motion | Reduced-motion preference stops decorative perpetual motion; no continuous animation writes to authoritative game state |
| Bundle | Record raw/gzip artifacts before/after; require an explained size increase |
| Visual regression | Deterministic screenshots with animation disabled; reviewed baselines and perceptual/layout assertions, no blanket error masking |
| Multiplayer | One committed version on both clients after resolution/reconnect; older messages cannot revert it |

Frame rate and server throughput need a separate sustained-load/device matrix;
do not infer them from successful navigation or a single local timing sample.

Measurement clarification accepted before the final harness correction: browser
profiling also found automation's injected role/ARIA traversal contributing work
before the next paint. The responsiveness journey must let each trusted input
reach its presented frame before the driver's semantic assertions or the next
input. Await two animation frames after each click/Escape, without clearing or
filtering observed EventTiming/long-task samples, excluding the cold opening,
or subtracting slow durations. Keep absolute event/processing timestamps for
diagnosis. Rapid open/reversal remains a separate keyboard/visual regression;
do not rewrite its historical latency samples as passing measurements.

Final input-driver clarification accepted before implementation: per-input role
locator actionability also runs injected selector/style work immediately before
dispatch. Resolve the stable board/header control centers before observing,
then dispatch trusted pointer inputs directly, with no hover warm-up. After
paint, read native `dialog.open` and actual focus cheaply rather than traversing
the accessibility tree inside the timed loop. Record and assert every trusted
click target and Escape count so missed coordinates cannot produce a false pass.
Retain the cold opening, all timing/long-task entries, and the same budgets.
This isolates application input response, not the test driver's action latency;
semantic accessibility and rapid keyboard reversal remain separate visual gates.

### Worked examples

- Session A at version 5 is replaced by session B at version 1: render B and clear
  A's draft; version 1 is newer within B's lifetime.
- A socket delivers version 4 after REST has returned version 5: retain version
  5 and do not clear a current draft because of the duplicate.
- The host opens Roster: inspect the actual captain/officers; no Apply control
  changes local abilities or silently revives crew.
- Zooming/panning the board: update presentation only; the ship dashboard and
  command header do not rebuild from unrelated store notifications.
- An invalid plan arrives before another player's valid plan: reject the first
  without storing its submission. After correction both plans commit one turn.
- A human seat becomes a bot: remove the old identity's room authorization
  before launch; its old connection cannot receive the launched game's state.

### Required tests and acceptance gates

- Unit/component tests for session-scoped monotonic acceptance, obsolete response
  handling, authoritative hydration and local-mutation guards.
- Service, HTTP, socket and durable-repository tests for invalid-first-plan
  rejection/correction, no partial lock, duplicate/stale/unauthorized requests,
  and revoked socket membership followed by launch and turn broadcasts.
- Concurrent readiness/launch and consistent-read tests against PostgreSQL,
  including same-timestamp roster replacement; no schema migration is needed.
- Browser tests for read-only network controls, bot-filled and two-human mission,
  reconnect/resume and host cancellation, preserving existing coverage.
- Visual checks for home/lobby/active mission/Help/Roster at supported widths,
  keyboard focus and reduced motion, plus repeatable performance measurement.
- Lint, all workspace tests, strict builds, durable PostgreSQL/Redis rehearsal
  and existing CI release checks. Explain unavailable external prerequisites.
- Human/agent inspection of captured screenshots; never generate and approve
  screenshot baselines without viewing them.

## Delivery tranches

1. **Authority and responsive presentation foundation — locally verified; delivery gates pending.** Close
   Q-01–Q-06 and Q-14–Q-15, correct touched help/roster surfaces, and establish
   measured gates.
2. **Tactical turn feedback and endurance — proposed next.** Present actual
   server outcomes, cover varied multi-turn actions/end states, and certify
   stale/concurrent/reconnect behavior with durable persistence and sustained
   session load before any replication change. Start with the Q-20 legacy-lock
   inventory/conditional repair and Q-18 stored-reward ownership investigation,
   followed by an accepted outcome/ownership architecture;
   preserve canonical resolution rather than inventing browser outcomes.
3. **Visual craft and usability — planned.** Refine board/object/ship hierarchy,
   contrast, touch and keyboard flows; review low-end GPU/mobile and screen
   reader use with real player tasks. Complete the remaining ship-dialog
   inventory (Q-19) and separately review/test the Tailwind 4 migration needed
   to retire Q-16's vulnerable development-tool chain.
4. **Complete beta product and operations — planned.** Authoritative setup and
   lifecycle, match history/support, telemetry/alerts, recovery and release
   rehearsal with real identities.

Each tranche must finish with evidence, remaining gaps, and the next logical
tranche. Open product work is tracked here; do not disguise it as complete.

## Execution log

2026-10-10: Read repository coding contract and standards, fetched origin/main,
confirmed clean baseline at `cbff45b`. Started independent rendering, authority,
and test-quality audits. Baseline unit/build checks running. Docker daemon was
not available at audit start; durable rehearsal remains pending infrastructure.
Executable audit reproduced poisoned pending plans and post-revocation socket
delivery. Expanded accepted tranche 1 before runtime implementation.

Audit results and implementation evidence (current, not final release sign-off):

- Baseline: 84 core, 31 server and 7 web tests passed; one PostgreSQL test was
  skipped. Main JavaScript gzip total 229.88 KB; CSS gzip 10.16 KB.
- Found and fixed a self-sustaining ship-grid measurement/ref callback loop.
  A component Profiler regression proves board-only updates do not commit the
  header or ship dashboard, and the settled grid remains idle for 500 ms.
- Network state now has an explicit session binding, session-scoped version
  acceptance, atomic hydration, stale request fences and refreshed socket
  identity/room acknowledgement. Corrected rejected plans discard their cached
  retry payload; uncertain requests retain their idempotency identity.
- Ready/launch share a durable lock, resume uses consistent reads, and session
  update timestamps advance monotonically even when the clock does not.
- Isolated official PostgreSQL 16.15 binaries were used on loopback because Docker
  Desktop crashes during startup. Migrations and six PostgreSQL integration
  tests passed initially; the final suite has 13 PostgreSQL integration cases,
  including concurrent/duplicate commits, readiness races,
  shared attacks, same-clock revisions and consistent reads. The full
  PostgreSQL/Redis/container/backup rehearsal remains a separate CI gate.
- Font packages are pinned and their licenses ship with the app. Compatible
  security patches plus Vitest 4.1.11 bring `npm audit --omit=dev` to zero
  vulnerabilities. Full audit still reports seven development-only findings
  in Tailwind 3's dependency chain; no patched `braces` release exists in that
  chain. Do not hide these with a forced major upgrade or mark Q-16 complete.
- Reviewed initial five-width screenshots revealed a mobile planning rail
  occupying 432 px. A compact disclosure now preserves board/ship space and
  keeps expanded planning controls reachable in a bounded scrolling panel.
- Initial 4× slowdown tests exposed modal input latency of 600–640 ms and
  431–521 ms tasks. Profiling identified global modal style/layout work, not
  expensive game simulation. Removed full-scene backdrop filtering and global
  scroll geometry writes; subsequent clean measurement reached 114.7 ms board
  handler-to-frame p95 and 132 ms largest task, but input p95 216 ms still missed
  the 200 ms gate. This was rejected, not recorded as a passing candidate.
  The accepted native modal correction subsequently passed real keyboard,
  focus-return, outside-click and background wheel-containment checks.
- Six-player canonical preflight (Node 24.11.1, seven action stages/player,
  240 samples) measured per-plan p95 0.384 ms; six-plan batch p95 2.097 ms.
  This is CPU-only work, not a server throughput or network latency claim.
- The connected live browser has a real signed-in existing mission. Preserve
  that user's current mission while verifying deployed read-only presentation;
  use a separate test mission for any destructive reset/lifecycle checks.

### Final local candidate evidence (2026-10-10)

- Repository npm 10.8.2 clean installation, strict browser/core/server test type
  checks, workspace lint and production builds pass. The full suite passes
  96 core + 62 server + 65 web tests (223 total), with the isolated PostgreSQL
  URL enabled. Core coverage gates pass: statements 61.35%, branches 48.90%,
  functions 74.13%, lines 61.16%.
- All three multiplayer browser journeys pass: two humans commit/resume with
  24 reconnects, a host plus bot resolves a turn, and cancellation reaches both
  clients. Loopback fixture identities are not real Clerk certification.
- All 34 screenshot baselines were visually reviewed, including home, ready
  room, mission, Help, Roster and object inspection at five widths, three stacked
  ship views and expanded mobile planning. No document horizontal overflow;
  controls remain reachable. Dense ship text and small touch targets still need
  tranche 3 usability work rather than being declared polished by screenshot
  approval alone.
- Frozen-source responsiveness run: Chromium 151.0.7922.34, 1440×900, 4× CPU
  slowdown, six server-authored players, three runs each for reduced and normal
  motion. Reduced-motion board handler-to-frame p95: 40.2/37.3/40.9 ms; browser
  input p95: 200/176/184 ms; largest interaction tasks: 148/132/126 ms. Normal
  motion: board 58.7/52.7/69.9 ms, input 160/160/152 ms, tasks 78/89/77 ms.
  These satisfy the stated budgets, but are not universal frame-rate, low-end
  GPU, network-latency, full startup or all-dialog performance certification.
  Performance tracing/video are disabled during measurement to avoid measuring
  the recorder; JSON evidence is attached to the test report. Visual tests retain
  failure traces/video separately.
- Final production build main JavaScript gzip total: 236.04 KB (+6.16 KB); CSS
  gzip: 10.54 KB (+0.38 KB). Licensed local WOFF2 fonts total 60.05 KB. The increase
  pays for stable subscriptions, response validation, compliant recovery and
  accessible presentation; it replaces unreliable external font dependencies.
- Runtime dependency audit: zero findings. Seven development-only Tailwind 3
  chain findings remain explicitly tracked in Q-16; no unreviewed major upgrade.
- Windows CI now owns reviewed screenshot comparisons and responsiveness gates;
  Linux CI retains durable PostgreSQL/Redis, reconnect, backup/restore, coverage
  and production-container certification. Provider status and live candidate
  smoke are still required after push; this record does not substitute for them.
- Final combined comparison then passed all five visual journeys but exposed
  insufficient performance margin: reduced-motion input p95 208 ms (board
  56 ms; largest task 148 ms), while normal motion passed at 184 ms. Delivery
  was held. Earlier passing samples are retained above as history, not used to
  conceal the miss; the budget is unchanged and a narrow containment correction
  must pass new frozen-source comparisons before release.
- Containment-only follow-up passed all five unchanged screenshot journeys.
  One run with preceding failed diagnostic assertions recorded normal-motion
  input 344 ms and is retained as a failed sample, not certification. A clean
  six-run unprofiled batch then passed: reduced-motion input 160/192/192 ms,
  board 44.9/38.9/32.6 ms, tasks 109/141/133 ms; normal-motion input 160/160/168 ms,
  board 42.6/62.8/43.5 ms, tasks 77/77/79 ms. Profiling separately identified
  injected test role queries contributing to pre-paint work; the clarified
  per-input paint-boundary harness requires its own final gate below.
- The paint-boundary triple run and subsequent true-CSS-motion-stop triple run
  each passed 15 visual journeys and five of six performance runs, with one
  208 ms input miss each. These are failed gates, not release certification.
  The latter slow warm opening included 38–41 ms input delay and 98 ms click
  processing; profiling found injected role/actionability work in the driver.
  Source remains frozen while the corrected trusted-input harness is verified.
- **Final unchanged-source gate: 21/21 passed.** All five visual/keyboard
  journeys passed three times against the 34 reviewed, unchanged baselines.
  Six-player trusted-input measurements at 4× CPU slowdown also passed all six
  runs: reduced motion input p95 128/128/136 ms, board 35.9/37.2/42.1 ms, largest
  tasks 84/83/85 ms; normal motion input 144/152/160 ms, board 51.7/43.0/49.6 ms,
  largest tasks 76/92/85 ms. Every expected trusted target and Escape was
  verified; the first Help opening stayed cold and no timing entry was dropped.
  This is the final local performance evidence, replacing neither the retained
  failed history nor the pending CI, device and real-identity release gates.
