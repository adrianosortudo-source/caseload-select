import { defineConfig } from '@playwright/test';
import path from 'node:path';
import base from './playwright.desired-client.config';

const siteRoot = process.env.DESIRED_CLIENT_SITE_WORKTREE
  ?? path.resolve('../../caseloadselect-site-worktrees/desired-client-v2');
export default defineConfig({
  ...base,
  testMatch: process.env.DESIRED_CLIENT_FULL_REVIEW === '1' ? '**/*.spec.ts' : 'embed.spec.ts',
  reporter: [['line'], ['json', { outputFile: process.env.DESIRED_CLIENT_FULL_REVIEW === '1' ? 'docs/desired-client-v2/review/review-browser-results.json' : 'docs/desired-client-v2/review/embed-browser-results.json' }]],
  testIgnore: [],
  webServer: [
    ...(Array.isArray(base.webServer) ? base.webServer : [base.webServer!]),
    {
      command: 'node tests/desired-client-v2-wrapper-fixture/server.mjs',
      cwd: siteRoot,
      url: 'http://localhost:3300/tools/desired-client-matter.html',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
