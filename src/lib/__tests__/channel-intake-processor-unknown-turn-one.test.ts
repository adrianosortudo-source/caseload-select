/**
 * F2 regression guard (2026-08-06 field repro, build plan
 * docs/BUILD_PLAN_meta_channel_intake_fixes_v1.md).
 *
 * Field repro: WhatsApp, sender profile pre-fills name + phone (contact
 * gate passes turn 1). Lead sends "i want to speak to a lawyer", which
 * regex-classifies to matter_type 'unknown'. discovery-floor.ts puts
 * 'unknown' in EARLY_FINALIZE_MATTERS, so meetsDiscoveryFloor() returned
 * true immediately, selectNextSlot() returns null for 'unknown' by design
 * (nothing to ask), and the processor finalized with zero questions asked
 * and all four scoring axes at 0.
 *
 * Persisted row confirming this in production:
 *   matter_type: unknown, band C, four_axis all 0, multi_turn: false,
 *   follow_up_count: 0, questionHistory: []
 *
 * Fix: on turn one only (discoveryFollowUpCount === 0) with an unknown
 * matter, ask an opening description question instead of finalizing.
 * KNOWN LIMITATION locked in by this suite: turn two does NOT reclassify
 * (matter_type is only ever set once, by initialiseState on turn 1 — see
 * slotEvidence.ts:24, which no-ops runEvidencePass for an unknown
 * matter). So a real description on turn two still finalizes on turn two,
 * NOT with more discovery. This suite asserts that documented behavior
 * exactly, so a future change to it is a deliberate decision, not a
 * silent regression.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  sendChannelMessage: vi.fn(),
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
    lead_id: 'L-test-unknown-turn-one',
    status: 'triaging',
    decision_deadline: '2026-08-07T00:00:00.000Z',
    whale_nurture: false,
  } as Record<string, unknown>,
  insertPayload: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/channel-send', () => ({
  sendChannelMessage: mocks.sendChannelMessage,
  buildContactCaptureFollowUp: vi.fn(() => 'follow-up text'),
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

function whatsappSender(senderName: string | null = 'Adriano'): WhatsAppSender {
  return {
    channel: 'whatsapp',
    senderWaId: '16475492106',
    senderName,
    messageMid: 'mid_unknown_1',
    phoneNumberId: 'pn-1',
  };
}

beforeEach(() => {
  mocks.sendChannelMessage.mockReset();
  mocks.sendChannelMessage.mockResolvedValue({ sent: true, messageId: 'mid_out' });
  mocks.llmExtractServer.mockReset();
  mocks.llmExtractServer.mockResolvedValue({ mode: 'mock', extracted: {} });
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

describe('Unknown-matter turn-one guard (F2)', () => {
  it('field repro: "i want to speak to a lawyer" on WhatsApp with contact pre-filled asks a description question, does NOT finalize with zero questions', async () => {
    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'i want to speak to a lawyer',
      sender: whatsappSender('Adriano'),
    });

    // Pre-fix: r.persisted === true, a brief was inserted with
    // four_axis all 0 and questionHistory []. Post-fix: the processor
    // asks instead of finalizing.
    expect(r.persisted).toBe(false);
    expect(r.followUpSent).toBe(true);
    expect(mocks.insertPayload).toBeNull();

    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    // Not the finalization / "a lawyer is reviewing" closing copy.
    expect(sentText.toLowerCase()).not.toContain('reviewing your matter');
    // Asks the lead to describe their situation.
    expect(sentText).toMatch(/describe/i);
    expect(sentText).toMatch(/\?/);

    // Session persisted so the next inbound resumes.
    expect(mocks.createChannelSession).toHaveBeenCalledTimes(1);
    const sessionPayload = (mocks.createChannelSession.mock.calls as unknown as Array<
      Array<{ engineState: { discoveryFollowUpCount?: number; matter_type: string } }>
    >)[0][0];
    expect(sessionPayload.engineState.matter_type).toBe('unknown');
    expect(sessionPayload.engineState.discoveryFollowUpCount).toBe(1);
  });

  it('out_of_scope is structurally excluded from the F2 guard on any turn', async () => {
    // F2 lives entirely inside `if (inDiscoveryPhase)`, and inDiscoveryPhase
    // unconditionally excludes matter_type === 'out_of_scope'
    // (`state.matter_type !== 'out_of_scope'`) — not a turn-count check.
    // So this is a structural guarantee, not a text-classification one:
    // seed a resumed session already classified out_of_scope with
    // discoveryFollowUpCount 0 (the exact condition that fires F2 for
    // 'unknown') and confirm the F2 opening question never fires.
    mocks.loadOpenChannelSession.mockResolvedValueOnce({
      id: 'session-uuid',
      firm_id: FIRM_ID,
      channel: 'whatsapp',
      sender_id: '16475492106',
      engine_state: {
        lead_id: 'L-test-oos',
        input: 'do you sell insurance policies',
        matter_type: 'out_of_scope',
        practice_area: 'unknown',
        intent_family: 'unknown',
        dispute_family: 'unknown',
        advisory_subtrack: 'unknown',
        slots: {
          client_name: 'Adriano',
          client_phone: '+16475492106',
        },
        slot_meta: {
          client_name: { source: 'profile_metadata', confidence: 1.0 },
          client_phone: { source: 'system_metadata', confidence: 1.0 },
        },
        slot_evidence: {},
        raw: {
          mentions_urgency: false, mentions_money: false, mentions_access: false,
          mentions_ownership: false, mentions_documents: false, mentions_payment: false,
          mentions_agreement: false, mentions_vendor: false, mentions_fraud: false,
          mentions_property: false, mentions_closing: false, mentions_lease: false,
          mentions_construction: false, mentions_mortgage: false,
          mentions_preconstruction: false, input_length: 28,
        },
        confidence: 0,
        coreCompleteness: 0,
        answeredQuestionGroups: [],
        questionHistory: [],
        insightShown: true,
        contactCaptureStarted: true,
        submitted_at: '2026-08-06T18:39:44.471Z',
        language: 'en',
        discoveryFollowUpCount: 0,
      },
      follow_up_count: 0,
      max_follow_ups: 3,
      finalized: false,
      expires_at: '2026-08-07T18:39:44.471Z',
      created_at: '2026-08-06T18:39:44.471Z',
    } as never);

    await processChannelInbound({
      firmId: FIRM_ID,
      text: 'ok thanks',
      sender: whatsappSender('Adriano'),
    });

    // Whatever the out_of_scope routing flow does, it must NOT be the F2
    // "describe your situation" ask — that copy only comes from the
    // unknown-matter branch.
    if (mocks.sendChannelMessage.mock.calls.length > 0) {
      const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
      expect(sentText).not.toMatch(/describe in a sentence or two/i);
    }
  });

  it('turn two: matter still unknown after the guard fired once — finalizes rather than asking again (documented limitation, not a loop)', async () => {
    // Turn one already consumed the single guard slot
    // (discoveryFollowUpCount: 1). Even if the lead's turn-two reply is a
    // real description, matter_type stays 'unknown' (no reclassification
    // on resume — see file header). The guard's own discoveryCount === 0
    // condition prevents it from firing twice, so this must finalize
    // rather than loop.
    mocks.loadOpenChannelSession.mockResolvedValueOnce({
      id: 'session-uuid',
      firm_id: FIRM_ID,
      channel: 'whatsapp',
      sender_id: '16475492106',
      engine_state: {
        lead_id: 'L-test-unknown-turn-two',
        input: 'i want to speak to a lawyer',
        matter_type: 'unknown',
        practice_area: 'unknown',
        intent_family: 'unknown',
        dispute_family: 'unknown',
        advisory_subtrack: 'unknown',
        slots: {
          client_name: 'Adriano',
          client_phone: '+16475492106',
        },
        slot_meta: {
          client_name: { source: 'profile_metadata', confidence: 1.0 },
          client_phone: { source: 'system_metadata', confidence: 1.0 },
        },
        slot_evidence: {},
        raw: {
          mentions_urgency: false, mentions_money: false, mentions_access: false,
          mentions_ownership: false, mentions_documents: false, mentions_payment: false,
          mentions_agreement: false, mentions_vendor: false, mentions_fraud: false,
          mentions_property: false, mentions_closing: false, mentions_lease: false,
          mentions_construction: false, mentions_mortgage: false,
          mentions_preconstruction: false, input_length: 28,
        },
        confidence: 0,
        coreCompleteness: 0,
        answeredQuestionGroups: [],
        questionHistory: [],
        insightShown: false,
        contactCaptureStarted: true,
        submitted_at: '2026-08-06T18:39:44.471Z',
        language: 'en',
        discoveryFollowUpCount: 1,
      },
      follow_up_count: 0,
      max_follow_ups: 3,
      finalized: false,
      expires_at: '2026-08-07T18:39:44.471Z',
      created_at: '2026-08-06T18:39:44.471Z',
    } as never);

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'I have a contract dispute with my landlord about the lease renewal',
      sender: whatsappSender('Adriano'),
    });

    expect(r.persisted).toBe(true);
    expect(mocks.insertPayload).not.toBeNull();
  });
});
