import { chromium } from '@playwright/test';

const origin = 'https://admin.caseloadselect.ca';
const audience = 'caseload-crm-console-read/v1';
const exchange = '/api/operator/crm-agent-session';
const assert = value => { if (!value) throw Error('qa_failed'); };

async function exchangeOidc(context) {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  assert(url.protocol === 'https:' && url.hostname.endsWith('.actions.githubusercontent.com'));
  url.searchParams.set('audience', audience);
  const result = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  assert(result.ok);
  const { value } = await result.json();
  assert(typeof value === 'string' && value.length <= 16_384);
  // APIRequestContext belongs to this browser context: Set-Cookie goes into
  // the browser's own cookie jar. No storage state or credentials are exported.
  const response = await context.request.post(`${origin}${exchange}`, {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { token: value }, maxRedirects: 0, timeout: 15_000,
  });
  assert(response.status() === 200);
  await response.dispose();
}

async function render(page) {
  let failedRead = false;
  const checkResponse = response => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith('/api/') && response.status() >= 400) failedRead = true;
  };
  page.on('response', checkResponse);
  for (const [path, title] of [
    ['/admin/agency-crm', 'Agency CRM'],
    ['/admin/agency-crm/follow-up', 'Follow-up'],
  ]) {
    const response = await page.goto(`${origin}${path}`, { waitUntil: 'networkidle', timeout: 45_000 });
    assert(response?.status() === 200 && page.url() === `${origin}${path}`);
    assert(await page.getByRole('heading', { name: new RegExp(title, 'i') }).first().isVisible());
  }
  page.off('response', checkResponse);
  assert(!failedRead);
}

async function inspectReads(context) {
  for (const path of ['/api/admin/agency-crm/deals', '/api/admin/agency-crm/reminders',
    '/api/admin/agency-crm/follow-up', '/api/admin/prospect-operations/report']) {
    const response = await context.request.get(origin + path, { maxRedirects: 0 });
    assert(response.status() === 200); await response.dispose();
  }
  const response = await context.request.get(origin + '/api/admin/agency-crm/prospects?limit=1', { maxRedirects: 0 });
  assert(response.status() === 200);
  const page = await response.json(); await response.dispose();
  const id = page.items?.[0]?.id;
  if (id !== undefined) {
    assert(typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id));
    for (const path of [`/api/admin/agency-crm/follow-up/opt-in?prospectId=${id}`,
      `/api/admin/prospect-operations/conversations/agency/${id}`]) {
      const result = await context.request.get(origin + path, { maxRedirects: 0 });
      // A prospect may have no conversation yet; an auth denial is always a failure.
      assert(result.status() === 200 || (path.includes('/conversations/') && result.status() === 404));
      await result.dispose();
    }
  }
}

let browser;
try {
  assert(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY_ID === '1206232496' &&
    process.env.GITHUB_REPOSITORY === 'adrianosortudo-source/caseload-select' &&
    process.env.GITHUB_REF === 'refs/heads/main' && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch');
  browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
  await context.route('**/*', route => {
    const req = route.request(); const url = new URL(req.url());
    return url.origin === origin && ['GET', 'HEAD'].includes(req.method())
      ? route.continue() : route.abort();
  });
  await exchangeOidc(context);
  const page = await context.newPage();
  await render(page);
  await inspectReads(context);
  // Exercise one real renewal after the ten-minute minimum, inside the job cap.
  await new Promise(resolve => setTimeout(resolve, 10 * 60_000 + 1000));
  await exchangeOidc(context);
  await render(page);
  await inspectReads(context);
  await context.close();
  console.log('CRM_QA_PASS');
} catch {
  console.log('CRM_QA_FAIL');
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}
