/**
 * Tests for GET /api/cron/cadence-runner + the shadow runner it drives.
 *
 * Covers: auth gate; pre-migration no-op (undefined cadence tables); enrollment
 * off a stage event; advance with consent allowed (shadow_logged) and blocked
 * (suppressed); run completion at the last step. The Supabase mock is a
 * chainable builder configured per table via module-level state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

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
} = { tables: {}, outboundUpserts: [], runUpdates: [] };

function builder(table: string) {
  const b: Record<string, unknown> = {};
  let didUpsert = false;
  let isRunUpdate = false;
  let pendingUpdatePatch: Record<string, unknown> | null = null;

  const chain = () => b;
  b.select = chain;
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
