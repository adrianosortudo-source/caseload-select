/**
 * WP-2 (2026-08-13, field case 2026-08-07): regex evidence re-run after
 * the 'unknown' lane's LLM classification promotion.
 *
 * Reproduces the second half of the DRG Law Test WhatsApp smoke test:
 * the lead's first message ("i want to speak to a lawyers") carries no
 * matter keywords, so the regex classifier leaves matter_type='unknown'.
 * The lead's SECOND message ("open a business") is what actually
 * classifies the matter (via the LLM's __matter_type field on the
 * 'unknown' lane, DR-039) AND is wording a lead would expect to answer
 * advisory_path's "starting vs buying into" question.
 *
 * Before this fix, runEvidencePass ran once, at the top of the turn,
 * against the still-unknown matter_type, and always no-op'd
 * (extractSlotEvidence early-returns on matter_type === 'unknown').
 * advisory_path was then asked as a fresh question, showing all four
 * options including the irrelevant "Selling or closing down a
 * business," when the lead had already said enough to answer it.
 *
 * This test isolates the wiring fix from the regex-pattern fix: the
 * mocked LLM extraction returns ONLY __matter_type / __detected_language
 * (no advisory_path guess), so if advisory_path ends up filled with
 * 'explicit' provenance, it can only be the processor's second
 * runEvidencePass call (using the SAME turn's text against the newly
 * classified matter_type) doing the filling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  sendChannelMessage: vi.fn(),
  buildContactCaptureFollowUp: vi.fn(() => 'follow-up text'),
  llmExtractServer: vi.fn(() => Promise.resolve({ mode: 'mock', extracted: {} })),
  renderBriefHtmlServer: vi.fn(() => '<div class="brief">brief</div>'),
  notifyLawyersOfNewLead: vi.fn(() => Promise.resolve()),
  loadOpenChannelSession: vi.fn(() => Promise.resolve(null)),
  createChannelSession: vi.fn(() => Promise.resolve('session-uuid')),
  updateChannelSession: vi.fn(() => Promise.resolve()),
  finalizeChannelSession: vi.fn(() => Promise.resolve()),
  persistUnconfirmedInquiry: vi.fn(() => Promise.resolve()),
  insertedRow: {
    id: 'row-uuid',
    lead_id: 'L-test-unknown-lane-1',
    status: 'triaging',
    decision_deadline: '2026-08-14T00:00:00.000Z',
    whale_nurture: false,
  } as Record<string, unknown>,
  insertPayload: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/channel-send', () => ({
  sendChannelMessage: mocks.sendChannelMessage,
  buildContactCaptureFollowUp: mocks.buildContactCaptureFollowUp,
  buildContactCaptureExhaustedMessage: vi.fn(() => 'exhausted text'),
}));

vi.mock('@/lib/screen-llm-server', () => ({
  llmExtractServer: mocks.llmExtractServer,
}));

vi.mock('@/lib/screen-brief-html', () => ({
  renderBriefHtmlServer: mocks.renderBriefHtmlServer,
}));

vi.mock('@/lib/lead-notify', () => ({
  notifyLawyersOfNewLead: mocks.notifyLawyersOfNewLead,
}));

vi.mock('@/lib/channel-intake-session-store', () => ({
  loadOpenChannelSession: mocks.loadOpenChannelSession,
  loadRecentFinalizedSession: vi.fn().mockResolvedValue(null),
  createChannelSession: mocks.createChannelSession,
  updateChannelSession: mocks.updateChannelSession,
  finalizeChannelSession: mocks.finalizeChannelSession,
}));

vi.mock('@/lib/unconfirmed-inquiry', () => ({
  persistUnconfirmedInquiry: mocks.persistUnconfirmedInquiry,
}));

vi.mock('@/lib/supabase-admin', () => {
  const makeChain = () => ({
    select: (_cols: string) => makeChain(),
    eq: (_field: string, _v: unknown) => makeChain(),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => Promise.resolve({ data: mocks.insertedRow, error: null }),
    insert: (payload: Record<string, unknown>) => {
      mocks.insertPayload = payload;
      return {
        select: (_cols: string) => ({
          single: () => Promise.resolve({ data: mocks.insertedRow, error: null }),
        }),
      };
    },
  });
  return {
    supabaseAdmin: { from: (_table: string) => makeChain() },
  };
});

import {
  processChannelInbound,
  type WhatsAppSender,
} from '../channel-intake-processor';

const FIRM_ID = '11111111-1111-1111-1111-111111111111';

function whatsappSender(): WhatsAppSender {
  return {
    channel: 'whatsapp',
    senderWaId: '16475492106',
    senderName: 'Adriano',
    messageMid: 'mid_open_a_business',
    phoneNumberId: 'pn-1',
  };
}

function rawSignals(overrides: Partial<Record<string, boolean | number>> = {}) {
  return {
    mentions_urgency: false, mentions_money: false, mentions_access: false,
    mentions_ownership: false, mentions_documents: false, mentions_payment: false,
    mentions_agreement: false, mentions_vendor: false, mentions_fraud: false,
    mentions_property: false, mentions_closing: false, mentions_lease: false,
    mentions_construction: false, mentions_mortgage: false,
    mentions_preconstruction: false, input_length: 30,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.sendChannelMessage.mockReset();
  mocks.sendChannelMessage.mockResolvedValue({ sent: true, messageId: 'mid_out' });
  mocks.llmExtractServer.mockReset();
  mocks.renderBriefHtmlServer.mockReset();
  mocks.renderBriefHtmlServer.mockReturnValue('<div class="brief">brief</div>');
  mocks.loadOpenChannelSession.mockReset();
  mocks.loadOpenChannelSession.mockResolvedValue(null);
  mocks.notifyLawyersOfNewLead.mockReset();
  mocks.notifyLawyersOfNewLead.mockResolvedValue(undefined);
  mocks.persistUnconfirmedInquiry.mockReset();
  mocks.persistUnconfirmedInquiry.mockResolvedValue(undefined);
  mocks.createChannelSession.mockReset();
  mocks.createChannelSession.mockResolvedValue('session-uuid');
  mocks.updateChannelSession.mockReset();
  mocks.updateChannelSession.mockResolvedValue(undefined);
  mocks.finalizeChannelSession.mockReset();
  mocks.finalizeChannelSession.mockResolvedValue(undefined);
  mocks.insertPayload = null;
});

describe('processChannelInbound: unknown-lane classification re-runs regex evidence', () => {
  it('"open a business" fills advisory_path with explicit provenance on the same turn it classifies the matter', async () => {
    // Prior turn ("i want to speak to a lawyers") left matter_type
    // unknown and already captured contact, matching the field case's
    // actual sequence (contact was captured before the matter was ever
    // classified). No advisory slots are pre-filled.
    mocks.loadOpenChannelSession.mockResolvedValueOnce({
      id: 'session-unknown-lane',
      firm_id: FIRM_ID,
      channel: 'whatsapp',
      sender_id: '16475492106',
      engine_state: {
        input: 'i want to speak to a lawyers',
        practice_area: 'unknown',
        matter_type: 'unknown',
        intent_family: 'unknown',
        dispute_family: 'unknown',
        advisory_subtrack: 'unknown',
        slots: {
          client_name: 'Adriano',
          client_phone: '+16475492106',
        },
        slot_meta: {
          client_name: { source: 'explicit', confidence: 0.9 },
          client_phone: { source: 'system_metadata', confidence: 1.0 },
        },
        slot_evidence: {},
        raw: rawSignals(),
        confidence: 0,
        coreCompleteness: 0,
        answeredQuestionGroups: [],
        questionHistory: [],
        insightShown: false,
        contactCaptureStarted: true,
        lead_id: 'L-2026-08-07-unknown-lane',
        submitted_at: '2026-08-07T00:00:00.000Z',
        language: 'en',
        lead_intent: 'contact_request',
        discoveryFollowUpCount: 0,
      },
      follow_up_count: 0,
      max_follow_ups: 3,
      finalized: false,
      expires_at: '2026-08-08T00:00:00.000Z',
      created_at: '2026-08-07T00:00:00.000Z',
    } as never);

    // LLM classifies the matter but returns NO advisory_path guess, so
    // any fill on that slot must come from the regex re-run, not the LLM.
    mocks.llmExtractServer.mockResolvedValueOnce({
      mode: 'live',
      extracted: {
        __matter_type: 'business_setup_advisory',
        __detected_language: 'en',
      },
    });

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'open a business',
      sender: whatsappSender(),
    });

    // Contact was already complete, so the turn proceeds into discovery
    // rather than re-asking for contact.
    expect(r.persisted).toBe(false);
    expect(r.followUpSent).toBe(true);

    // The session was updated (resume turn), not created fresh.
    expect(mocks.updateChannelSession).toHaveBeenCalledTimes(1);
    const updateCall = (mocks.updateChannelSession.mock.calls as unknown as Array<
      Array<{
        engineState: {
          matter_type: string;
          slots: Record<string, string>;
          slot_meta: Record<string, { source: string }>;
        };
      }>
    >)[0][0];

    expect(updateCall.engineState.matter_type).toBe('business_setup_advisory');
    expect(updateCall.engineState.slots.advisory_path).toBe('Starting a new business');
    expect(updateCall.engineState.slot_meta.advisory_path?.source).toBe('explicit');

    // The outbound question must NOT be advisory_path's own menu (the
    // lead already answered it via regex evidence); the engine should
    // have moved on to the next unresolved slot in the DR-121 order.
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).not.toContain('Selling or closing down a business');
  });
});
