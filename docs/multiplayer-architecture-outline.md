# Gravity Multiplayer Architecture Outline

## Purpose and scope
- Define how Gravity delivers real session-based multiplayer without any "hot-seat" local pass-and-play mode.
- Cover connectivity, authority model, session lifecycle, persistence, APIs, client UX, reliability, and testing so implementation can proceed with clear contracts.

## Current baseline (observed)
- Backend: `packages/server/src/server.ts` exposes Express + Socket.IO, Redis is wired for future pub/sub/caching, but only emits a `connected` event.
- Frontend: `packages/web/src/App.tsx` boots a local mock game via `createMockGame` and uses Zustand store for all state; no real session/join flow.
- Docs: commercial polish statement flags incomplete multiplayer infrastructure and need for real session lifecycle.

## Goals and constraints
- **No hot-seat**: All turns are taken by distinct authenticated players over the network.
- **Server-authoritative**: All turn validation and state progression run on the server using the core engine; clients only propose actions.
- **Reconnect/resume**: Players can drop/rejoin without losing the game.
- **Persistent sessions**: Games survive page refresh and server restarts.
- **Fairness and integrity**: Turn ownership, locking, and conflict resolution are explicit.

## Player identity and authentication
- Use authenticated user identities (email/password or SSO; token-based for the client). Anonymous guests are optional but must still map to a unique playerId per session.
- Store session-scoped `playerId` + display name; map to userId when available.
- Require auth token on both REST and Socket.IO handshake; reject if missing/invalid.

## Session lifecycle (happy path)
1. **Create session**
   - Inputs: mode (multiplayer only), maxPlayers (>=2), optional bot seats, visibility (public/private), invite code.
   - Output: sessionId, joinCode, creator as first participant, lobby state.
2. **Join session**
   - Validate capacity, joinCode/visibility, and duplicate join attempts.
   - Assign player slot; return session snapshot and player token for reconnection.
3. **Lobby**
   - Players can ready/unready; host can kick; bots can fill optional seats (future flag).
   - Start conditions: minimum players satisfied and all required players ready.
4. **Start game**
   - Server initializes `GameState` via core engine; persists initial snapshot + event log entry.
   - Broadcast `game_started` with assigned turn order and player-to-seat mapping.
5. **Turn loop**
   - Active player submits planned actions; server validates and processes via engine; commits new state + turn log entry; advances turn.
   - Other players receive deltas and updated turn ownership.
6. **Game end**
   - Server runs final scoring; persists result; broadcasts `game_ended` with breakdown.
7. **Resume/reconnect**
   - Any player can reconnect using sessionId + player token; server replays latest state and turn ownership.
8. **Leave/forfeit**
   - Player can leave; server marks slot open or forfeited; configurable policy for bot fill or game termination.

## Authority, validation, and conflict handling
- All inputs are proposals; server runs deterministic core engine to produce the authoritative `GameState`.
- Turn lock: only the active player may submit actions; server rejects concurrent conflicting submissions with actionable errors.
- Idempotency: turn submissions include client-generated `submissionId`; server de-dupes repeated sends on reconnect.
- Staleness: include `stateVersion`/`turnNumber` precondition; server rejects if client is behind and sends latest state.

## Data model (PostgreSQL via Drizzle)
- `users` (id, auth fields, display_name, created_at, updated_at)
- `sessions` (id, status: lobby|active|ended|abandoned, max_players, visibility, join_code, created_by, created_at, updated_at)
- `participants` (id, session_id, user_id nullable for guests, player_id, display_name, seat_number, is_ready, is_bot, joined_at, left_at, forfeit_reason)
- `turns` (id, session_id, turn_number, acting_player_id, submission_id, action_payload JSONB, result_state_version, created_at)
- `state_snapshots` (id, session_id, state_version, turn_number, state JSONB, created_at)
- `events`/`logs` (id, session_id, turn_number nullable for lobby events, type, payload JSONB, created_at)
- `tokens` (id, session_id, participant_id, token_hash, expires_at) for reconnect/auth scoping.

