import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.STAGING_DATABASE_URL ||
  'postgresql://gravity:gravity_staging_password@127.0.0.1:55432/gravity_staging';
const redisUrl = process.env.STAGING_REDIS_URL || 'redis://:gravity_staging_redis_password@127.0.0.1:56379';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:4197',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'staging-chromium',
      metadata: { apiOrigin: 'http://127.0.0.1:3110' },
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run e2e:staging-server --workspace=@gravity/server',
      url: 'http://127.0.0.1:3110/health/ready',
      reuseExistingServer: false,
      timeout: 45_000,
      env: {
        GRAVITY_E2E: '1',
        NODE_ENV: 'test',
        E2E_API_PORT: '3110',
        E2E_WEB_ORIGIN: 'http://127.0.0.1:4197',
        DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl,
        JOIN_CODE_PEPPER: 'gravity-staging-certification-pepper',
      },
    },
    {
      command: 'npm run dev --workspace=@gravity/web -- --host 127.0.0.1 --port 4197',
      url: 'http://127.0.0.1:4197',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        GRAVITY_E2E: '1',
        VITE_E2E_AUTH_ENABLED: 'true',
        VITE_API_URL: 'http://127.0.0.1:3110',
      },
    },
  ],
});
