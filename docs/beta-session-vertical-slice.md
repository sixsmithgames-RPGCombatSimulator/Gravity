# Beta session vertical slice

Updated: 2026-08-04

Status: Implemented and durable-stack certified locally; external real-identity staging remains

Depends on: `docs/multiplayer-architecture-outline.md`, `packages/core/src/serialization/GameStateWire.ts`

## Outcome

Two authenticated people can create and join a private Gravity session, ready up, start a server-authored game, submit one complete turn through the server, refresh either browser, and resume from the same committed state.

## Confirmed beta defaults

- Product mode: invite-only asynchronous multiplayer.
- Authentication: Clerk for the first beta, verified against issuer JWKS on both REST and Socket.IO.
- Seats: 2–6 human seats; first integration fixture uses 2 humans.
- Bots: excluded from the first network slice, then moved to server-only execution.
- Turn timer: none for invite beta.
- Spectators and public matchmaking: deferred.

These defaults constrain the slice without closing future product options.

## Implementation completed on 2026-08-01

- Added PostgreSQL `sessions`, `session_participants`, `state_snapshots`, and `turn_submissions` records plus generated migrations and uniqueness constraints.
- Added Clerk JWT verification with issuer, signature, key-id, expiry, and subject enforcement. Protected REST and Socket.IO paths share the same verifier.
- Added private create, idempotent join/reconnect, ready/unready, host-only start, authenticated resume, and room rejoin.
- Added deterministic server-authored standard setup and `GameStateSnapshotV1` persistence.
- Added per-player turn submission. The server waits for every active participant, processes the complete turn through the core engine, commits one monotonic snapshot, returns original results for retries, and rejects stale or conflicting submissions.
- Replaced mock-first web bootstrap with create/join, lobby, readiness, start, refresh-resume, socket resync, and server snapshot hydration.
- Kept durable membership separate from socket presence. A disconnect never removes membership or changes host authority.
- Added unit, HTTP, socket, Clerk-signature, migration, and real PostgreSQL restart-resume tests. CI provisions PostgreSQL, applies migrations, and runs the persistence integration test.
- Replaced the `@latest` CDN/document-rewrite gate with pinned `@clerk/react`, an environment-driven React provider, explicit loading/failure/signed-out surfaces, and a user account control.
- Added Clerk authorized-party (`azp`) validation, deployable CSP/security headers, and shared Redis fixed-window limits for the HTTP edge, identity mutations, socket handshakes, and room joins.
- Added a loopback-only Playwright identity/server harness. Two isolated Chromium contexts now create, join, ready, launch, submit both plans, observe the authoritative turn-2 snapshot, and refresh-resume without console or page errors.
- Added a second production-like rehearsal using PostgreSQL, password-protected Redis, shared abuse controls, and two waves of 12 authenticated reconnects.
- Added hosted `redis://`/`rediss://` configuration, isolated staging compose, a guarded logical backup/restore rehearsal, remote smoke tooling, and the staging promotion/rollback/recovery runbook.
- Added configured-seat visibility, host cancellation, and server-authoritative bot seat controls to the ready room.
- Added a shared player-safe request failure contract. HTML proxy/platform responses and malformed bodies stay in developer diagnostics, while the player sees the attempted action, failed result, known cause, preserved state, and exact recovery. A second consecutive equivalent failure stops retry guidance and supplies a support code.

The implementation borrows VCS's proven durable-membership/ephemeral-presence boundary and authenticated room rejoin, while adding state-version preconditions and idempotent submissions that VCS does not apply consistently.

## In scope

1. Server-verified identity on REST and Socket.IO.
2. Private session creation with an unguessable join code.
3. Idempotent join and reconnect for the same identity.
4. Ready/unready and host-authorized start.
5. Server creation of canonical `GameState`.
6. Snapshot persistence using `GameStateSnapshotV1` and monotonic `stateVersion`.
7. One authoritative submitted-turn path with stale-version and duplicate-submission rejection.
8. Socket room broadcasts for lobby and committed state updates.
9. Web home, join, lobby, waiting, reconnect, and actionable failure states.
10. Integration coverage for the full happy path and required rejection cases.

## Explicitly out of scope

- Public matchmaking, spectators, chat, turn timers, host kicking, paid entitlements, replay UI, and horizontal server scaling.
- Delta compression. The first slice sends versioned full snapshots; deltas can follow after correctness and reconnect are proven.
- Server restart recovery beyond loading the latest committed PostgreSQL snapshot. Event replay is a later hardening step.

## Data contract

Add these server-owned records:

| Record | Required fields |
| --- | --- |
| `sessions` | `id`, `status`, `join_code_hash`, `max_players`, `created_by`, timestamps |
| `participants` | `id`, `session_id`, `user_id`, `player_id`, `display_name`, `seat_number`, `is_ready`, timestamps |
| `state_snapshots` | `id`, `session_id`, `state_version`, `turn_number`, `schema_version`, `state`, `created_at` |
| `turn_submissions` | `id`, `session_id`, `participant_id`, `submission_id`, `expected_state_version`, `actions`, `result_state_version`, timestamps |

