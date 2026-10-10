import { defineConfig, devices } from '@playwright/test';

/**
 * Purpose: Certify the rendered multiplayer UI and interaction responsiveness
 * with reproducible server-authored state. Parameters: None. Returns: Browser
 * runner configuration. Side effects: Starts only loopback fixture services.
 * Pixel baselines are reviewed on Windows/Chromium and run on the same CI OS;
 * Linux durable-stack mechanics remain a separate gate, not a font tolerance.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'visual-quality.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-quality-report' }]],
  timeout: 90_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 },
  },
  snapshotPathTemplate: '{testDir}/visual-baselines/{projectName}/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:4187',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-windows', grepInvert: /six-player/, use: { ...devices['Desktop Chrome'] } },
    { name: 'performance-chromium', grep: /six-player/,
      use: { ...devices['Desktop Chrome'], trace: 'off', video: 'off' } },
  ],
  webServer: [
    {
      command: 'npm run e2e:server --workspace=@gravity/server',
      url: 'http://127.0.0.1:3100/health/live',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { GRAVITY_E2E: '1', GRAVITY_VISUAL_FIXTURE: '1' },
    },
    {
      command: 'npm run dev --workspace=@gravity/web -- --host 127.0.0.1 --port 4187',
      url: 'http://127.0.0.1:4187',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { NODE_ENV: 'production', GRAVITY_E2E: '1', VITE_E2E_AUTH_ENABLED: 'true', VITE_API_URL: 'http://127.0.0.1:3100' },
    },
  ],
});
