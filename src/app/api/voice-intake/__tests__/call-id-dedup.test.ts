/**
 * Voice intake call-event window dedup (launch audit H1, per DR-042).
 *
 * A GHL workflow re-fire posts the same ghl_call_event_id again; without the guard
 * the engine runs twice and produces a duplicate lead plus a second lawyer
 * notification. The guard is a 10-minute window, NOT an unconditional
 * event-id check. The legacy call_id field is the GHL CONTACT id for DRG
 * and must never be used to identify a call.
 *
 * Coverage:
 *   - Re-fire inside 10 minutes: 200 { ok, dedup, lead_id }, no second
 *     screened_leads insert, no second lawyer notification.
 *   - Same call-event id with the prior row outside the window: processes
 *     normally (new insert, notification fires).
 *   - Missing event id: a raw-body hash supplies deterministic retry identity.
 *   - An unresolved legacy contact placeholder is not used as event identity.
 *   - Callback-branch re-fire inside the window: 200 { ok, dedup, id },
 *     no second voice_callback_requests insert, no operator notification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const FIRM_ID = '11111111-1111-1111-1111-111111111111';

interface CapturedInsert {
  table: string;
  payload: Record<string, unknown>;
}
type StagedRow = Record<string, unknown>;
interface LoggedQuery {
  table: string;
  filters: Array<{ op: string; col: string; val: unknown }>;
}

const captured: { inserts: CapturedInsert[] } = { inserts: [] };
const staged: { screenedLeads: StagedRow[]; callbacks: StagedRow[] } = {
  screenedLeads: [],
  callbacks: [],
};
const queryLog: LoggedQuery[] = [];

vi.mock('@/lib/supabase-admin', () => {
  const rowsForTable = (table: string): StagedRow[] => {
    if (table === 'screened_leads') return staged.screenedLeads;
    if (table === 'voice_callback_requests' || table === 'voice_recovery_cases') return staged.callbacks;
    return [];
  };

  const makeChain = (table: string) => {
    const filters: Array<{ op: string; col: string; val: unknown }> = [];
    const chain = {
      select: (_cols: string) => chain,
      eq: (col: string, val: unknown) => {
        filters.push({ op: 'eq', col, val });
        return chain;
      },
      gte: (col: string, val: unknown) => {
        filters.push({ op: 'gte', col, val });
        return chain;
      },
      limit: (_n: number) => chain,
      maybeSingle: () => {
        queryLog.push({ table, filters });
        if (table === 'intake_firms') {
          return Promise.resolve({ data: { id: FIRM_ID }, error: null });
        }
        const match = rowsForTable(table).find((row) =>
          filters.every((f) => {
            // Screened leads keep event identity in voice_meta; recovery
            // cases keep it in a dedicated column.
            const key = f.col.includes('ghl_call_event_id') ? 'ghl_call_event_id' : f.col;
            const cell = row[key];
            if (f.op === 'eq') return cell === f.val;
            if (f.op === 'gte') return typeof cell === 'string' && cell >= String(f.val);
            return true;
          }),
        );
        return Promise.resolve({ data: match ?? null, error: null });
      },
      single: () => Promise.resolve({ data: null, error: null }),
      insert: (payload: Record<string, unknown>) => {
        captured.inserts.push({ table, payload });
        return {
          select: (_cols: string) => ({
            single: () =>
              Promise.resolve({
                data: {
                  id: 'new-row-uuid',
                  lead_id: payload.lead_id,
                  status: payload.status,
                  decision_deadline: payload.decision_deadline,
                  whale_nurture: payload.whale_nurture,
                },
                error: null,
              }),
          }),
        };
      },
      update: (_payload: Record<string, unknown>) => ({
        eq: () => Promise.resolve({ data: null, error: null }),
      }),
    };
    return chain;
  };
  return {
    supabaseAdmin: { from: (table: string) => makeChain(table) },
  };
});

vi.mock('@/lib/lead-notify', () => ({
  notifyLawyersOfNewLead: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/voice-callback-notify', () => ({
  notifyOperatorOfVoiceCallback: vi.fn(() => Promise.resolve({ email: 'skipped', sms: 'skipped', errors: [] })),
  notifyOperatorOfUnconfirmedVoiceIntake: vi.fn(() => Promise.resolve({ email: 'skipped', errors: [] })),
  notifyOperatorOfLlmDisabled: vi.fn(() => Promise.resolve({ email: 'skipped', errors: [] })),
}));

vi.mock('@/lib/voice-branch-classifier-server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/voice-branch-classifier')>(
    '@/lib/voice-branch-classifier',
  );
  return {
    classifyVoiceBranchServer: vi.fn((transcript: string) =>
      Promise.resolve({
        branch: actual.classifyVoiceBranchHeuristic(transcript),
        mode: 'heuristic',
      }),
    ),
  };
});

vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    void p.catch(() => undefined);
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() =>
    Promise.resolve({ ok: true, active: false, remaining: 30, reset: 0, limit: 30 }),
  ),
  ipFromRequest: vi.fn(() => '203.0.113.1'),
  rateLimitHeaders: vi.fn(() => ({})),
}));

vi.mock('@/lib/voice-webhook-auth', () => ({
  VOICE_SIGNATURE_HEADER: 'x-cls-voice-signature',
  verifyVoiceWebhookSignature: vi.fn(() => Promise.resolve({ mode: 'soft_open', reason: 'not_required' })),
  shouldRejectVoiceRequest: vi.fn(() => ({ reject: false })),
  isHmacRequired: vi.fn(() => false),
}));

vi.mock('@/lib/screen-llm-server', () => ({
  llmExtractServer: vi.fn(() => Promise.resolve({ mode: 'mock', extracted: {} })),
}));

import { POST } from '../route';
import { notifyLawyersOfNewLead } from '@/lib/lead-notify';
import { notifyOperatorOfVoiceCallback } from '@/lib/voice-callback-notify';

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('https://app.caseloadselect.ca/api/voice-intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function dedupQueries(): LoggedQuery[] {
  return queryLog.filter((q) =>
    q.filters.some((f) => f.col.includes('call_event_id')),
  );
}

const INTAKE_TRANSCRIPT =
  'I need help with an unpaid invoice. My business partner stopped paying.';

beforeEach(() => {
  captured.inserts = [];
  staged.screenedLeads = [];
  staged.callbacks = [];
  queryLog.length = 0;
  vi.mocked(notifyLawyersOfNewLead).mockClear();
  vi.mocked(notifyOperatorOfVoiceCallback).mockClear();
});

describe('/api/voice-intake call_id window dedup', () => {
  it('re-fire inside 10 minutes dedupes: no second insert, no second notification', async () => {
    staged.screenedLeads.push({
      id: 'prior-row-uuid',
      lead_id: 'L-prior',
      firm_id: FIRM_ID,
      ghl_call_event_id: 'call_evt_001',
      created_at: minutesAgoIso(2),
    });
    const res = await POST(
      makeRequest({
        firmId: FIRM_ID,
        caller_phone: '+14165550143',
        caller_name: 'Alex Caller',
        transcript: INTAKE_TRANSCRIPT,
        call_id: 'qBx9Y2cM4fgwpb8eeTqm',
        ghl_call_event_id: 'call_evt_001',
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; dedup?: boolean; lead_id?: string };
    expect(body.ok).toBe(true);
    expect(body.dedup).toBe(true);
    expect(body.lead_id).toBe('L-prior');

    expect(captured.inserts).toHaveLength(0);
    expect(notifyLawyersOfNewLead).not.toHaveBeenCalled();
  });

  it('same call_id with the prior row outside the 10-minute window processes normally', async () => {
    // The short window is the whole point: GHL maps the CONTACT id into
    // call_id for DRG, so a genuine second call from the same person later
    // in the day arrives with the same call_id and must NOT be swallowed.
    staged.screenedLeads.push({
      id: 'prior-row-uuid',
      lead_id: 'L-prior',
      firm_id: FIRM_ID,
      ghl_call_event_id: 'call_evt_002',
      created_at: minutesAgoIso(30),
    });
    const res = await POST(
      makeRequest({
        firmId: FIRM_ID,
        caller_phone: '+14165550143',
        caller_name: 'Alex Caller',
        transcript: INTAKE_TRANSCRIPT,
        call_id: 'qBx9Y2cM4fgwpb8eeTqm',
        ghl_call_event_id: 'call_evt_002',
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { persisted?: boolean; dedup?: boolean };
    expect(body.dedup).toBeUndefined();
    expect(body.persisted).toBe(true);

    const screened = captured.inserts.filter((c) => c.table === 'screened_leads');
    expect(screened).toHaveLength(1);
    expect(notifyLawyersOfNewLead).toHaveBeenCalledTimes(1);
  });

  it('missing event id uses a raw-body hash and processes normally', async () => {
    const res = await POST(
      makeRequest({
        firmId: FIRM_ID,
        caller_phone: '+14165550143',
        caller_name: 'Alex Caller',
        transcript: INTAKE_TRANSCRIPT,
        // call and contact ids omitted
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { persisted?: boolean };
    expect(body.persisted).toBe(true);

    expect(dedupQueries()).toHaveLength(2);
    expect(captured.inserts.filter((c) => c.table === 'screened_leads')).toHaveLength(1);
  });

  it('unresolved legacy contact placeholder is not used as event identity', async () => {
    const res = await POST(
      makeRequest({
        firmId: FIRM_ID,
        caller_phone: '+14165550143',
        caller_name: 'Alex Caller',
        transcript: INTAKE_TRANSCRIPT,
        call_id: '{{contact.id}}',
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { persisted?: boolean };
    expect(body.persisted).toBe(true);
    expect(dedupQueries()).toHaveLength(2);
  });

  it('callback-branch re-fire inside the window dedupes against voice_callback_requests', async () => {
    staged.callbacks.push({
      id: 'prior-callback-uuid',
      firm_id: FIRM_ID,
      ghl_call_event_id: 'call_evt_callback_001',
      created_at: minutesAgoIso(3),
    });
    const res = await POST(
      makeRequest({
        firmId: FIRM_ID,
        caller_phone: '+14165550143',
        caller_name: 'Existing Client',
        transcript: [
          'human: I am an existing client calling for an update on my case.',
          'bot: Thanks. I will pass this message to the firm.',
          'bot: RECORD_BRANCH: OTHER',
        ].join('\n'),
        call_id: 'qBx9Y2cM4fgwpb8eeTqm',
        ghl_call_event_id: 'call_evt_callback_001',
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; dedup?: boolean; id?: string };
    expect(body.ok).toBe(true);
    expect(body.dedup).toBe(true);
    expect(body.id).toBe('prior-callback-uuid');

    expect(captured.inserts).toHaveLength(0);
    expect(notifyOperatorOfVoiceCallback).not.toHaveBeenCalled();
  });

  it('first delivery of a callback call inside an empty window inserts normally', async () => {
    const res = await POST(
      makeRequest({
        firmId: FIRM_ID,
        caller_phone: '+14165550143',
        caller_name: 'Existing Client',
        transcript: [
          'human: I am an existing client calling for an update on my case.',
          'bot: Thanks. I will pass this message to the firm.',
          'bot: RECORD_BRANCH: OTHER',
        ].join('\n'),
        call_id: 'callid_fresh_callback',
        ghl_call_event_id: 'call_evt_callback_002',
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode?: string };
    expect(body.mode).toBe('callback');
    expect(captured.inserts.filter((c) => c.table === 'voice_callback_requests')).toHaveLength(1);
  });
});
