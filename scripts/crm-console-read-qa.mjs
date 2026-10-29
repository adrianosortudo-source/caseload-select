import { chromium } from '@playwright/test';
import { createDiagnostic } from './crm-qa-diagnostics.mjs';
const diagnostic = createDiagnostic();

const origin = 'https://admin.caseloadselect.ca';
const audience = 'caseload-crm-console-read/v1';
const exchange = '/api/operator/crm-agent-session';
const assert = value => { if (!value) throw Error('qa_failed'); };

async function exchangeOidc(context) {
  diagnostic.phase('oidc_request');
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  assert(url.protocol === 'https:' && url.hostname.endsWith('.actions.githubusercontent.com'));
  url.searchParams.set('audience', audience);
  const result = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  diagnostic.status(result.status);
  assert(result.ok);
  diagnostic.phase('oidc_response');
  const { value } = await result.json();
  assert(typeof value === 'string' && value.length <= 16_384);
  // APIRequestContext belongs to this browser context: Set-Cookie goes into
  // the browser's own cookie jar. No storage state or credentials are exported.
  diagnostic.phase('session_exchange');
  const response = await context.request.post(`${origin}${exchange}`, {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { token: value }, maxRedirects: 0, timeout: 15_000,
  });
  diagnostic.status(response.status());
  assert(response.status() === 200);
  await response.dispose();
}

async function render(page) {
  let failedReadStatus;
  const checkResponse = response => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith('/api/') && response.status() >= 400) failedReadStatus ??= response.status();
  };
  page.on('response', checkResponse);
  try {
    for (const [path, title] of [
      ['/admin/agency-crm', 'Agency CRM'],
      ['/admin/agency-crm/follow-up', 'Follow-up'],
    ]) {
      diagnostic.phase(path.endsWith('follow-up') ? 'render_followup' : 'render_crm');
      const response = await page.goto(`${origin}${path}`, { waitUntil: 'networkidle', timeout: 45_000 });
      diagnostic.status(response?.status());
      assert(response?.status() === 200 && page.url() === `${origin}${path}`);
      assert(await page.getByRole('heading', { name: new RegExp(title, 'i') }).first().isVisible());
    }
    diagnostic.renderFailure(failedReadStatus);
    assert(failedReadStatus === undefined);
  } catch (error) {
    diagnostic.renderFailure(failedReadStatus);
    throw error;
  } finally {
    page.off('response', checkResponse);
  }
}

async function inspectReads(context) {
  for (const [path, phase] of [['/api/admin/agency-crm/deals', 'read_deals'], ['/api/admin/agency-crm/reminders', 'read_reminders'],
    ['/api/admin/agency-crm/follow-up', 'read_followup'], ['/api/admin/prospect-operations/report', 'read_report']]) {
    diagnostic.phase(phase);
    const response = await context.request.get(origin + path, { maxRedirects: 0 });
    diagnostic.status(response.status());
    assert(response.status() === 200); await response.dispose();
  }
  diagnostic.phase('read_prospects');
  const response = await context.request.get(origin + '/api/admin/agency-crm/prospects?limit=1', { maxRedirects: 0 });
  diagnostic.status(response.status());
  assert(response.status() === 200);
  const page = await response.json(); await response.dispose();
  const id = page.items?.[0]?.id;
  if (id !== undefined) {
    assert(typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id));
    for (const path of [`/api/admin/agency-crm/follow-up/opt-in?prospectId=${id}`,
      `/api/admin/prospect-operations/conversations/agency/${id}`]) {
      diagnostic.phase(path.includes('/conversations/') ? 'read_conversation' : 'read_opt_in');
      const result = await context.request.get(origin + path, { maxRedirects: 0 });
      diagnostic.status(result.status());
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
  diagnostic.phase('browser');
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
  diagnostic.phase('renew_wait');
  await new Promise(resolve => setTimeout(resolve, 10 * 60_000 + 1000));
  diagnostic.round('renewal');
  await exchangeOidc(context);
  await render(page);
  await inspectReads(context);
  diagnostic.phase('close');
  await context.close();
  console.log('CRM_QA_PASS');
} catch {
  console.log(diagnostic.failure());
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}
