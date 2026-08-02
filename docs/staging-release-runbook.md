# Gravity staging release runbook

Updated: 2026-08-02  
Status: Repository-side rehearsal passes; external project linkage and managed services remain operator actions

## Purpose

Promote one immutable Gravity candidate through a production-like staging environment, prove the private multiplayer journey with real Clerk sessions, and retain a tested path to roll back code or restore data.

## Current release topology

| Surface | Staging target | Required property |
| --- | --- | --- |
| Web | Vercel static Vite deployment at `https://gravity-staging.sixsmithgames.com` | Preview deployment is tested before promotion; CSP permits only the selected API and Clerk origins |
| API + Socket.IO | One container replica at `https://gravity-api-staging.sixsmithgames.com` | Native Node HTTP/WebSocket support, health checks, graceful shutdown, immutable image digest |
| PostgreSQL | Managed PostgreSQL in the same region as the API | Encrypted connection, automated backups, point-in-time recovery where available |
| Redis | Managed Redis exposed through `rediss://` | TLS, authentication, persistence appropriate to the provider |
| Identity | Clerk staging/development instance | Web origin allowlisted; issuer, publishable key, and `azp` authorized party agree |

The beta API must remain at **one replica**. Durable game state is shared in PostgreSQL and rate limits are shared in Redis, but Socket.IO fan-out and the turn critical section are still process-local. Do not scale horizontally until the Socket.IO Redis adapter and a distributed session lock are implemented and load-tested.

Vercel Services is not selected for the beta API. Services is currently beta and the local deployment guidance does not validate this existing Node/Express layout. Keep the static web deployment on Vercel and use a proven Node container target unless the backend is deliberately adapted and certified as a Vercel Service.

## Required secrets and configuration

Never commit the values below. Store them in the deployment provider and CI secret store.

### Web build

- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_API_URL=https://gravity-api-staging.sixsmithgames.com`
- Vercel project values: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

### API runtime

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT` supplied by the platform
- `CORS_ORIGIN=https://gravity-staging.sixsmithgames.com`
- `DATABASE_URL`
- `REDIS_URL` using `rediss://` for managed TLS Redis
- `CLERK_ISSUER`
- `CLERK_AUDIENCE` when the token template uses one
- `CLERK_AUTHORIZED_PARTIES=https://gravity-staging.sixsmithgames.com`
- `JOIN_CODE_PEPPER` from a secret manager, at least 32 random characters
- `RATE_LIMIT_WINDOW_MS=900000`
- `RATE_LIMIT_MAX_REQUESTS=100`

Percent-encode any password characters that are reserved in URLs before placing credentials in `DATABASE_URL` or `REDIS_URL`.

## Local staging rehearsal

1. Export values based on `ops/staging/.env.example` into the shell or a non-committed env file.
2. Start isolated data services:

   ```powershell
   docker compose --project-name gravity-staging --file docker-compose.staging.yml up --detach --wait postgres redis
   ```

3. Apply migrations and run the durable browser journey:

   ```powershell
   $env:DATABASE_URL='postgresql://gravity:<password>@127.0.0.1:55432/gravity_staging'
   $env:STAGING_DATABASE_URL=$env:DATABASE_URL
   $env:STAGING_REDIS_URL='redis://:<password>@127.0.0.1:56379'
   npm run db:migrate --workspace=@gravity/server
   npm run test:e2e:staging
   ```

4. Rehearse backup and restore. Restore refuses to run without the exact database confirmation:

   ```powershell
   node ops/postgres/docker-backup.mjs rehearse --project gravity-staging --database gravity_staging --user gravity
   ```

5. Remove only the isolated rehearsal project after verifying its label/name:

   ```powershell
   docker compose --project-name gravity-staging --file docker-compose.staging.yml down --volumes
   ```

The committed journey creates two identities, creates/joins/readies/starts a private session, commits a complete server-authoritative turn, refresh-resumes turn 2, and completes two waves of 12 authenticated socket reconnects.

## External staging deployment

1. Link the frontend deliberately; this repository is not currently linked:

   ```powershell
   vercel link
   vercel pull --yes --environment=preview
   ```

2. Build and push the API image using the exact tested commit. Record both Git SHA and image digest.
3. Run `npm run db:migrate --workspace=@gravity/server` as a one-off release job against staging before routing traffic. Migrations must be backward-compatible with the currently deployed API.
4. Deploy the API image at one replica and wait for `/health/ready` to report PostgreSQL and Redis as `ok`.
5. Build the web artifact with preview environment values, deploy it without rebuilding, and record its URL:

   ```powershell
   vercel build
   vercel deploy --prebuilt
   ```

6. Point the staging aliases/DNS only after both candidates are healthy.
7. Run the remote boundary smoke:

   ```powershell
   npm run staging:smoke -- --web https://gravity-staging.sixsmithgames.com --api https://gravity-api-staging.sixsmithgames.com
   ```

8. In two clean browser profiles with distinct real Clerk accounts, repeat create → join → ready → launch → submit → turn 2 → refresh/resume. Confirm there are no console errors and capture the session ID and deployment identifiers in the release record.

## Promotion

Promotion requires all of the following:

- CI and the durable local staging rehearsal pass on the same commit.
- Remote smoke passes CSP, readiness, CORS, REST authentication, and Socket.IO authentication.
- Real-Clerk two-browser flow passes.
- No unresolved P0 issue, migration warning, or 5xx spike remains.
- A recent database backup exists and its restore procedure has been rehearsed.

Promote the already-tested Vercel artifact rather than rebuilding it:

```powershell
vercel promote <tested-preview-url>
```

Promote the API by repointing the staging/production service to the tested image digest.

## Rollback

### Code-only rollback

1. Stop promotion if readiness or smoke fails.
2. Repoint the API to the previous known-good image digest.
3. Roll back the frontend alias to the previous deployment:

   ```powershell
   vercel rollback <known-good-deployment-url-or-id>
   ```

4. Re-run remote smoke and inspect logs before reopening access.

Do not automatically reverse database migrations. Beta migrations must use an expand/contract sequence so the previous API remains compatible. Ship a forward repair migration when schema correction is necessary.

### Data recovery

Data restore is a disaster-recovery action, not a normal code rollback. Quiesce API writes, identify the exact database, take a final safety backup, and require explicit confirmation:

```powershell
node ops/postgres/docker-backup.mjs restore --project gravity-staging --database gravity_staging --user gravity --output <verified.dump> --confirm gravity_staging
```

After restoration, run migrations, `/health/ready`, the PostgreSQL integration test, and the two-browser resume flow before reopening the environment.

## Minimum observability for beta

- Alert when readiness fails for two consecutive checks.
- Alert on elevated HTTP 5xx and Socket.IO connection errors.
- Record deployment SHA/image digest, session ID, state version, request correlation ID, rejection code, and turn commit latency.
- Track create→join conversion, reconnect rate, turn submission latency, stale/invalid rejection count, and session completion rate.
- Retain server logs long enough to investigate a beta report without storing join codes or identity tokens.

## Remaining external blockers

- Create/link the Vercel project and staging domains.
- Select and provision the single-replica Node container platform.
- Provision managed PostgreSQL and managed TLS Redis.
- Create two real Clerk staging test accounts and configure the allowed web origin.
- Configure monitoring/alerts and exercise provider-native backup recovery.