Required constraints:

- Unique session join-code hash.
- Unique `(session_id, user_id)` participant membership.
- Unique `(session_id, seat_number)` and `(session_id, player_id)`.
- Unique `(session_id, state_version)` snapshot.
- Unique `(session_id, submission_id)` turn submission.

## HTTP contract

| Method and path | Purpose | Success response |
| --- | --- | --- |
| `POST /sessions` | Create a private lobby and host participant | Session summary, participant identity, `stateVersion: 0` |
| `POST /sessions/join` | Join by code or reconnect idempotently | Session summary and participant identity |
| `POST /sessions/:id/ready` | Set the caller's readiness | Updated lobby summary |
| `POST /sessions/:id/bots` | Host fills, replaces, or reopens a non-host seat with a server-controlled bot | Updated lobby summary |
| `POST /sessions/:id/cancel` | Host abandons the waiting game for every member | Abandoned session summary |
| `POST /sessions/:id/start` | Host starts when the configured roster is full and all human seats are ready | `GameStateSnapshotV1` |
| `GET /sessions/:id` | Resume lobby or active game | Session summary plus latest snapshot when active |
| `POST /sessions/:id/turns` | Submit actions with idempotency and version precondition | Committed `GameStateSnapshotV1` plus submission result |

Every mutation requires a server-verified user and session membership. Error responses use stable developer codes such as `UNAUTHENTICATED`, `NOT_A_MEMBER`, `SESSION_FULL`, `NOT_READY`, `STALE_STATE`, `DUPLICATE_SUBMISSION`, `INVALID_ACTION`, and `CONFLICT`. The browser maps these codes to player-safe recovery copy and never displays or parses an HTML platform response as JSON.

## Socket contract

- Client joins `session:{sessionId}` only after token verification and membership lookup.
- Server emits `session_updated`, `game_started`, `state_snapshot`, `turn_rejected`, and `game_ended`.
- Socket messages never bypass the same service methods and authorization used by REST.
- Reconnect immediately emits the latest lobby summary or state snapshot.
- The ready room renders every configured player slot, including open and bot-controlled seats.
- Bot plans are generated by the authoritative server and do not block human turn submission.
- Canceling or replacing a human seat removes that client's durable resume pointer on the next live update.

## Commit algorithm

1. Authenticate and authorize participant membership.
2. Validate `submissionId`, `expectedStateVersion`, current phase, and submitted actions.
3. Acquire a session-scoped lock.
4. Re-read the current snapshot and reject stale or duplicate input.
5. Deserialize with `deserializeGameStateSnapshot`.
6. Run the core engine on the server.
7. In one database transaction, insert the submission and next snapshot with `stateVersion + 1`.
8. Release the lock and broadcast the committed snapshot.
9. On any failure, commit nothing and return a stable rejection code.

## Delivery status

1. Complete — authentication/default decisions.
2. Complete — schema migrations and real PostgreSQL repository test.
3. Complete — auth and membership middleware.
4. Complete — session service and REST handlers.
5. Complete — Socket.IO room authorization, reconnect, and broadcasts.
6. Complete — web home/join/lobby/reconnect state machine.
7. Complete — one complete turn path moved to server authority for network sessions.
8. Complete locally — PostgreSQL server-restart resume, durable two-browser turn/resume, reconnect waves, and backup/restore are committed in CI; real-Clerk external staging remains a deployment gate.

## Exit criteria

- Complete locally: two isolated verified test identities complete create → join → ready → start → submit → resume in Chromium.
- Complete: the client receives `GameStateSnapshotV1`; `players` hydrates to a runtime `Map`.
- Complete: duplicate submissions return the original result and never advance twice.
- Complete: stale, unauthorized, non-member, and wrong-player submissions do not mutate state.
- Complete: a new repository/server instance loads the latest committed PostgreSQL snapshot.
- Complete: network play submits plans to the server instead of invoking local `processTurn`.
- Complete locally: the journey runs against PostgreSQL and password-protected Redis and survives 24 reconnects.
- Remaining: run it against externally hosted staging with real Clerk identities and provider-native recovery.

## Remaining production certification

1. Link/provision external staging and run the committed two-browser journey with real Clerk sessions and managed PostgreSQL/Redis.
2. Add captain/officer/mission selection; the current beta factory uses deterministic canonical defaults.
3. Add explicit leave/forfeit, abandoned-session handling, and match history.
4. Complete sustained load testing, distributed locking/fan-out before multi-replica scale, telemetry/alerts, provider-native recovery, threat modeling, privacy, and support operations before broad beta access.