## Networking surfaces
### REST (Express)
- `POST /sessions` create session
- `POST /sessions/:id/join` join via invite/join code
- `POST /sessions/:id/ready` toggle ready
- `POST /sessions/:id/start` start (host/auto when ready conditions met)
- `GET /sessions/:id` fetch snapshot + participants
- `POST /sessions/:id/leave` leave/forfeit
- `GET /sessions/:id/turns` paginated turn log (for audit/replay)

### WebSocket (Socket.IO)
- Namespaces/rooms per sessionId.
- Events emitted by server:
  - `session_updated` (participants, readiness, lobby state)
  - `game_started` (stateVersion, turnNumber, activePlayerId)
  - `state_delta` or `state_snapshot` after each turn
  - `turn_prompt` (whose turn, deadlines/timeouts if any)
  - `turn_result` (applied actions, errors if rejected)
  - `player_joined` / `player_left`
  - `game_ended` (final scores, breakdown)
- Events from clients:
  - `join_session` (sessionId, token)
  - `leave_session`
  - `set_ready`
  - `submit_turn` (submissionId, stateVersion, plannedActions payload)
  - `request_snapshot` (for resync)

## State sync strategy
- Store full authoritative `GameState` on server.
- Send **snapshots** on join/reconnect and periodically (e.g., every N turns) for safety.
- Send **deterministic deltas** (turn result payload) on each processed turn.
- Keep `stateVersion` monotonic for optimistic concurrency and cache invalidation.

## Persistence, caching, and scaling
- Use PostgreSQL as source of truth for sessions, turns, and snapshots.
- Use Redis for:
  - Socket.IO adapter (multi-instance fan-out)
  - Ephemeral locks for turn ownership and submission de-duplication
  - Short-lived reconnect tokens if needed
- Horizontal scale: multiple stateless server instances + shared Redis + Postgres.

## Client changes (web)
- Replace mock boot in `App.tsx` with session bootstrap:
  - If no sessionId: show create/join UI (join code entry, lobby view).
  - On join/create success: connect Socket.IO with token; store session + player identity in Zustand.
  - Load initial snapshot; hydrate game store from server state instead of `createMockGame`.
- Add lobby UI: participant list, readiness, invite code, start button (if host) and no hot-seat toggle (removed).
- Add reconnect flow: persist sessionId + player token in local storage; on load, attempt reconnect before showing lobby.
- Guardrails: disable turn UI when not active player; show waiting/observation state.
- Handle server errors with actionable messaging (per coding standards).

## Bot handling (if/when enabled)
- Bots are server-side participants only; server generates their actions after active player turns or when filling empty seats.
- Client treats bots as read-only participants; no local simulation.

## Reliability and failure cases
- Disconnect: keep session state server-side; on reconnect, send latest snapshot and pending prompts.
- Timeout policy: optional turn timers; server can auto-pass/forfeit or reassign seat per product decision.
- Host migration: not needed if server-authoritative; if lobby host leaves, designate next participant as lobby admin.
- Data corruption guard: validate all incoming payloads; reject with clear error reasons and remediation steps.

## Observability and tooling
- Structured logging (winston) with sessionId/playerId correlation.
- Metrics: turn latency, rejection reasons, reconnect rate, dropouts, session completion rate.
- Audit trail: turn log + event log accessible via admin tooling for debugging disputes.

## Testing strategy
- Unit: validate REST handlers, validators, and engine integration for turn submission.
- Integration: end-to-end session flow (create/join/start/turns/end) with Postgres + Redis in test harness.
- Load: simulate concurrent sessions and reconnect storms to validate Socket.IO + Redis adapter.
- Client: Cypress/Playwright flows for create/join/reconnect; component tests for lobby/turn gating.
- Regression: snapshots of engine state after canonical sequences to detect drift.

## Migration and rollout steps
- Add database migrations for new tables.
- Update `.env.example` with required auth, CORS, Redis, and token settings.
- Incremental rollout: 
  1) Ship lobby/create/join backed by REST (no turn play yet), 
  2) Add Socket.IO session room and snapshot delivery, 
  3) Wire turn submission to server engine, 
  4) Replace mock client boot fully.

## Open decisions to resolve
- Authentication provider (first-party credentials vs external IdP).
- Turn timer policy and consequences (auto-pass vs forfeit vs bot fill).
- Public matchmaking vs invite-only sessions for first release.
- Bot availability at launch or deferred.
- Spectator mode support and visibility controls.
