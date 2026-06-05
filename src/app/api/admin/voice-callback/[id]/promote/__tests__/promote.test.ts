/**
 * Tests for the operator-gated promote route:
 *   POST /api/admin/voice-callback/[id]/promote
 *
 * Locks the launch-relevant guarantees from the CLS reset (2026-06-05):
 *   1. Operator gate is enforced (401 without an operator session).
 *   2. Missing source row returns 404.
 *   3. Missing firm returns 404 (before engine work runs).
 *   4. Missing raw_transcript returns 422 (no garbage in).
 *   5. Already-promoted row returns 409 with the existing screened_lead_id.
 *   6. Contact-doctrine voice-reachability gate refuses unreachable rows
 *      (422 with awaiting_contact reason). Recovery does not bypass doctrine.
 *   7. Happy path: 200 + screened_leads insert AND the source callback row
 *      is updated with the forward link (`promoted_to_screened_lead`),
 *      closing the two-way audit linkage. The recovered lead carries
 *      `voice_meta.recovered_from_callback = <source id>` as the reverse link.
 *
 * Doctrine guard: the test asserts that NO hand-built brief HTML appears in
 * the inserted row. The brief must be produced by `renderBriefHtmlServer`
 * (via the shared `runVoicePipeline`), which we let run for real here against
 * a transcript that classifies cleanly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

interface CapturedInsert {
  table: string;
  payload: Record<string, unknown>;
}
interface CapturedUpdate {
  table: string;
  payload: Record<string, unknown>;
  whereField?: string;
  whereValue?: unknown;
}
interface MockCallbackRow {
  id: string;
  firm_id: string;
  branch: string;
  urgency: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  organization: string | null;
  message: string | null;
  raw_transcript: string | null;
  voice_meta: Record<string, unknown> | null;
  promoted_to_screened_lead: string | null;
  created_at: string;
}
interface MockFirmRow {
  id: string;
  name: string | null;
  location: string | null;
}

const captured: {
  inserts: CapturedInsert[];
  updates: CapturedUpdate[];
} = { inserts: [], updates: [] };

// Per-test row state. The Supabase mock reads from these.
let callbackRowOverride: MockCallbackRow | null | undefined = undefined;
let firmRowOverride: MockFirmRow | null | undefined = undefined;

const DRG_FIRM_ID = '11111111-1111-1111-1111-111111111111';
const CALLBACK_ID = '22222222-2222-2222-2222-222222222222';

function makeDefaultCallback(overrides: Partial<MockCallbackRow> = {}): MockCallbackRow {
  return {
    id: CALLBACK_ID,
    firm_id: DRG_FIRM_ID,
    branch: 'unclear',
    urgency: 'normal',
    caller_name: 'Adriano',
    caller_phone: '+16475492106',
    organization: null,
    message: 'Wants to open a business',
    // A clean intake-shaped transcript so the pipeline classifies as a real
    // new-matter lead. Mirrors the real DRG smoke-call shape.
    raw_transcript: [
      'bot: Thanks for calling DRG Law. Are you a new client?',
      'human: Yes, looking for legal help for the first time.',
      'bot: Got it. Can I get your name?',
      'human: Adriano.',
      'bot: Thanks, Adriano. What can the firm help with?',
      'human: I need to open my business. I am a freelancer and want to incorporate.',
    ].join('\n'),
    voice_meta: {
      call_id: 'qBx9Y2cM4fgwpb8eeTqm',
      caller_phone_source: 'body',
      classifier_branch: 'new_matter',
      classifier_mode: 'error',
      classifier_reason: 'gemini 503 high demand',
      marker: 'OTHER',
      reconciliation_reason: 'marker_non_intake_classifier_new_matter',
      operator_review: true,
    },
    promoted_to_screened_lead: null,
    created_at: '2026-06-05T16:31:07.947268Z',
    ...overrides,
  };
}
function makeDefaultFirm(overrides: Partial<MockFirmRow> = {}): MockFirmRow {
  return {
    id: DRG_FIRM_ID,
    name: 'DRG Law',
    location: 'Toronto, Ontario, Canada',
    ...overrides,
  };
}

vi.mock('@/lib/supabase-admin', () => {
  // A minimal Supabase mock that supports the access patterns the route uses:
  //   .from('voice_callback_requests').select(...).eq('id', x).maybeSingle()
  //   .from('intake_firms').select(...).eq('id', x).maybeSingle()
  //   .from('screened_leads').insert({...}).select(...).single()
  //   .from('voice_callback_requests').update({...}).eq('id', x)
  function makeChain(table: string) {
    const ctx: { whereField?: string; whereValue?: unknown } = {};
    const chain = {
      select: (_cols: string) => chain,
      eq: (field: string, value: unknown) => {
        ctx.whereField = field;
        ctx.whereValue = value;
        return chain;
      },
      maybeSingle: <T = unknown>() => {
        if (table === 'voice_callback_requests') {
          return Promise.resolve({
            data: (callbackRowOverride === undefined
              ? makeDefaultCallback()
              : callbackRowOverride) as T | null,
            error: null,
          });
        }
        if (table === 'intake_firms') {
          return Promise.resolve({
            data: (firmRowOverride === undefined
              ? makeDefaultFirm()
              : firmRowOverride) as T | null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single: () => Promise.resolve({ data: null, error: null }),
      insert: (payload: Record<string, unknown>) => {
        captured.inserts.push({ table, payload });
        return {
          select: (_cols: string) => ({
            single: () =>
              Promise.resolve({
                data: {
                  id: 'new-screened-lead-uuid',
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
      update: (payload: Record<string, unknown>) => {
        const upd = chain as unknown as {
          select?: (cols: string) => unknown;
        };
        // For the update path, record the call after .eq() captures the where.
        const updateChain = {
          eq: (field: string, value: unknown) => {
            captured.updates.push({
              table,
              payload,
              whereField: field,
              whereValue: value,
            });
            return Promise.resolve({ data: null, error: null });
          },
        };
        // Silence unused.
        void upd;
        return updateChain;
      },
    };
    return chain;
  }
  return {
    supabaseAdmin: { from: (table: string) => makeChain(table) },
  };
});

vi.mock('@/lib/portal-auth', async () => {
  // Operator session toggled by tests via `operatorSession`.
  return {
    getOperatorSession: vi.fn(async () => operatorSession),
  };
});

let operatorSession: {
  firm_id: string;
  role: string;
  lawyer_id?: string;
  exp: number;
} | null = {
  firm_id: '00000000-0000-0000-0000-000000000000',
  role: 'operator',
  lawyer_id: 'lawyer-op-uuid',
  exp: 9999999999,
};

vi.mock('@/lib/lead-notify', () => ({
  notifyLawyersOfNewLead: vi.fn(() => Promise.resolve({ attempted: 0, sent: 0, skipped: 0 })),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    void p.catch(() => undefined);
  },
}));

vi.mock('@/lib/screen-llm-server', () => ({
  // The LLM extractor is best-effort; the pipeline carries on with the
  // regex-only state when the LLM is absent. Tests run without Gemini.
  llmExtractServer: vi.fn(() =>
    Promise.resolve({ mode: 'mock', extracted: {} }),
  ),
}));

import { POST } from '../route';
import { notifyLawyersOfNewLead } from '@/lib/lead-notify';

function makeRequest(): Request {
  return new Request(
    `https://app.caseloadselect.ca/api/admin/voice-callback/${CALLBACK_ID}/promote`,
    { method: 'POST' },
  );
}

function makeParams(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: CALLBACK_ID }) };
}

beforeEach(() => {
  captured.inserts = [];
  captured.updates = [];
  callbackRowOverride = undefined;
  firmRowOverride = undefined;
  operatorSession = {
    firm_id: '00000000-0000-0000-0000-000000000000',
    role: 'operator',
    lawyer_id: 'lawyer-op-uuid',
    exp: 9999999999,
  };
  vi.mocked(notifyLawyersOfNewLead).mockClear();
});

describe('POST /api/admin/voice-callback/[id]/promote', () => {
  it('401 when there is no operator session', async () => {
    operatorSession = null;
    const res = await POST(makeRequest() as never, makeParams());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('unauthorized');
    expect(captured.inserts).toHaveLength(0);
  });

  it('404 when the callback row does not exist', async () => {
    callbackRowOverride = null;
    const res = await POST(makeRequest() as never, makeParams());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('voice_callback_request not found');
    expect(captured.inserts).toHaveLength(0);
  });

  it('404 when the firm does not exist', async () => {
    firmRowOverride = null;
    const res = await POST(makeRequest() as never, makeParams());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('firm not found');
    expect(captured.inserts).toHaveLength(0);
  });

  it('422 when the callback row has no transcript', async () => {
    callbackRowOverride = makeDefaultCallback({ raw_transcript: '' });
    const res = await POST(makeRequest() as never, makeParams());
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('no raw_transcript');
    expect(captured.inserts).toHaveLength(0);
  });

  it('409 (idempotency) when the row is already promoted', async () => {
    callbackRowOverride = makeDefaultCallback({
      promoted_to_screened_lead: 'existing-screened-lead-uuid',
    });
    const res = await POST(makeRequest() as never, makeParams());
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      screened_lead_id: string;
    };
    expect(body.error).toBe('already promoted');
    expect(body.screened_lead_id).toBe('existing-screened-lead-uuid');
    expect(captured.inserts).toHaveLength(0);
  });

  it('422 (awaiting_contact) when the contact gate fails (no phone AND no email AND no recoverable name)', async () => {
    callbackRowOverride = makeDefaultCallback({
      caller_phone: null,
      caller_name: null,
      // Transcript has no contact info either; the pipeline can't recover.
      raw_transcript: 'human: I need help.',
    });
    const res = await POST(makeRequest() as never, makeParams());
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('awaiting_contact');
    expect(captured.inserts).toHaveLength(0);
  });

  it(
    'happy path: 200 with two-way audit linkage and a real CLS brief',
    async () => {
      const res = await POST(makeRequest() as never, makeParams());
      const body = (await res.json()) as {
        promoted: boolean;
        screened_lead_id: string;
        lead_id: string;
        band: string | null;
      };
      expect(res.status).toBe(200);
      expect(body.promoted).toBe(true);
      expect(body.screened_lead_id).toBe('new-screened-lead-uuid');
      expect(body.lead_id).toBeTruthy();

      // The insert hit screened_leads with the recovery audit field set.
      const sl = captured.inserts.find((c) => c.table === 'screened_leads');
      expect(sl).toBeDefined();
      const slotAnswers = sl?.payload.slot_answers as {
        voice_meta?: Record<string, unknown>;
      };
      expect(slotAnswers?.voice_meta?.recovered_from_callback).toBe(CALLBACK_ID);
      expect(slotAnswers?.voice_meta?.recovered_by).toBe('lawyer-op-uuid');

      // The brief_html exists and looks like the real renderer output —
      // it has the NAP block and the four-axis breakdown, not a hand-crafted
      // string. We don't assert the exact text (the renderer is the source
      // of truth and it can evolve); we just guard against handcrafted markup.
      const briefHtml = sl?.payload.brief_html as string;
      expect(briefHtml).toContain('brief-group-nap');
      expect(briefHtml).toContain('axis-breakdown');
      // The handcrafted SQL-recovery shape we explicitly rejected on 2026-06-05
      // included this phrasing — locking it out.
      expect(briefHtml).not.toContain('Recovered call.');

      // status_changed_by_role records the operator, not the system.
      expect(sl?.payload.status_changed_by_role).toBe('operator');
      expect(sl?.payload.status_changed_by).toBe('lawyer-op-uuid');

      // The submitted_at is the ORIGINAL call timestamp (recovery preserves
      // arrival time), not 'now'.
      expect(sl?.payload.submitted_at).toBe('2026-06-05T16:31:07.947268Z');

      // The two-way audit link is closed: the source row got the forward
      // pointer.
      const upd = captured.updates.find((u) => u.table === 'voice_callback_requests');
      expect(upd).toBeDefined();
      expect(upd?.payload.promoted_to_screened_lead).toBe('new-screened-lead-uuid');
      expect(upd?.whereField).toBe('id');
      expect(upd?.whereValue).toBe(CALLBACK_ID);

      // The lawyer notification fired (best-effort; the test mocks it).
      expect(notifyLawyersOfNewLead).toHaveBeenCalledTimes(1);
      const notifyArg = vi.mocked(notifyLawyersOfNewLead).mock.calls[0][0];
      expect(notifyArg.firmId).toBe(DRG_FIRM_ID);
      expect(notifyArg.channel).toBe('voice');
    },
  );
});
