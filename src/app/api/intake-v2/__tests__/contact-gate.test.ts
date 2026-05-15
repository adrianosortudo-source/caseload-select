/**
 * Contact-capture doctrine gate tests for /api/intake-v2.
 *
 * The SPA gate (Phase C) is the primary control; this server-side gate
 * is defense-in-depth. A direct POST with missing contact fields must
 * land in `unconfirmed_inquiries`, not in `screened_leads`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

interface CapturedInsert {
  table: string;
  payload: Record<string, unknown>;
}
const captured: { inserts: CapturedInsert[] } = { inserts: [] };

vi.mock('@/lib/supabase-admin', () => {
  const makeChain = (table: string) => ({
    select: (_cols: string) => makeChain(table),
    eq: (_field: string, _v: unknown) => makeChain(table),
    maybeSingle: () =>
      Promise.resolve(
        table === 'intake_firms'
          ? { data: { id: '11111111-1111-1111-1111-111111111111' }, error: null }
          : { data: null, error: null },
      ),
    single: () => Promise.resolve({ data: null, error: null }),
    insert: (payload: Record<string, unknown>) => {
      captured.inserts.push({ table, payload });
      return {
        select: (_cols: string) => ({
          single: () =>
            Promise.resolve({
              data: {
                id: 'row-uuid',
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
    not: (_field: string, _op: string, _v: unknown) =>
      Promise.resolve({ data: [{ custom_domain: 'client.drglaw.ca' }], error: null }),
  });
  return {
    supabaseAdmin: { from: (table: string) => makeChain(table) },
  };
});

vi.mock('@/lib/ghl-webhook', () => ({
  buildDeclinedOosPayload: vi.fn(() => ({})),
  fireGhlWebhook: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/lead-notify', () => ({
  notifyLawyersOfNewLead: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/decline-resolver', () => ({
  loadDeclineCandidates: vi.fn(() => Promise.resolve([])),
  resolveDecline: vi.fn(() => ({ subject: 'x', body: 'y', source: 'system_fallback' })),
}));
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

import { POST } from '../route';

const FIRM_ID = '11111111-1111-1111-1111-111111111111';

function makeRequest(body: Record<string, unknown>): Request {
  return new Request(
    `https://app.caseloadselect.ca/api/intake-v2?firmId=${FIRM_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://app.caseloadselect.ca',
      },
      body: JSON.stringify(body),
    },
  );
}

function baseValidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lead_id: 'L-2026-05-15-G1',
    matter_type: 'pi_mva',
    practice_area: 'pi',
    band: 'B',
    axes: { value: 7, complexity: 4, urgency: 6, readiness: 5, readinessAnswered: true },
    brief_json: { lead_id: 'L-2026-05-15-G1', summary: 'rear-ended on 401' },
    brief_html: '<div class="brief"><h3>Summary</h3><p>matter captured</p></div>',
    slot_answers: { slots: {}, slot_meta: {}, slot_evidence: {} },
    contact: { name: 'Real Lead', email: 'real@example.com', phone: '+14165550143' },
    submitted_at: '2026-05-15T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  captured.inserts = [];
});

describe('/api/intake-v2 contact-capture gate', () => {
  it('persists a screened_lead when contact is complete', async () => {
    const req = makeRequest(baseValidBody());
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const unconfirmed = captured.inserts.find((c) => c.table === 'unconfirmed_inquiries');
    expect(screened).toBeDefined();
    expect(unconfirmed).toBeUndefined();
  });

  it('lands in unconfirmed_inquiries when contact is fully missing', async () => {
    const req = makeRequest(
      baseValidBody({ contact: { name: '', email: '', phone: '' } }),
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const unconfirmed = captured.inserts.find((c) => c.table === 'unconfirmed_inquiries');
    expect(screened).toBeUndefined();
    expect(unconfirmed).toBeDefined();
    expect(unconfirmed?.payload.reason).toBe('no_contact_provided');
  });

  it('lands in unconfirmed_inquiries when only name is present (no email or phone)', async () => {
    const req = makeRequest(
      baseValidBody({ contact: { name: 'Anonymous Name', email: '', phone: '' } }),
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const unconfirmed = captured.inserts.find((c) => c.table === 'unconfirmed_inquiries');
    expect(screened).toBeUndefined();
    expect(unconfirmed).toBeDefined();
  });

  it('lands in unconfirmed_inquiries when only email is present (no name)', async () => {
    const req = makeRequest(
      baseValidBody({ contact: { name: '', email: 'someone@example.com', phone: '' } }),
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    const unconfirmed = captured.inserts.find((c) => c.table === 'unconfirmed_inquiries');
    expect(screened).toBeUndefined();
    expect(unconfirmed).toBeDefined();
  });

  it('persists when name + phone are present even without email', async () => {
    const req = makeRequest(
      baseValidBody({ contact: { name: 'Real Lead', email: '', phone: '+14165550143' } }),
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const screened = captured.inserts.find((c) => c.table === 'screened_leads');
    expect(screened).toBeDefined();
  });

  it('returns reason=awaiting_contact in the JSON body for incomplete contact', async () => {
    const req = makeRequest(
      baseValidBody({ contact: { name: '', email: '', phone: '' } }),
    );
    const res = await POST(req as never);
    const body = (await res.json()) as { persisted: boolean; reason?: string };
    expect(body.persisted).toBe(false);
    expect(body.reason).toBe('awaiting_contact');
  });
});
