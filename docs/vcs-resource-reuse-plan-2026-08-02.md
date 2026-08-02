# Gravity VCS Resource Reuse and Deployment Recovery Plan

**Assessment date:** 2026-08-02  
**Scope:** Read-only discovery and planning; no provider resources, environment values, databases, DNS, or deployments were changed  
**Recommended target:** Recover the existing Gravity Vercel project, reuse the Sixsmith Games identity and Railway operating pattern where safe, and isolate Gravity's runtime data and secrets

## Executive Decision

Gravity is already a Vercel project. Do not create a replacement project.

Recover and relink the existing Gravity project that serves `https://gravity.sixsmithgames.com`. Reuse the existing Vercel team, GitHub integration, Sixsmith Games DNS, Clerk organization/application when the shared-SSO gate passes, and Railway workspace/deployment pattern.

Do not reuse the VCS MongoDB database, VCS Railway service, VCS service tokens, or copied VCS secret values. Gravity already has a tested PostgreSQL/Redis persistence contract, so it should receive dedicated PostgreSQL, Redis, and API services in a Gravity Railway project under the existing Railway workspace/account.

## Verified Current State

| Area | Finding | Implication |
| --- | --- | --- |
| Gravity Vercel project | GitHub records production deployments for the `Gravity` project | Recover the existing project instead of provisioning another |
| Gravity custom domain | `gravity.sixsmithgames.com` resolves to Vercel and returns HTTP 200 | Preserve this as the production web domain |
| Stale repository homepage | `gravity-nine-red.vercel.app` returns 404 | Update the GitHub homepage after the project aliases are reconciled |
| Gravity deployment history | Latest recorded production deployment failed on 2026-03-18 at commit `0b36e88`; the prior deployment succeeded on 2026-03-16 | Diagnose the existing project before promotion |
| Live Gravity artifact | Current production bundle has no Clerk, Socket.IO, API URL, or private-session surface | The live site is the pre-beta client and must not be treated as beta-certified |
| Local Vercel linkage | `.vercel/project.json` is absent in Gravity and VCS; Vercel CLI 50.19.1 is installed but not authenticated | Login and explicit relinking are required before environment inspection or deployment |
| VCS web | `vcs.sixsmithgames.com` and the VCS Vercel project are live; latest GitHub deployment evidence is successful on 2026-08-01 | Reuse its Vercel/GitHub operating pattern, not its project |
| VCS API | The Railway `/health` endpoint is live and GitHub records successful Railway deployments | Railway is a proven Socket.IO container target for this organization |
| Railway access | Two VCS Railway project environments appear in GitHub deployment history; the Railway CLI is not installed locally | Identify the current canonical VCS project and install/authenticate the CLI before creating Gravity services |
| VCS persistence | VCS uses MongoDB/Mongoose; no Redis dependency is present | VCS's database is incompatible with Gravity's tested Drizzle/PostgreSQL repository |
| Gravity persistence | Gravity requires PostgreSQL plus Redis and has local migration, E2E, reconnect, and restore certification | Preserve this architecture and provision dedicated services |
| Shared identity | `clerk.sixsmithgames.com` resolves and serves JWKS; VCS documentation calls for the shared Sixsmith Games Clerk key; Gravity is configured for the same issuer | Shared user identity is feasible, subject to the security and SSO gate below |
| API DNS | `api.sixsmithgames.com`, `gravity-api.sixsmithgames.com`, and `gravity-api-staging.sixsmithgames.com` do not currently resolve | Add explicit Gravity API DNS after the Railway service exists |
| Staging DNS | `gravity-staging.sixsmithgames.com` is documented but not yet provisioned | Create it only after staging project/environment selection |
| Working tree | The beta implementation is a large uncommitted change set on top of `main` | Review and commit it on a beta branch before any provider deploy |

## Critical Security Finding

The VCS repository contains a database connection string with embedded credentials in three tracked files, including a tracked production environment file. GitHub secret scanning is not enabled or accessible for that repository.

Treat all real values in the tracked production environment file as compromised even when automated pattern matching did not identify them. The file declares MongoDB, Clerk, JWT, Stripe, and beta-access secrets.

Required containment before shared infrastructure work:

1. Rotate the exposed MongoDB user/password immediately and invalidate the old credential.
2. Rotate any real Clerk secret key, JWT secret, Stripe keys/webhook secret, beta passkeys, and service credentials that were ever committed in the tracked environment file.
3. Remove secret values from the current files, replace the production environment file with a names-only example, and add the real filename to `.gitignore`.
4. Review repository history and releases for the same values; use an approved history-rewrite procedure only after coordinating with all clones and deployments.
5. Enable GitHub secret scanning and push protection where the repository plan permits it.
6. Store provider values only in Vercel, Railway, Clerk, and the approved CI secret stores. Seal Railway secrets that do not need to be retrievable.

No exposed value should be copied into Gravity.

## Reuse Matrix

| Resource or pattern | Decision | Boundary |
| --- | --- | --- |
| Existing Gravity Vercel project | **Reuse** | Relink this checkout to the existing `Gravity` project and retain `gravity.sixsmithgames.com` |
| VCS Vercel project | **Do not reuse** | It remains a separate frontend project and deployment history |
| Vercel team and GitHub integration | **Reuse** | Connect the Gravity repository to its existing project and use preview-to-production promotion |
| Sixsmith DNS account | **Reuse** | Add dedicated Gravity API and staging records; do not repoint VCS records |
| Railway workspace/account | **Reuse** | Create one dedicated Gravity project so its API, PostgreSQL, and Redis share a private network |
| VCS Railway API service | **Do not reuse** | Different code, environment contract, deploy cadence, failure domain, and CORS policy |
| VCS MongoDB Atlas cluster/database | **Do not use for Gravity beta** | Rewriting the certified PostgreSQL repository to MongoDB creates risk without beta value |
| Gravity PostgreSQL | **Provision dedicated** | Separate staging and production databases or environments; no shared schema with VCS |
| Gravity Redis | **Provision dedicated** | Keep private to the Gravity Railway project; Redis remains non-authoritative for the beta |
| Sixsmith Clerk application/user pool | **Conditionally reuse** | Reuse only if cross-product SSO is intentional and the security gate passes |
| VCS Clerk secret key | **Do not copy** | Gravity's current backend verifies JWKS and does not require the Clerk secret key |
| Clerk publishable key and issuer | **Reuse after verification** | Add Gravity as an approved/satellite domain as required; keep Gravity API `azp` restricted to Gravity origins |
| VCS S3/asset infrastructure | **Defer** | Gravity's beta path does not require uploads; add a product-specific prefix/bucket policy if needed later |
| VCS service API/bearer tokens | **Never reuse** | Product-specific machine credentials need separate scopes and rotation |
| VCS multiplayer source | **Reuse concepts selectively** | Port contracts and tests, not Mongoose models or authentication middleware |

## Clerk SSO and Security Gate

Default recommendation: reuse the existing Sixsmith Games Clerk production application and user pool so a Sixsmith player has one identity across VCS and Gravity.

This is approved only when all of the following are true:

- The Clerk dashboard confirms the deployed VCS publishable key belongs to the `clerk.sixsmithgames.com` instance.
- `gravity.sixsmithgames.com` and `gravity-staging.sixsmithgames.com` are configured as approved domains/satellites where required.
- Redirect origins contain only the expected Sixsmith domains.
- Gravity production uses the live publishable key; local/staging follows the intended Clerk development/production-instance policy.
- Gravity API keeps `CLERK_AUTHORIZED_PARTIES` limited to the corresponding Gravity web origin. Do not add the VCS origin merely because the user pool is shared.
- A token minted from an unapproved origin is rejected by both Gravity REST and Socket.IO.
- VCS's temporary authorization behavior that treats every authenticated user as a DM is remediated or explicitly accepted as a separate VCS beta risk.
- The tracked VCS secrets have been rotated.

If those conditions cannot be satisfied, create a separate Gravity Clerk application under the same Clerk workspace instead. That reuses administration and billing without sharing the user pool or session blast radius.

Clerk supports shared authentication across domains through satellite-domain configuration, and recommends validating the token's `azp` authorized party. Gravity already performs that validation; the VCS middleware should not be copied. See [Clerk satellite domains](https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains) and [manual JWT verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification).

## VCS Multiplayer Reuse Boundary

Gravity has already adopted the best VCS session-control boundary:

- Durable player membership is stored separately from ephemeral socket presence.
- Reconnect joins an authenticated room and receives the latest durable snapshot.
- Clerk subject IDs are the stable identity boundary.

Gravity's implementation is already stronger in several areas and should remain authoritative:

- Versioned wire-state serialization
- PostgreSQL snapshots and submissions
- Optimistic `stateVersion` checks
- Idempotent turn `submissionId` values
- Hashed join codes
- REST and Socket.IO membership authorization
- Authorized-party validation
- Shared Redis abuse controls
- Durable reconnect and backup/restore tests

