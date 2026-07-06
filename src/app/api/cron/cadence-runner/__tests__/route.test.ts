/**
 * Tests for GET /api/cron/cadence-runner + the shadow runner it drives.
 *
 * Covers: auth gate; pre-migration no-op (undefined cadence tables); enrollment
 * off a stage event; advance with consent allowed (shadow_logged) and blocked
 * (suppressed); run completion at the last step. The Supabase mock is a
 * chainable builder configured per table via module-level state.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

// Every test dynamically imports ../route and @/lib/cadence-runner (so each
// gets a fresh module against the per-test mock state). That first cold
// import pulls the whole cadence chain (runner -> dispatch -> comms-gate ->
// supabase-admin) through vitest's transform, which under a saturated box
// (parallel test files + a running dev server) can exceed the default 5s
// test budget on whichever test happens to trigger it first, timing out a
// trivial assertion. Warm both modules once here, outside any per-test
// budget, so the module cache is hot before the assertions run; keep a
// generous file timeout as a load-spike safety margin. This targets the
// cold-import cost, not test logic.
// hookTimeout also needs raising (2026-07-06): vitest's default hookTimeout
// is 10s, separate from testTimeout, and the beforeAll warm-up itself is what
// pays the cold-import cost. Under a heavily saturated box (~100 concurrent
// node processes from parallel sessions observed live) the warm-up alone can
// exceed that default, failing the whole file with "Hook timed out in
// 10000ms" even though every individual test is fast once the module cache
// is hot (confirmed: 20/20 pass in under 4s when run standalone off a quiet
// box). Same fix shape as the testTimeout raise above, applied to the actual
// hook that does the slow work.
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });
beforeAll(async () => {
  await import('../route');
  await import('@/lib/cadence-runner');
});

vi.mock('server-only', () => ({}));

let cronAuthed = true;
vi.mock('@/lib/cron-auth', () => ({ isCronAuthorized: () => cronAuthed }));

// Per-table configured results and capture buffers.
interface TableState {
  select?: { data: unknown; error: unknown };
  maybeSingle?: { data: unknown; error: unknown };
  upsertResult?: { data: unknown; error: unknown };
}
const state: {
  tables: Record<string, TableState>;
  outboundUpserts: Record<string, unknown>[][];
  runUpdates: Array<{ patch: Record<string, unknown>; id: string }>;
  selects: Array<{ table: string; cols: string }>;
} = { tables: {}, outboundUpserts: [], runUpdates: [], selects: [] };

function builder(table: string) {
  const b: Record<string, unknown> = {};
  let didUpsert = false;
  let isRunUpdate = false;
  let pendingUpdatePatch: Record<string, unknown> | null = null;

  const chain = () => b;
  b.select = (cols?: string) => {
    if (typeof cols === 'string') state.selects.push({ table, cols });
    return b;
  };
  b.eq = (col: string, val: unknown) => {
    if (isRunUpdate && col === 'id' && pendingUpdatePatch) {
      state.runUpdates.push({ patch: pendingUpdatePatch, id: String(val) });
      return Promise.resolve({ data: null, error: null });
    }
    return b;
  };
  b.in = chain;
  b.order = chain;
  b.limit = chain;
  b.update = (patch: Record<string, unknown>) => {
    if (table === 'cadence_runs') { isRunUpdate = true; pendingUpdatePatch = patch; }
    return b;
  };
  b.upsert = (rows: Record<string, unknown>[]) => {
    didUpsert = true;
    if (table === 'outbound_messages') state.outboundUpserts.push(rows);
    return b;
  };
  b.maybeSingle = () => Promise.resolve(state.tables[table]?.maybeSingle ?? { data: null, error: null });
  b.then = (resolve: (v: unknown) => unknown) => {
    if (didUpsert) {
      return Promise.resolve(state.tables[table]?.upsertResult ?? { data: [], error: null }).then(resolve);
    }
    return Promise.resolve(state.tables[table]?.select ?? { data: [], error: null }).then(resolve);
  };
  return b;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

function makeRequest(url = 'http://localhost/api/cron/cadence-runner'): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

const NOW = new Date('2026-07-10T00:00:00.000Z');

const J9_RULE = {
  id: 'rule-j9', firm_id: null, cadence_key: 'J9', name: 'Google Review Request',
  trigger_type: 'field_change', trigger_config: { cadence_trigger: 'review_request' },
  channel: 'email', enabled: true,
};
const J9_STEPS = [
  { id: 's1', cadence_rule_id: 'rule-j9', step_number: 1, delay_hours: 0, channel: 'email', subject_template: 'Thank you from {firm_name}', body_template: 'Hi {first_name}, thanks re {matter_type}.', active: true },
  { id: 's2', cadence_rule_id: 'rule-j9', step_number: 2, delay_hours: 72, channel: 'email', subject_template: 'A quick favour', body_template: 'Hi {first_name}, a review?', active: true },
  { id: 's3', cadence_rule_id: 'rule-j9', step_number: 3, delay_hours: 168, channel: 'email', subject_template: 'Last note', body_template: 'Hi {first_name}, final note.', active: true },
];

function resetState() {
  state.tables = {};
  state.outboundUpserts = [];
  state.runUpdates = [];
  state.selects = [];
}

describe('GET /api/cron/cadence-runner', () => {
  beforeEach(() => {
    cronAuthed = true;
    resetState();
  });

  it('returns 401 without cron auth', async () => {
    cronAuthed = false;
    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('no-ops when the cadence tables do not exist yet (pre-migration)', async () => {
    state.tables['cadence_rules'] = { select: { data: null, error: { code: '42P01', message: 'relation "cadence_rules" does not exist' } } };
    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.applied).toBe(false);
    expect(body.reason).toMatch(/not applied/);
  });
});

describe('runCadenceEngine (via the route)', () => {
  beforeEach(() => {
    cronAuthed = true;
    resetState();
    state.tables['cadence_rules'] = { select: { data: [J9_RULE], error: null } };
    state.tables['cadence_steps'] = { select: { data: J9_STEPS, error: null } };
    // No events by default (empty enroll pass).
    state.tables['matter_stage_events'] = { select: { data: [], error: null } };
    state.tables['intake_firms'] = { select: { data: [{ id: 'firm-1', name: 'DRG Law Professional Corporation' }], error: null } };
  });

  it('enrolls a matter when a stage event maps to a cadence trigger', async () => {
    state.tables['matter_stage_events'] = { select: { data: [
      { matter_id: 'matter-1', firm_id: 'firm-1', from_stage: 'active', to_stage: 'closing', created_at: '2026-07-01T00:00:00.000Z' },
    ], error: null } };
    state.tables['client_matters'] = { select: { data: [
      { id: 'matter-1', firm_id: 'firm-1', matter_stage: 'closing', primary_name: 'Ana Santos', primary_email: 'ana@example.com', matter_type: 'will_drafting', source_screened_lead_id: 'lead-1' },
    ], error: null } };
    // No active runs to advance.
    state.tables['cadence_runs'] = { upsertResult: { data: [{ id: 'run-new' }], error: null }, select: { data: [], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });
    expect(summary.applied).toBe(true);
    expect(summary.enrolled).toBe(1);
  });

  it('logs a shadow row with consent allowed when the lead has explicit email consent', async () => {
    state.tables['cadence_runs'] = { select: { data: [
      { id: 'run-1', firm_id: 'firm-1', cadence_rule_id: 'rule-j9', cadence_key: 'J9', matter_id: 'matter-1', screened_lead_id: 'lead-1', anchor_at: '2026-07-01T00:00:00.000Z', status: 'active', next_step_number: 1 },
    ], error: null }, upsertResult: { data: [], error: null } };
    state.tables['client_matters'] = { maybeSingle: { data: { id: 'matter-1', firm_id: 'firm-1', matter_stage: 'closing', primary_name: 'Ana Santos', primary_email: 'ana@example.com', matter_type: 'will_drafting', source_screened_lead_id: 'lead-1' }, error: null } };
    state.tables['screened_leads'] = { select: { data: [
      { id: 'lead-1', contact_email: 'ana@example.com', email_consent_status: 'explicit', sms_consent_status: 'unknown', six_month_expiry_date: null },
    ], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.runs_advanced).toBe(1);
    // NOW is 2026-07-10; anchor 2026-07-01. Steps at 0h/72h/168h are all past → 3 due.
    expect(summary.shadow_logged).toBe(3);
    expect(summary.suppressed).toBe(0);
    expect(summary.completed).toBe(1);

    const logged = state.outboundUpserts.flat();
    expect(logged).toHaveLength(3);
    expect(logged.every((r) => r.shadow === true)).toBe(true);
    expect(logged.every((r) => r.consent_verdict === 'allowed')).toBe(true);
    expect(logged.every((r) => r.status === 'shadow_logged')).toBe(true);
    // Interpolation resolved against the matter + cleaned firm name.
    expect(logged[0].subject).toBe('Thank you from DRG Law');
    expect(logged[0].body).toContain('Ana');
    expect(logged[0].body).toContain('will drafting');
    // The run advanced to completion (past the last step).
    const update = state.runUpdates.find((u) => u.id === 'run-1');
    expect(update?.patch.status).toBe('completed');
  });

  it('suppresses (does not allow) a shadow row when consent is not granted', async () => {
    state.tables['cadence_runs'] = { select: { data: [
      { id: 'run-2', firm_id: 'firm-1', cadence_rule_id: 'rule-j9', cadence_key: 'J9', matter_id: 'matter-2', screened_lead_id: 'lead-2', anchor_at: '2026-07-01T00:00:00.000Z', status: 'active', next_step_number: 1 },
    ], error: null }, upsertResult: { data: [], error: null } };
    state.tables['client_matters'] = { maybeSingle: { data: { id: 'matter-2', firm_id: 'firm-1', matter_stage: 'closing', primary_name: 'Bob Lee', primary_email: 'bob@example.com', matter_type: 'probate', source_screened_lead_id: 'lead-2' }, error: null } };
    state.tables['screened_leads'] = { select: { data: [
      { id: 'lead-2', contact_email: 'bob@example.com', email_consent_status: 'unknown', sms_consent_status: 'unknown', six_month_expiry_date: null },
    ], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.shadow_logged).toBe(0);
    expect(summary.suppressed).toBe(3);
    const logged = state.outboundUpserts.flat();
    expect(logged.every((r) => r.consent_verdict === 'blocked')).toBe(true);
    expect(logged.every((r) => r.status === 'suppressed')).toBe(true);
    expect(logged[0].consent_block_reason).toBeTruthy();
    // Still dispatches nothing: shadow stays true even when suppressed.
    expect(logged.every((r) => r.shadow === true)).toBe(true);
  });

  it('does not advance a run whose next step is still in the future', async () => {
    state.tables['cadence_runs'] = { select: { data: [
      { id: 'run-3', firm_id: 'firm-1', cadence_rule_id: 'rule-j9', cadence_key: 'J9', matter_id: 'matter-3', screened_lead_id: 'lead-3', anchor_at: '2026-07-09T23:00:00.000Z', status: 'active', next_step_number: 2 },
    ], error: null } };
    state.tables['client_matters'] = { maybeSingle: { data: { id: 'matter-3', firm_id: 'firm-1', matter_stage: 'closing', primary_name: 'Cy', primary_email: 'cy@example.com', matter_type: 'probate', source_screened_lead_id: 'lead-3' }, error: null } };
    state.tables['screened_leads'] = { select: { data: [{ id: 'lead-3', contact_email: 'cy@example.com', email_consent_status: 'explicit', sms_consent_status: 'unknown', six_month_expiry_date: null }], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });
    // Step 2 fires at anchor + 72h = 2026-07-12 23:00, after NOW (2026-07-10) → nothing due.
    expect(summary.runs_advanced).toBe(0);
    expect(state.outboundUpserts.flat()).toHaveLength(0);
  });
});

describe('WP-1 extensions: fan-out, lead-status enrollment, exit conditions', () => {
  beforeEach(() => {
    cronAuthed = true;
    resetState();
  });

  it('fans out a single stage event to every cadence sharing its trigger (J7 + J8 both fire on client_won)', async () => {
    const J7_RULE = { id: 'rule-j7', firm_id: null, cadence_key: 'J7', name: 'Welcome', trigger_type: 'field_change', trigger_config: { cadence_trigger: 'client_won' }, channel: 'email', enabled: true };
    const J8_RULE = { id: 'rule-j8', firm_id: null, cadence_key: 'J8', name: 'Active Matter Update', trigger_type: 'field_change', trigger_config: { cadence_trigger: 'client_won' }, channel: 'email', enabled: true };
    state.tables['cadence_rules'] = { select: { data: [J7_RULE, J8_RULE], error: null } };
    state.tables['cadence_steps'] = { select: { data: [
      { id: 's-j7-1', cadence_rule_id: 'rule-j7', step_number: 1, delay_hours: 0, channel: 'email', subject_template: 'a', body_template: 'a', active: true },
      { id: 's-j8-1', cadence_rule_id: 'rule-j8', step_number: 1, delay_hours: 0, channel: 'email', subject_template: 'b', body_template: 'b', active: true },
    ], error: null } };
    state.tables['matter_stage_events'] = { select: { data: [
      { matter_id: 'matter-1', firm_id: 'firm-1', from_stage: 'retainer_pending', to_stage: 'active', created_at: '2026-07-01T00:00:00.000Z' },
    ], error: null } };
    state.tables['client_matters'] = { select: { data: [
      { id: 'matter-1', firm_id: 'firm-1', matter_stage: 'active', primary_name: 'Ana', primary_email: 'ana@example.com', matter_type: 'will_drafting', source_screened_lead_id: 'lead-1' },
    ], error: null } };
    // Both enroll rows land in one upsert call: report 2 inserted, no active runs to advance.
    state.tables['cadence_runs'] = { upsertResult: { data: [{ id: 'run-j7' }, { id: 'run-j8' }], error: null }, select: { data: [], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });
    expect(summary.enrolled).toBe(2);
  });

  it('enrolls a lead-only run off a screened_leads status flip (J10 re-engagement, no matter exists)', async () => {
    const J10_RULE = { id: 'rule-j10', firm_id: null, cadence_key: 'J10', name: 'Re-Engagement', trigger_type: 'field_change', trigger_config: { cadence_trigger: 're_engagement', source: 'screened_leads_status', status: 'passed' }, channel: 'email', enabled: true };
    state.tables['cadence_rules'] = { select: { data: [J10_RULE], error: null } };
    state.tables['cadence_steps'] = { select: { data: [
      { id: 's-j10-1', cadence_rule_id: 'rule-j10', step_number: 1, delay_hours: 2160, channel: 'email', subject_template: 'a', body_template: 'a', active: true },
    ], error: null } };
    state.tables['matter_stage_events'] = { select: { data: [], error: null } };
    state.tables['screened_leads'] = {
      select: { data: [{ id: 'lead-9', firm_id: 'firm-1', status: 'passed', contact_email: 'p@example.com', contact_name: 'Passed Lead', matter_type: 'probate', email_consent_status: 'implied', sms_consent_status: 'unknown', six_month_expiry_date: null, updated_at: '2026-06-01T00:00:00.000Z' }], error: null },
    };
    state.tables['cadence_runs'] = { upsertResult: { data: [{ id: 'run-j10' }], error: null }, select: { data: [], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });
    expect(summary.enrolled).toBe(1);
  });

  it('exits a run once the matter stage has advanced past the rule exit whitelist (J6 exits after the retainer is signed)', async () => {
    const J6_RULE = { id: 'rule-j6', firm_id: null, cadence_key: 'J6', name: 'Retainer Awaiting', trigger_type: 'field_change', trigger_config: { cadence_trigger: 'retainer_awaiting' }, exit_config: { matter_stage_not_in: ['retainer_pending'] }, channel: 'email', enabled: true };
    state.tables['cadence_rules'] = { select: { data: [J6_RULE], error: null } };
    state.tables['cadence_steps'] = { select: { data: [
      { id: 's-j6-1', cadence_rule_id: 'rule-j6', step_number: 1, delay_hours: 0, channel: 'email', subject_template: 'a', body_template: 'a', active: true },
      { id: 's-j6-2', cadence_rule_id: 'rule-j6', step_number: 2, delay_hours: 48, channel: 'email', subject_template: 'b', body_template: 'b', active: true },
    ], error: null } };
    state.tables['matter_stage_events'] = { select: { data: [], error: null } };
    state.tables['cadence_runs'] = { select: { data: [
      { id: 'run-exit', firm_id: 'firm-1', cadence_rule_id: 'rule-j6', cadence_key: 'J6', matter_id: 'matter-exit', screened_lead_id: 'lead-exit', anchor_at: '2026-07-01T00:00:00.000Z', status: 'active', next_step_number: 1 },
    ], error: null } };
    // The retainer got signed: the matter has already moved past retainer_pending.
    state.tables['client_matters'] = { maybeSingle: { data: { id: 'matter-exit', firm_id: 'firm-1', matter_stage: 'active', primary_name: 'Signed Client', primary_email: 's@example.com', matter_type: 'probate', source_screened_lead_id: 'lead-exit' }, error: null } };
    state.tables['screened_leads'] = { select: { data: [{ id: 'lead-exit', contact_email: 's@example.com', email_consent_status: 'explicit', sms_consent_status: 'unknown', six_month_expiry_date: null }], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.exited).toBe(1);
    expect(summary.runs_advanced).toBe(0);
    expect(state.outboundUpserts.flat()).toHaveLength(0);

    const update = state.runUpdates.find((u) => u.id === 'run-exit');
    expect(update?.patch.status).toBe('exited');
    expect(update?.patch.exit_reason).toMatch(/retainer_pending/);
  });

  it('selects exit_config in the rule-library query (audit regression pin: omitting it made J6 exits impossible)', async () => {
    state.tables['cadence_rules'] = { select: { data: [], error: null } };
    state.tables['cadence_steps'] = { select: { data: [], error: null } };
    state.tables['matter_stage_events'] = { select: { data: [], error: null } };
    state.tables['cadence_runs'] = { select: { data: [], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    await runCadenceEngine({ now: NOW });

    const ruleSelect = state.selects.find((s) => s.table === 'cadence_rules');
    expect(ruleSelect).toBeDefined();
    expect(ruleSelect!.cols).toContain('exit_config');
  });

  it('does not enroll a firm override whose own trigger does not match the event (audit fix)', async () => {
    // Global J6 fires on retainer_awaiting; the firm override moved J6 to
    // client_won. An intake -> retainer_pending event matches the global,
    // but the resolved (override) rule must NOT be enrolled.
    const GLOBAL_J6 = { id: 'rule-j6-global', firm_id: null, cadence_key: 'J6', name: 'Retainer Awaiting', trigger_type: 'field_change', trigger_config: { cadence_trigger: 'retainer_awaiting' }, channel: 'email', enabled: true };
    const FIRM_J6 = { id: 'rule-j6-firm', firm_id: 'firm-1', cadence_key: 'J6', name: 'Retainer Awaiting (custom)', trigger_type: 'field_change', trigger_config: { cadence_trigger: 'client_won' }, channel: 'email', enabled: true };
    state.tables['cadence_rules'] = { select: { data: [GLOBAL_J6, FIRM_J6], error: null } };
    state.tables['cadence_steps'] = { select: { data: [], error: null } };
    state.tables['matter_stage_events'] = { select: { data: [
      { matter_id: 'matter-1', firm_id: 'firm-1', from_stage: 'intake', to_stage: 'retainer_pending', created_at: '2026-07-01T00:00:00.000Z' },
    ], error: null } };
    state.tables['client_matters'] = { select: { data: [
      { id: 'matter-1', firm_id: 'firm-1', matter_stage: 'retainer_pending', primary_name: 'Ana', primary_email: 'a@example.com', matter_type: 'probate', source_screened_lead_id: 'lead-1' },
    ], error: null } };
    state.tables['cadence_runs'] = { upsertResult: { data: [], error: null }, select: { data: [], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });
    expect(summary.enrolled).toBe(0);
  });

  it('does not advance a run when the shadow ledger write fails (audit fix)', async () => {
    const J9_LOCAL = { id: 'rule-j9', firm_id: null, cadence_key: 'J9', name: 'Review', trigger_type: 'field_change', trigger_config: { cadence_trigger: 'review_request' }, channel: 'email', enabled: true };
    state.tables['cadence_rules'] = { select: { data: [J9_LOCAL], error: null } };
    state.tables['cadence_steps'] = { select: { data: [
      { id: 's1', cadence_rule_id: 'rule-j9', step_number: 1, delay_hours: 0, channel: 'email', subject_template: 'a', body_template: 'a', active: true },
    ], error: null } };
    state.tables['matter_stage_events'] = { select: { data: [], error: null } };
    state.tables['cadence_runs'] = { select: { data: [
      { id: 'run-fail', firm_id: 'firm-1', cadence_rule_id: 'rule-j9', cadence_key: 'J9', matter_id: 'matter-f', screened_lead_id: 'lead-f', anchor_at: '2026-07-01T00:00:00.000Z', status: 'active', next_step_number: 1 },
    ], error: null } };
    state.tables['client_matters'] = { maybeSingle: { data: { id: 'matter-f', firm_id: 'firm-1', matter_stage: 'closing', primary_name: 'F', primary_email: 'f@example.com', matter_type: 'probate', source_screened_lead_id: 'lead-f' }, error: null } };
    state.tables['screened_leads'] = { select: { data: [{ id: 'lead-f', contact_email: 'f@example.com', email_consent_status: 'explicit', sms_consent_status: 'unknown', six_month_expiry_date: null }], error: null } };
    // The outbound_messages upsert fails.
    state.tables['outbound_messages'] = { upsertResult: { data: null, error: { message: 'boom' } } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.ok).toBe(false);
    expect(summary.shadow_logged).toBe(0);
    // The run was NOT advanced: no cadence_runs update landed for it.
    expect(state.runUpdates.find((u) => u.id === 'run-fail')).toBeUndefined();
  });

  it('does not exit a run still within its exit whitelist stage', async () => {
    const J6_RULE = { id: 'rule-j6', firm_id: null, cadence_key: 'J6', name: 'Retainer Awaiting', trigger_type: 'field_change', trigger_config: { cadence_trigger: 'retainer_awaiting' }, exit_config: { matter_stage_not_in: ['retainer_pending'] }, channel: 'email', enabled: true };
    state.tables['cadence_rules'] = { select: { data: [J6_RULE], error: null } };
    state.tables['cadence_steps'] = { select: { data: [
      { id: 's-j6-1', cadence_rule_id: 'rule-j6', step_number: 1, delay_hours: 0, channel: 'email', subject_template: 'a', body_template: 'a', active: true },
    ], error: null } };
    state.tables['matter_stage_events'] = { select: { data: [], error: null } };
    state.tables['cadence_runs'] = { select: { data: [
      { id: 'run-live', firm_id: 'firm-1', cadence_rule_id: 'rule-j6', cadence_key: 'J6', matter_id: 'matter-live', screened_lead_id: 'lead-live', anchor_at: '2026-07-09T00:00:00.000Z', status: 'active', next_step_number: 1 },
    ], error: null }, upsertResult: { data: [], error: null } };
    state.tables['client_matters'] = { maybeSingle: { data: { id: 'matter-live', firm_id: 'firm-1', matter_stage: 'retainer_pending', primary_name: 'Waiting Client', primary_email: 'w@example.com', matter_type: 'probate', source_screened_lead_id: 'lead-live' }, error: null } };
    state.tables['screened_leads'] = { select: { data: [{ id: 'lead-live', contact_email: 'w@example.com', email_consent_status: 'explicit', sms_consent_status: 'unknown', six_month_expiry_date: null }], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.exited).toBe(0);
    expect(summary.runs_advanced).toBe(1);
    expect(summary.shadow_logged).toBe(1);
  });
});

describe('read-side error handling (audit fix 2026-07-06): a failed read must not read as empty', () => {
  beforeEach(() => {
    cronAuthed = true;
    resetState();
    state.tables['cadence_rules'] = { select: { data: [J9_RULE], error: null } };
    state.tables['cadence_steps'] = { select: { data: J9_STEPS, error: null } };
    state.tables['matter_stage_events'] = { select: { data: [], error: null } };
    state.tables['intake_firms'] = { select: { data: [{ id: 'firm-1', name: 'DRG Law Professional Corporation' }], error: null } };
  });

  it('fails closed when the stage-events scan errors (read #1: gates the whole tick)', async () => {
    state.tables['matter_stage_events'] = { select: { data: null, error: { message: 'boom-events' } } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.ok).toBe(false);
    expect(summary.reason).toMatch(/stage events/);
    expect(summary.enrolled).toBe(0);
    expect(state.runUpdates).toHaveLength(0);
    expect(state.outboundUpserts.flat()).toHaveLength(0);
  });

  it('fails closed when the enrollment matter batch lookup errors (read #2)', async () => {
    state.tables['matter_stage_events'] = { select: { data: [
      { matter_id: 'matter-1', firm_id: 'firm-1', from_stage: 'active', to_stage: 'closing', created_at: '2026-07-01T00:00:00.000Z' },
    ], error: null } };
    state.tables['client_matters'] = { select: { data: null, error: { message: 'boom-matter-batch' } } };
    state.tables['cadence_runs'] = { upsertResult: { data: [], error: null }, select: { data: [], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.ok).toBe(false);
    expect(summary.reason).toMatch(/matter lookup/);
    // The enrollment pass was skipped entirely: no cadence_runs upsert row landed.
    expect(summary.enrolled).toBe(0);
  });

  it('fails closed when the lead-status enrollment read errors (read #3: J10-style lead-sourced rules)', async () => {
    const J10_RULE = { id: 'rule-j10', firm_id: null, cadence_key: 'J10', name: 'Re-Engagement', trigger_type: 'field_change', trigger_config: { cadence_trigger: 're_engagement', source: 'screened_leads_status', status: 'passed' }, channel: 'email', enabled: true };
    state.tables['cadence_rules'] = { select: { data: [J10_RULE], error: null } };
    state.tables['cadence_steps'] = { select: { data: [
      { id: 's-j10-1', cadence_rule_id: 'rule-j10', step_number: 1, delay_hours: 2160, channel: 'email', subject_template: 'a', body_template: 'a', active: true },
    ], error: null } };
    state.tables['screened_leads'] = { select: { data: null, error: { message: 'boom-lead-status' } } };
    state.tables['cadence_runs'] = { upsertResult: { data: [], error: null }, select: { data: [], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.ok).toBe(false);
    expect(summary.reason).toMatch(/lead-status enrollment/);
    expect(summary.enrolled).toBe(0);
    expect(state.runUpdates).toHaveLength(0);
  });

  it('fails closed when the active-runs scan errors (read #4: gates the whole ADVANCE pass)', async () => {
    state.tables['cadence_runs'] = { select: { data: null, error: { message: 'boom-active-runs' } } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.ok).toBe(false);
    expect(summary.reason).toMatch(/active runs/);
    expect(summary.runs_advanced).toBe(0);
    expect(state.runUpdates).toHaveLength(0);
    expect(state.outboundUpserts.flat()).toHaveLength(0);
  });

  it('skips (does not advance) a run when its per-matter reload errors (read #5)', async () => {
    state.tables['cadence_runs'] = { select: { data: [
      { id: 'run-m5', firm_id: 'firm-1', cadence_rule_id: 'rule-j9', cadence_key: 'J9', matter_id: 'matter-m5', screened_lead_id: 'lead-m5', anchor_at: '2026-07-01T00:00:00.000Z', status: 'active', next_step_number: 1 },
    ], error: null } };
    state.tables['client_matters'] = { maybeSingle: { data: null, error: { message: 'boom-matter-reload' } } };
    state.tables['screened_leads'] = { select: { data: [
      { id: 'lead-m5', contact_email: 'm5@example.com', email_consent_status: 'explicit', sms_consent_status: 'unknown', six_month_expiry_date: null },
    ], error: null } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.ok).toBe(false);
    expect(summary.reason).toMatch(/matter reload/);
    expect(summary.runs_advanced).toBe(0);
    expect(state.runUpdates.find((u) => u.id === 'run-m5')).toBeUndefined();
    expect(state.outboundUpserts.flat()).toHaveLength(0);
  });

  it('skips (does not advance) every run when the lead batch load errors (read #6: fail-closed on consent)', async () => {
    state.tables['cadence_runs'] = { select: { data: [
      { id: 'run-m6', firm_id: 'firm-1', cadence_rule_id: 'rule-j9', cadence_key: 'J9', matter_id: 'matter-m6', screened_lead_id: 'lead-m6', anchor_at: '2026-07-01T00:00:00.000Z', status: 'active', next_step_number: 1 },
    ], error: null } };
    state.tables['client_matters'] = { maybeSingle: { data: { id: 'matter-m6', firm_id: 'firm-1', matter_stage: 'closing', primary_name: 'M6', primary_email: 'm6@example.com', matter_type: 'probate', source_screened_lead_id: 'lead-m6' }, error: null } };
    state.tables['screened_leads'] = { select: { data: null, error: { message: 'boom-lead-batch' } } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.ok).toBe(false);
    expect(summary.reason).toMatch(/lead batch load/);
    expect(summary.runs_advanced).toBe(0);
    expect(state.runUpdates.find((u) => u.id === 'run-m6')).toBeUndefined();
    expect(state.outboundUpserts.flat()).toHaveLength(0);
  });

  it('skips (does not advance) every run when the firm config load errors (read #7)', async () => {
    state.tables['cadence_runs'] = { select: { data: [
      { id: 'run-m7', firm_id: 'firm-1', cadence_rule_id: 'rule-j9', cadence_key: 'J9', matter_id: 'matter-m7', screened_lead_id: 'lead-m7', anchor_at: '2026-07-01T00:00:00.000Z', status: 'active', next_step_number: 1 },
    ], error: null } };
    state.tables['client_matters'] = { maybeSingle: { data: { id: 'matter-m7', firm_id: 'firm-1', matter_stage: 'closing', primary_name: 'M7', primary_email: 'm7@example.com', matter_type: 'probate', source_screened_lead_id: 'lead-m7' }, error: null } };
    state.tables['screened_leads'] = { select: { data: [
      { id: 'lead-m7', contact_email: 'm7@example.com', email_consent_status: 'explicit', sms_consent_status: 'unknown', six_month_expiry_date: null },
    ], error: null } };
    state.tables['intake_firms'] = { select: { data: null, error: { message: 'boom-firm-config' } } };

    const { runCadenceEngine } = await import('@/lib/cadence-runner');
    const summary = await runCadenceEngine({ now: NOW });

    expect(summary.ok).toBe(false);
    expect(summary.reason).toMatch(/firm config load/);
    expect(summary.runs_advanced).toBe(0);
    expect(state.runUpdates.find((u) => u.id === 'run-m7')).toBeUndefined();
    expect(state.outboundUpserts.flat()).toHaveLength(0);
  });
});
