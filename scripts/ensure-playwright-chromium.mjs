import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

// Use the lockfile's Chromium. A runner with working native libraries does not
// need an apt refresh; missing libraries still take the original dependency path.
function install(...args) {
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['--no-install', 'playwright', 'install', ...args],
    { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Chromium installation failed (${result.status}).`);
}
async function probe() {
  const browser = await chromium.launch({ headless: true });
  await browser.close();
}

install('chromium');
try {
  await probe();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/Host system is missing dependencies|error while loading shared libraries|cannot open shared object file|Missing libraries:/i.test(message)) throw error;
  console.error(message);
  console.log('Installing the missing Chromium system dependencies.');
  install('--with-deps', 'chromium');
  await probe();
}
console.log('Locked Chromium launch verified; run all browser acceptance tests.');