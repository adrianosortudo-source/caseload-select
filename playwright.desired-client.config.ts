import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/desired-client-v2',
  testIgnore: 'embed.spec.ts',
  outputDir: 'test-results/desired-client-v2',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['line'], ['json', { outputFile: 'docs/desired-client-v2/review/direct-browser-results.json' }]],
  use: {
    baseURL: 'http://localhost:3301',
    browserName: 'chromium',
    channel: process.platform === 'win32' ? 'chrome' : undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev --webpack --hostname localhost --port 3301',
    url: 'http://localhost:3301/tools/desired-client-matter',
    reuseExistingServer: false,
    timeout: 240_000,
    env: { NEXT_TELEMETRY_DISABLED: '1', DESIRED_CLIENT_AI_ENABLED: 'false' },
  },
});
