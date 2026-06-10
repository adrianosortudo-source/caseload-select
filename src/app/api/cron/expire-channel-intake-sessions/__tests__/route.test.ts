/**
 * Expiry sweeper contact-aware split (launch audit B3, 2026-06-09).
 *
 * Defect: the hourly sweeper finalized ALL expired unfinalized sessions
 * into unconfirmed_inquiries with reason='abandoned' without checking
 * the contact gate. A contact-complete lead mid-discovery (name +
 * reachable phone already captured, engine still asking enrichment
 * questions) vanished with no lawyer notification, and their next
 * inbound started from zero. DR-038: a reachable lead must reach the
 * lawyer; a thin brief beats a dropped lead.
 *
 * Coverage:
 *   - contact-complete expired session finalizes into screened_leads,
 *     fires the new-lead notification, and marks the session finalized
 *     with the screened_lead_id link
 *   - contact-incomplete expired session keeps today's behaviour
 *     (unconfirmed_inquiries, reason='abandoned')
 *   - closing-message send failure (rejection or throw) does not block
 *     the finalize
 *   - auth + response shape preserved, with finalized / abandoned
 *     counts reported separately
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

// ─── Hoisted mocks ──────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  expiredRows: [] as Record<string, unknown>[],
  selectError: null as { message: string } | null,
  firmRow: {
    location: null,
    facebook_page_id: 'page-1',
    instagram_business_account_id: null,
    whatsapp_phone_number_id: 'pn-1',
  } as Record<string, unknown> | null,
  screenedInserts: [] as Record<string, unknown>[],
  insertError: null as { code?: string; message: string } | null,
  sessionUpdates: [] as Record<string, unknown>[],
  sendChannelMessage: vi.fn(),
  notifyLawyersOfNewLead: vi.fn(),
  finalizeChannelSession: vi.fn(),
  persistUnconfirmedInquiry: vi.fn(),
}));

vi.mock('@/lib/supabase-admin', () => {
  function from(table: string) {
    if (table === 'channel_intake_sessions') {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.lt = () => chain;
      chain.order = () => chain;
      chain.limit = () =>
        mocks.selectError
          ? Promise.resolve({ data: null, error: mocks.selectError })
          : Promise.resolve({ data: mocks.expiredRows, error: null });
      chain.update = (payload: Record<string, unknown>) => {
        mocks.sessionUpdates.push(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      };
      return chain;
    }
    if (table === 'intake_firms') {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve({ data: mocks.firmRow, error: null });
      return chain;
    }
    if (table === 'screened_leads') {
      return {
        insert: (payload: Record<string, unknown>) => {
          mocks.screenedInserts.push(payload);
          return {
            select: (_cols: string) => ({
              single: () =>
                mocks.insertError
                  ? Promise.resolve({ data: null, error: mocks.insertError })
                  : Promise.resolve({
                      data: {
                        id: 'screened-row-uuid',
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
      };
    }
    throw new Error(`unexpected table ${table}`);
  }
  return { supabaseAdmin: { from } };
});

vi.mock('@/lib/channel-send', () => ({
  sendChannelMessage: mocks.sendChannelMessage,
  buildContactCaptureFollowUp: vi.fn(() => 'follow-up text'),
  buildContactCaptureExhaustedMessage: vi.fn(() => 'exhausted text'),
}));

vi.mock('@/lib/screen-llm-server', () => ({
  llmExtractServer: vi.fn(() => Promise.resolve({ mode: 'mock', extracted: {} })),
}));

vi.mock('@/lib/screen-brief-html', () => ({
  renderBriefHtmlServer: vi.fn(() => '<div class="brief">brief</div>'),
}));

vi.mock('@/lib/lead-notify', () => ({
  notifyLawyersOfNewLead: mocks.notifyLawyersOfNewLead,
}));

vi.mock('@/lib/channel-intake-session-store', () => ({
  loadOpenChannelSession: vi.fn(() => Promise.resolve(null)),
  loadRecentFinalizedSession: vi.fn(() => Promise.resolve(null)),
  createChannelSession: vi.fn(() => Promise.resolve({ ok: true, id: 'x' })),
  updateChannelSession: vi.fn(() => Promise.resolve({ ok: true })),
  finalizeChannelSession: mocks.finalizeChannelSession,
}));

vi.mock('@/lib/unconfirmed-inquiry', () => ({
  persistUnconfirmedInquiry: mocks.persistUnconfirmedInquiry,
}));

// Import AFTER mocks.
import { GET } from '../route';

const FIRM_ID = '11111111-1111-1111-1111-111111111111';
const CRON_TOKEN = 'test-cron-secret';

function makeRequest(authorized = true): NextRequest {
  return new Request(
    'https://app.caseloadselect.ca/api/cron/expire-channel-intake-sessions',
    {
      method: 'GET',
      headers: authorized ? { authorization: `Bearer ${CRON_TOKEN}` } : {},
    },
  ) as unknown as NextRequest;
}

// Engine state restored from a session row. Mirrors the resume fixture in
// channel-intake-processor-closing.test.ts: contract dispute mid-discovery,
// contact slots filled (gate passes) unless overridden.
function engineState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    input: 'I have a contract dispute about unpaid invoices around $75k.',
    practice_area: 'corporate',
    matter_type: 'contract_dispute',
    intent_family: 'business_dispute',
    dispute_family: 'agreement_performance',
    advisory_subtrack: 'unknown',
    slots: {
      client_name: 'Adriano',
      client_phone: '+16475492106',
    },
    slot_meta: {
      client_name: { source: 'answered', confidence: 1.0 },
      client_phone: { source: 'answered', confidence: 1.0 },
    },
    slot_evidence: {},
    raw: {
      mentions_urgency: false,
      mentions_money: true,
      mentions_access: false,
      mentions_ownership: false,
      mentions_documents: false,
      mentions_payment: true,
      mentions_agreement: true,
      mentions_vendor: false,
      mentions_fraud: false,
      mentions_property: false,
      mentions_closing: false,
      mentions_lease: false,
      mentions_construction: false,
      mentions_mortgage: false,
      mentions_preconstruction: false,
      input_length: 20,
    },
    confidence: 0,
    coreCompleteness: 0,
    answeredQuestionGroups: [],
    questionHistory: [],
    insightShown: false,
    contactCaptureStarted: true,
    lead_id: 'L-2026-06-09-SWP',
    submitted_at: '2026-06-08T10:00:00.000Z',
    language: 'en',
    discoveryFollowUpCount: 4,
    ...overrides,
  };
}

function expiredSessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'session-1',
    firm_id: FIRM_ID,
    channel: 'whatsapp',
    sender_id: '16475492106',
    engine_state: engineState(),
    follow_up_count: 1,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_TOKEN;
  mocks.expiredRows = [];
  mocks.selectError = null;
  mocks.firmRow = {
    location: null,
    facebook_page_id: 'page-1',
    instagram_business_account_id: null,
    whatsapp_phone_number_id: 'pn-1',
  };
  mocks.screenedInserts = [];
  mocks.insertError = null;
  mocks.sessionUpdates = [];
  mocks.sendChannelMessage.mockReset();
  mocks.sendChannelMessage.mockResolvedValue({ sent: true, messageId: 'mid_out' });
  mocks.notifyLawyersOfNewLead.mockReset();
  mocks.notifyLawyersOfNewLead.mockResolvedValue(undefined);
  mocks.finalizeChannelSession.mockReset();
  mocks.finalizeChannelSession.mockResolvedValue({ ok: true });
  mocks.persistUnconfirmedInquiry.mockReset();
  mocks.persistUnconfirmedInquiry.mockResolvedValue({ ok: true, id: 'inq-1' });
});

describe('GET /api/cron/expire-channel-intake-sessions', () => {
  it('rejects unauthorized requests', async () => {
    const res = await GET(makeRequest(false));
    expect(res.status).toBe(401);
  });

  it('finalizes a contact-complete expired session into screened_leads', async () => {
    mocks.expiredRows = [expiredSessionRow()];

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.swept).toBe(1);
    expect(body.finalized).toBe(1);
    expect(body.abandoned).toBe(0);
    expect(body.outcomes[0]).toMatchObject({
      session_id: 'session-1',
      firm_id: FIRM_ID,
      channel: 'whatsapp',
      moved: true,
      disposition: 'finalized_lead',
    });

    // The lead landed in screened_leads, not unconfirmed_inquiries.
    expect(mocks.screenedInserts).toHaveLength(1);
    expect(mocks.persistUnconfirmedInquiry).not.toHaveBeenCalled();
    const insert = mocks.screenedInserts[0];
    expect(insert.firm_id).toBe(FIRM_ID);
    expect(insert.status).toBe('triaging');
    expect(insert.contact_name).toBe('Adriano');
    expect(insert.contact_phone).toBe('+16475492106');
    expect(insert.matter_type).toBe('contract_dispute');
    expect(insert.brief_html).toBe('<div class="brief">brief</div>');
    expect(insert.raw_transcript).toBe(
      'I have a contract dispute about unpaid invoices around $75k.',
    );

    // Session marked finalized WITH the screened_lead_id link so the
    // post-finalization secretary mode recognizes the returning lead.
    expect(mocks.finalizeChannelSession).toHaveBeenCalledWith(
      'session-1',
      'screened-row-uuid',
    );

    // New-lead notification fired.
    expect(mocks.notifyLawyersOfNewLead).toHaveBeenCalledTimes(1);
    expect(mocks.notifyLawyersOfNewLead.mock.calls[0][0]).toMatchObject({
      firmId: FIRM_ID,
      channel: 'whatsapp',
      contactName: 'Adriano',
    });

    // Best-effort closing message on the reconstructed sender, dispatched
    // with the firm's channel asset id.
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sendArgs = mocks.sendChannelMessage.mock.calls[0][0];
    expect(sendArgs.firmId).toBe(FIRM_ID);
    expect(sendArgs.sender).toMatchObject({
      channel: 'whatsapp',
      senderWaId: '16475492106',
      phoneNumberId: 'pn-1',
    });
  });

  it('still moves contact-incomplete sessions to unconfirmed_inquiries', async () => {
    mocks.expiredRows = [
      expiredSessionRow({
        engine_state: engineState({
          slots: { client_name: 'Adriano' },
          slot_meta: { client_name: { source: 'answered', confidence: 1.0 } },
        }),
        follow_up_count: 2,
      }),
    ];

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.finalized).toBe(0);
    expect(body.abandoned).toBe(1);
    expect(body.outcomes[0]).toMatchObject({
      moved: true,
      disposition: 'abandoned',
    });

    expect(mocks.screenedInserts).toHaveLength(0);
    expect(mocks.notifyLawyersOfNewLead).not.toHaveBeenCalled();
    expect(mocks.persistUnconfirmedInquiry).toHaveBeenCalledTimes(1);
    expect(mocks.persistUnconfirmedInquiry.mock.calls[0][0]).toMatchObject({
      firmId: FIRM_ID,
      channel: 'whatsapp',
      senderId: '16475492106',
      reason: 'abandoned',
      followUpAttempts: 2,
    });

    // Session flipped finalized via the direct update (original path).
    expect(mocks.sessionUpdates).toHaveLength(1);
    expect(mocks.sessionUpdates[0].finalized).toBe(true);
  });

  it('does not block the finalize when the closing send reports failure', async () => {
    mocks.expiredRows = [expiredSessionRow()];
    // Meta 24h messaging window often rejects the closing send.
    mocks.sendChannelMessage.mockResolvedValueOnce({
      sent: false,
      reason: 'message outside allowed window',
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.finalized).toBe(1);
    expect(mocks.screenedInserts).toHaveLength(1);
    expect(mocks.finalizeChannelSession).toHaveBeenCalledWith(
      'session-1',
      'screened-row-uuid',
    );
    expect(mocks.notifyLawyersOfNewLead).toHaveBeenCalledTimes(1);
  });

  it('does not block the finalize when the closing send throws', async () => {
    mocks.expiredRows = [expiredSessionRow()];
    mocks.sendChannelMessage.mockImplementationOnce(() => {
      throw new Error('unexpected boom');
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.finalized).toBe(1);
    expect(body.outcomes[0]).toMatchObject({
      moved: true,
      disposition: 'finalized_lead',
    });
    expect(mocks.screenedInserts).toHaveLength(1);
    expect(mocks.finalizeChannelSession).toHaveBeenCalledTimes(1);
  });

  it('leaves the session open for retry when the screened_leads insert fails', async () => {
    mocks.expiredRows = [expiredSessionRow()];
    mocks.insertError = { message: 'connection reset' };

    const res = await GET(makeRequest());
    const body = await res.json();

    // A reachable lead is never downgraded to unconfirmed_inquiries over
    // a transient insert failure; the next sweep retries.
    expect(body.finalized).toBe(0);
    expect(body.abandoned).toBe(0);
    expect(body.outcomes[0]).toMatchObject({
      moved: false,
      disposition: 'finalized_lead',
    });
    expect(mocks.persistUnconfirmedInquiry).not.toHaveBeenCalled();
    expect(mocks.finalizeChannelSession).not.toHaveBeenCalled();
    expect(mocks.sessionUpdates).toHaveLength(0);
  });

  it('sweeps a mixed batch into separate finalized and abandoned counts', async () => {
    mocks.expiredRows = [
      expiredSessionRow(),
      expiredSessionRow({
        id: 'session-2',
        sender_id: 'psid_abc',
        channel: 'facebook',
        engine_state: engineState({
          lead_id: 'L-2026-06-09-AB2',
          slots: {},
          slot_meta: {},
        }),
        follow_up_count: 3,
      }),
    ];

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.swept).toBe(2);
    expect(body.finalized).toBe(1);
    expect(body.abandoned).toBe(1);
    expect(body.batch_limit).toBe(100);
    expect(mocks.screenedInserts).toHaveLength(1);
    expect(mocks.persistUnconfirmedInquiry).toHaveBeenCalledTimes(1);
  });
});
