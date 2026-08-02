import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4187',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      metadata: { apiOrigin: 'http://127.0.0.1:3100' },
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run e2e:server --workspace=@gravity/server',
      url: 'http://127.0.0.1:3100/health/live',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { GRAVITY_E2E: '1' },
    },
    {
      command: 'npm run dev --workspace=@gravity/web -- --host 127.0.0.1 --port 4187',
      url: 'http://127.0.0.1:4187',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        GRAVITY_E2E: '1',
        VITE_E2E_AUTH_ENABLED: 'true',
        VITE_API_URL: 'http://127.0.0.1:3100',
      },
    },
  ],
});