The next VCS concepts worth adapting are invite membership, explicit participant removal, and idempotent external room creation. Implement them as Gravity PostgreSQL transactions and API/socket contracts with concurrency tests; do not copy the Mongoose document methods directly.

## Target Topology

### Production

| Component | Target |
| --- | --- |
| Web | Existing Gravity Vercel project at `gravity.sixsmithgames.com` |
| API + Socket.IO | One-replica `gravity-api` service in a dedicated Gravity Railway project |
| API custom domain | `gravity-api.sixsmithgames.com` |
| PostgreSQL | Dedicated `gravity-postgres` Railway service on the project private network |
| Redis | Dedicated `gravity-redis` Railway service on the project private network |
| Identity | Shared Sixsmith Clerk production application if the SSO gate passes |
| DNS | Existing Sixsmith DNS account |

### Staging

| Component | Target |
| --- | --- |
| Web | Existing Gravity Vercel project preview/staging environment at `gravity-staging.sixsmithgames.com` |
| API + Socket.IO | One-replica Railway staging environment/service |
| API custom domain | `gravity-api-staging.sixsmithgames.com` |
| PostgreSQL and Redis | Isolated staging instances/environment; never production data |
| Identity | Clerk environment/domain configuration selected during the SSO gate |

Keep the API, PostgreSQL, and Redis inside the same Railway project/environment so private DNS and reference variables can be used. Railway documents zero-configuration [PostgreSQL](https://docs.railway.com/databases/postgresql) and [Redis](https://docs.railway.com/databases/redis) services plus project-scoped [private networking](https://docs.railway.com/networking/private-networking).

Keep the API at one replica for beta. Socket room fan-out and the turn commit critical section are still process-local. Multi-replica deployment requires a Socket.IO Redis adapter and a distributed session/turn lock first.

## Phased Execution Plan

### Phase 0 — Contain VCS Secret Exposure

1. Rotate every potentially real value from the tracked VCS production environment file.
2. Remove current secret material, add safe templates/ignore rules, and assess history cleanup.
3. Enable secret scanning/push protection or document the unavailable repository feature and add CI scanning.
4. Verify the VCS production API still passes health/auth/session smoke checks after rotation.

**Gate:** No known exposed credential remains valid.

### Phase 1 — Preserve and Prepare the Gravity Release Candidate

1. Review the large Gravity working-tree diff and separate unrelated/user-owned changes if necessary.
2. Create a beta release branch and commit the already-certified implementation.
3. Run the existing local CI-equivalent gates again from that commit.
4. Record the commit SHA, rules version, Docker image digests, and migration set.

**Gate:** The beta candidate is reproducible from a clean commit, not only from the current dirty workspace.

### Phase 2 — Recover Existing Provider Linkage

1. Authenticate Vercel CLI with the correct Sixsmith Games account/team.
2. List projects and confirm the existing Gravity project owns `gravity.sixsmithgames.com`.
3. Link `C:\Gravity` to that exact project; do not accept an automatically generated replacement.
4. List Vercel environment key names and pull into a temporary ignored file. Compare names only against Gravity's required contract.
5. Inspect the failed deployment `dpl_6ApMwsjpZv8Cvt3nwThwpjAAXJBN` and record its root cause.
6. Install/authenticate Railway CLI or use the dashboard; identify which VCS Railway project is canonical and whether the duplicate environment is intentional.

**Gate:** Project/team IDs, domains, current aliases, root directory, framework preset, build command, and environment ownership are documented.

### Phase 3 — Approve the Clerk Reuse Model

1. Verify the current VCS Clerk application, instances, domains, publishable key, issuer, and redirect policy in the dashboard.
2. Decide shared cross-product SSO versus a separate Gravity application.
3. If shared, add/verify Gravity domains and set Gravity-only authorized parties.
4. Exercise sign-in, sign-out, token refresh, REST auth, Socket.IO auth, rejected origin, and cross-product navigation with test accounts.

**Gate:** Real Clerk sessions pass Gravity's auth suite and no VCS-origin token is implicitly authorized for Gravity.

### Phase 4 — Provision an Isolated Gravity Railway Project

1. Create a Gravity Railway project in the existing workspace/account.
2. Add `gravity-api`, PostgreSQL, and Redis services in staging.
3. Reference private service variables instead of copying connection strings.
4. Configure sealed secrets for the join-code pepper and any provider credentials.
5. Configure the server Dockerfile, start command, `/health/live`, `/health/ready`, restart policy, region, and one replica.
6. Add `gravity-api-staging.sixsmithgames.com` after the generated Railway endpoint is healthy.
7. Apply Drizzle migrations as an explicit pre-deploy/release step and run repository integration tests.

**Gate:** Staging API readiness proves PostgreSQL and Redis connectivity, and no data service has a public endpoint unless required for an operator workflow.

### Phase 5 — Restore the Existing Gravity Vercel Deployment

1. Configure preview/staging values for `VITE_API_URL` and the selected Clerk publishable key.
2. Update CSP/CORS/authorized-party values to the actual staging domains; remove nonexistent API origins.
3. Build and deploy a preview from the beta commit.
4. Run the remote smoke test and real-account two-browser journey against staging.
5. Promote the tested artifact without rebuilding.
6. Verify `gravity.sixsmithgames.com`, then update the stale GitHub homepage alias.

**Gate:** The custom production domain serves the exact tested artifact with CSP, Clerk, API, and Socket.IO working.

### Phase 6 — Recovery and Beta Go/No-Go

1. Configure PostgreSQL backups and perform a provider-native restore rehearsal.
2. Rehearse Vercel and Railway rollback to the previous artifact.
3. Add error capture, correlated logs, dashboards, and alerts for readiness, error rate, turn latency, reconnect rate, and database health.
4. Run reconnect/load, failure-injection, and two-user completion exercises.
5. Complete the focused threat model, VCS/Gravity shared-identity review, and beta support runbook.

**Gate:** Recovery objectives are measured, alert paths are verified, and no P0/P1 finding remains open.

## Environment Contract by Destination

Values are intentionally omitted.

### Vercel web

- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_API_URL`
- Vercel/GitHub integration metadata managed by the provider

Never set `VITE_E2E_AUTH_ENABLED` in a deployable environment.

### Railway API

- `NODE_ENV`
- `HOST`
- `PORT`
- `CORS_ORIGIN`
- `DATABASE_URL` as a reference to the Gravity PostgreSQL service
- `REDIS_URL` as a reference to the Gravity Redis service
- `CLERK_ISSUER`
- `CLERK_AUDIENCE` only if the selected token configuration requires it
- `CLERK_AUTHORIZED_PARTIES`
- `JOIN_CODE_PEPPER`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`

Do not add VCS's `MONGODB_URI`, `JWT_SECRET`, `VCS_SERVICE_API_KEY`, Stripe keys, AWS keys, or Clerk secret key to the Gravity API unless a separately approved Gravity feature requires them.

## Open Gaps and Decisions

| Priority | Gap or decision | Required resolution |
| --- | --- | --- |
| P0 | VCS credentials are present in tracked files/history | Rotate, remove, assess history, and enable scanning before reuse |
| P0 | Gravity beta changes are uncommitted | Produce a clean beta commit before provider work |
| P0 | Existing Gravity Vercel deployment is stale and latest recorded deployment failed | Relink, inspect failure, configure env, and deploy preview |
| P0 | No Gravity API, PostgreSQL, or Redis exists remotely | Provision isolated Railway staging services |
| P0 | Real Clerk environment values have not been verified | Complete the SSO/security gate |
| P0 | Actual Gravity API domains do not resolve | Add DNS only after the Railway service is healthy |
| P1 | Railway CLI/access and canonical VCS Railway project are unclear | Authenticate and document workspace/project ownership |
| P1 | Shared Clerk user pool increases cross-product blast radius | Keep Gravity `azp` narrow and remediate/accept VCS role behavior |
| P1 | VCS has multiple Railway deployment environments/projects in GitHub history | Identify canonical services and retire/document duplicates |
| P1 | Provider-native backup/restore and rollback are untested | Rehearse before invitations |
| P1 | Production observability and alerts are absent | Add before external beta |
| P1 | Gravity leave/forfeit, abandonment, setup choices, and match history remain | Implement after staging foundation is stable |
| P2 | VCS invite/removal/idempotent integration patterns are not ported | Adapt as PostgreSQL contracts with tests, not source copying |

## Immediate Next Action After Approval

Perform Phase 0 and Phase 1 first. Once the VCS credentials are rotated and the Gravity beta work is preserved in a clean commit, authenticate Vercel and recover the existing Gravity project linkage. Provider provisioning and migration must remain blocked until those gates pass.

