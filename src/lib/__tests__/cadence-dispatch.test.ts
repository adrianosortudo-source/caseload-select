/**
 * Tests for the dormant cadence real-send dispatch path (cadence-dispatch.ts).
 *
 * The whole point of this module is that it never actually sends anything in
 * this sprint: the global env gate (CADENCE_REAL_SEND_ENABLED) is never set in
 * Vercel. Most tests here therefore prove the gate itself, plus the internal
 * logic (cap, consent, missing recipient) exercised with the gate forced open
 * via a test-only env override, restored after each test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface TableState {
  select?: { data: unknown; count?: number; error?: unknown };
  maybeSingle?: { data: unknown; error?: unknown };
}
const state: { tables: Record<string, TableState>; updates: Array<{ table: string; patch: Record<string, unknown>; id: string }> } = {
  tables: {}, updates: [],
};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  let pendingUpdate: Record<string, unknown> | null = null;
  let wantsCount = false;

  b.select = (_cols: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count) wantsCount = true;
    return b;
  };
  b.update = (patch: Record<string, unknown>) => { pendingUpdate = patch; return b; };
  b.eq = (col: string, val: unknown) => {
    if (pendingUpdate && col === 'id') {
      state.updates.push({ table, patch: pendingUpdate, id: String(val) });
      return Promise.resolve({ data: null, error: null });
    }
    return b;
  };
  b.gte = () => b;
  b.limit = () => Promise.resolve(state.tables[table]?.select ?? { data: [], error: null });
  b.maybeSingle = () => Promise.resolve(state.tables[table]?.maybeSingle ?? { data: null, error: null });
  // A count query (.select(cols,{count:'exact',head:true}).eq(...).gte(...).eq(...)) has no
  // terminal call other than the last .eq(); make .eq() thenable when count mode is on and no
  // update is pending, resolving to the configured count.
  const originalEq = b.eq as (col: string, val: unknown) => unknown;
  b.eq = (col: string, val: unknown) => {
    const result = originalEq(col, val);
    if (wantsCount && !pendingUpdate) {
      return Object.assign(Promise.resolve({ count: state.tables[table]?.select?.count ?? 0, error: null }), { eq: b.eq, gte: b.gte });
    }
    return result;
  };
  return b;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

const sendEmailMock = vi.fn();
vi.mock('@/lib/email', () => ({ sendEmail: (...args: unknown[]) => sendEmailMock(...args) }));

const sendSmsMock = vi.fn();
vi.mock('@/lib/sms-dispatch', () => ({ sendSms: (...args: unknown[]) => sendSmsMock(...args) }));

import {
  isRealSendGloballyEnabled,
  isRealSendEnabledForFirm,
  exceedsDeliverabilityCap,
  dispatchScheduledCadenceMessages,
  MAX_SENDS_PER_SUBJECT_PER_DAY,
} from '@/lib/cadence-dispatch';

const ENV_KEY = 'CADENCE_REAL_SEND_ENABLED';
const ORIGINAL_ENV = process.env[ENV_KEY];

function resetState() {
  state.tables = {};
  state.updates = [];
  sendEmailMock.mockReset();
  sendSmsMock.mockReset();
}

describe('isRealSendGloballyEnabled', () => {
  afterEach(() => { if (ORIGINAL_ENV === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = ORIGINAL_ENV; });

  it('is false when the env var is unset (the shipped state)', () => {
    delete process.env[ENV_KEY];
    expect(isRealSendGloballyEnabled()).toBe(false);
  });
  it('is false for any value other than the literal string "true"', () => {
    process.env[ENV_KEY] = '1';
    expect(isRealSendGloballyEnabled()).toBe(false);
  });
  it('is true only when explicitly set to "true"', () => {
    process.env[ENV_KEY] = 'true';
    expect(isRealSendGloballyEnabled()).toBe(true);
  });
});

describe('isRealSendEnabledForFirm', () => {
  afterEach(() => { if (ORIGINAL_ENV === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = ORIGINAL_ENV; });

  it('requires both the firm flag and the global gate', () => {
    delete process.env[ENV_KEY];
    expect(isRealSendEnabledForFirm(true)).toBe(false);
    process.env[ENV_KEY] = 'true';
    expect(isRealSendEnabledForFirm(false)).toBe(false);
    expect(isRealSendEnabledForFirm(true)).toBe(true);
  });
});

describe('exceedsDeliverabilityCap', () => {
  it('caps at MAX_SENDS_PER_SUBJECT_PER_DAY', () => {
    expect(exceedsDeliverabilityCap(MAX_SENDS_PER_SUBJECT_PER_DAY - 1)).toBe(false);
    expect(exceedsDeliverabilityCap(MAX_SENDS_PER_SUBJECT_PER_DAY)).toBe(true);
    expect(exceedsDeliverabilityCap(MAX_SENDS_PER_SUBJECT_PER_DAY + 1)).toBe(true);
  });
});

describe('dispatchScheduledCadenceMessages', () => {
  beforeEach(() => { resetState(); delete process.env[ENV_KEY]; });
  afterEach(() => { if (ORIGINAL_ENV === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = ORIGINAL_ENV; });

  it('short-circuits with attempted:false when the global gate is closed (the shipped state)', async () => {
    const summary = await dispatchScheduledCadenceMessages();
    expect(summary.attempted).toBe(false);
    expect(summary.sent).toBe(0);
    // No table touched at all: prove the gate is checked before any query.
    expect(Object.keys(state.tables)).toHaveLength(0);
  });

  it('sends an eligible, consented, under-cap message when the gate is force-opened for the test', async () => {
    process.env[ENV_KEY] = 'true';
    state.tables['outbound_messages'] = {
      select: { data: [{ id: 'om-1', firm_id: 'firm-1', matter_id: 'matter-1', screened_lead_id: 'lead-1', channel: 'email', recipient_email: 'a@example.com', subject: 's', body: 'b' }], error: null, count: 0 },
    };
    state.tables['screened_leads'] = {
      maybeSingle: { data: { id: 'lead-1', email_consent_status: 'explicit', sms_consent_status: 'unknown', six_month_expiry_date: null }, error: null },
    };
    sendEmailMock.mockResolvedValue({ skipped: false, id: 'resend-1' });

    const summary = await dispatchScheduledCadenceMessages();
    expect(summary.attempted).toBe(true);
    expect(summary.sent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledWith('a@example.com', 's', 'b');
    const update = state.updates.find((u) => u.id === 'om-1');
    expect(update?.patch.status).toBe('sent');
  });

  it('defers (leaves scheduled) a message when the rolling deliverability cap is hit, so a later tick retries', async () => {
    process.env[ENV_KEY] = 'true';
    state.tables['outbound_messages'] = {
      select: { data: [{ id: 'om-2', firm_id: 'firm-1', matter_id: 'matter-2', screened_lead_id: 'lead-2', channel: 'email', recipient_email: 'b@example.com', subject: 's', body: 'b' }], error: null, count: MAX_SENDS_PER_SUBJECT_PER_DAY },
    };
    const summary = await dispatchScheduledCadenceMessages();
    expect(summary.capped).toBe(1);
    expect(summary.sent).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    // Audit fix: capped is a deferral, not a terminal failure. No status update.
    expect(state.updates.find((u) => u.id === 'om-2')).toBeUndefined();
  });

  it('terminal-fails a row with no screened_lead_id instead of reprocessing it every tick', async () => {
    process.env[ENV_KEY] = 'true';
    state.tables['outbound_messages'] = {
      select: { data: [{ id: 'om-8', firm_id: 'firm-1', matter_id: 'matter-8', screened_lead_id: null, channel: 'email', recipient_email: 'x@example.com', subject: 's', body: 'b' }], error: null, count: 0 },
    };
    const summary = await dispatchScheduledCadenceMessages();
    expect(summary.blocked).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.updates.find((u) => u.id === 'om-8')?.patch.status).toBe('failed');
  });

  it('blocks and marks failed when consent is not open at dispatch time', async () => {
    process.env[ENV_KEY] = 'true';
    state.tables['outbound_messages'] = {
      select: { data: [{ id: 'om-3', firm_id: 'firm-1', matter_id: null, screened_lead_id: 'lead-3', channel: 'email', recipient_email: 'c@example.com', subject: 's', body: 'b' }], error: null, count: 0 },
    };
    state.tables['screened_leads'] = {
      maybeSingle: { data: { id: 'lead-3', email_consent_status: 'declined', sms_consent_status: 'unknown', six_month_expiry_date: null }, error: null },
    };
    const summary = await dispatchScheduledCadenceMessages();
    expect(summary.blocked).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.updates.find((u) => u.id === 'om-3')?.patch.status).toBe('failed');
  });

  it('blocks without sending when the row has no recipient email', async () => {
    process.env[ENV_KEY] = 'true';
    state.tables['outbound_messages'] = {
      select: { data: [{ id: 'om-4', firm_id: 'firm-1', matter_id: null, screened_lead_id: 'lead-4', channel: 'email', recipient_email: null, subject: 's', body: 'b' }], error: null, count: 0 },
    };
    state.tables['screened_leads'] = {
      maybeSingle: { data: { id: 'lead-4', email_consent_status: 'explicit', sms_consent_status: 'unknown', six_month_expiry_date: null }, error: null },
    };
    const summary = await dispatchScheduledCadenceMessages();
    expect(summary.blocked).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('does nothing when there are no scheduled rows', async () => {
    process.env[ENV_KEY] = 'true';
    state.tables['outbound_messages'] = { select: { data: [], error: null } };
    const summary = await dispatchScheduledCadenceMessages();
    expect(summary.attempted).toBe(true);
    expect(summary.sent).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends via sendSms (not sendEmail) for a channel=sms row, using the lead phone and checking SMS consent', async () => {
    process.env[ENV_KEY] = 'true';
    state.tables['outbound_messages'] = {
      select: { data: [{ id: 'om-5', firm_id: 'firm-1', matter_id: null, screened_lead_id: 'lead-5', channel: 'sms', recipient_email: null, subject: null, body: 'Reminder text' }], error: null, count: 0 },
    };
    state.tables['screened_leads'] = {
      maybeSingle: { data: { id: 'lead-5', contact_phone: '+14165550000', email_consent_status: 'unknown', sms_consent_status: 'explicit', six_month_expiry_date: null }, error: null },
    };
    sendSmsMock.mockResolvedValue({ skipped: false, sid: 'SM1' });

    const summary = await dispatchScheduledCadenceMessages();
    expect(summary.sent).toBe(1);
    expect(sendSmsMock).toHaveBeenCalledWith('+14165550000', 'Reminder text');
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.updates.find((u) => u.id === 'om-5')?.patch.status).toBe('sent');
  });

  it('blocks an sms row when SMS consent is not explicit (email-only consent does not carry over)', async () => {
    process.env[ENV_KEY] = 'true';
    state.tables['outbound_messages'] = {
      select: { data: [{ id: 'om-6', firm_id: 'firm-1', matter_id: null, screened_lead_id: 'lead-6', channel: 'sms', recipient_email: null, subject: null, body: 'Reminder text' }], error: null, count: 0 },
    };
    state.tables['screened_leads'] = {
      maybeSingle: { data: { id: 'lead-6', contact_phone: '+14165550000', email_consent_status: 'explicit', sms_consent_status: 'unknown', six_month_expiry_date: null }, error: null },
    };
    const summary = await dispatchScheduledCadenceMessages();
    expect(summary.blocked).toBe(1);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('blocks an sms row with no phone on file rather than throwing', async () => {
    process.env[ENV_KEY] = 'true';
    state.tables['outbound_messages'] = {
      select: { data: [{ id: 'om-7', firm_id: 'firm-1', matter_id: null, screened_lead_id: 'lead-7', channel: 'sms', recipient_email: null, subject: null, body: 'Reminder text' }], error: null, count: 0 },
    };
    state.tables['screened_leads'] = {
      maybeSingle: { data: { id: 'lead-7', contact_phone: null, email_consent_status: 'unknown', sms_consent_status: 'explicit', six_month_expiry_date: null }, error: null },
    };
    const summary = await dispatchScheduledCadenceMessages();
    expect(summary.blocked).toBe(1);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});
