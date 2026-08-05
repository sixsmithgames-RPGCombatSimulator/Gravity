# Gravity coding contract

This contract applies to every coding task in this repository. Before changing
code, read this file and `CODING_STANDARDS.md`. A task is not complete until the
changed behavior follows those standards, relevant tests pass, and the deployed
multiplayer path is compatible end to end.

## Player-facing failures are release-blocking

Any new or changed player-visible failure, warning, recovery state, toast,
dialog, or empty state must follow the User-facing errors section of
`CODING_STANDARDS.md`.

- Use player language, not exception text, internal service names, transport
  terms, JSON/schema language, route names, database language, or raw error
  codes.
- Say what Gravity was trying to do, what failed, why it failed, whether the
  lobby/turn/game state changed, and exactly what the player can do next.
- Keep developer diagnostics in logs. A support code may appear only as
  secondary text after the player explanation.
- Identify consecutive failures by normalized error plus workflow and stage.
  If the same failure returns immediately after the player tries the offered
  correction, the second occurrence must stop the loop and show the support
  escalation required by the coding standard.
- The escalation must apologize in simple player voice, direct the player to
  `info@sixsmithgames.com`, ask them to include the support code, and reassure
  them that the last authoritative lobby or turn state is safe.
- Add or update tests for player copy, the next action, the consecutive-failure
  boundary, support email, and non-exposure of developer details.

Do not approve a change that introduces a generic “something went wrong,” an
unexplained internal code, a raw parser/network exception, a retry loop without
a stopping boundary, or an error with no player action.

## Multiplayer authority is release-blocking

PostgreSQL and the Gravity server own durable session membership, roster state,
readiness, bot control, turn versions, and committed snapshots. The browser may
optimistically display work in progress but must not invent or silently retain
authoritative multiplayer state.

- Authenticate and authorize every REST and Socket.IO mutation on the server.
- Make host-only actions idempotent or conflict-safe under concurrent joins,
  readiness changes, bot changes, cancellation, reconnects, and launch.
- Preserve the last committed snapshot when a request fails. Tell the player
  whether their attempted action was applied.
- Test positive, unauthorized, stale-state, duplicate, reconnect, and
  cross-client broadcast behavior for changed session flows.
- Bots are server-controlled players. Bot actions must be generated and
  committed by the authoritative server, never trusted from a browser client.

## Cross-service rollout is release-blocking

Gravity web runs on Vercel and the authoritative API, PostgreSQL, and Redis run
on Railway. A feature is not complete merely because source code is pushed.

- Roll out dependency changes in this order: compatible database migration,
  Railway API, then Vercel web UI that calls the new contract.
- Keep old and new clients compatible during rollout when possible. If that is
  not possible, gate the new UI until the Railway health/version signal proves
  the required API capability is live.
- Verify the production/staging web origin, API health, CORS, Clerk validation,
  REST mutation, Socket.IO authentication, and the changed player journey after
  deployment.
- An HTML proxy or platform error page must never be parsed or displayed as a
  player error. Log response status/content type and show compliant recovery
  copy instead.
- Do not declare deployment complete while a migration is pending, a required
  route returns 404, or Vercel and Railway are serving incompatible commits.

## Architecture-first changes are release-blocking

Do not begin a cross-cutting implementation while its governing architecture
document or ADR is still Proposed. Changes that alter two or more of authority,
persistence, routing, validation, player-facing recovery, migration, or rollout
require an accepted architecture document before runtime implementation.

The document must define the problem and non-goals, terminology, authority and
state lifetimes, versioned schemas/contracts, data flow, validation and recovery,
player-visible failures, migration and compatibility, rollback, observability,
worked examples, required tests, and acceptance gates. Keep it synchronized
with implementation; a material departure requires documentation review.

## Delivery

Completed work must be validated, committed, and pushed directly to
`origin/main` so deployment can start, unless the user explicitly requests a
different delivery path.

Before pushing, run the repository's required checks and confirm local `main`
is based on current remote `main`. After pushing, verify the remote commit and
the associated Vercel and Railway deployment or commit status. Never deploy a
failing change, and never leave a required database migration unapplied while a
dependent player-facing control is live.
