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
 *
 * CORRECTED 2026-08-07: this file originally claimed turn two can never
 * reclassify away from 'unknown' (reasoning only from initialiseState
 * being turn-1-only and runEvidencePass no-oping for 'unknown' per
 * slotEvidence.ts:24 — both true, but incomplete). llmExtractServer +
 * mergeLlmResults run on every resume turn, before this guard's own
 * Phase C block, and promote matter_type away from 'unknown' explicitly
 * ungated by design (see the DR-069 comment in
 * screen-engine/llm/extractor.ts). Production confirmed this live
 * 2026-08-07 (screened_leads.6ff7d438-2eda-42b4-be43-758df2c89bb1):
 * turn two's real description reclassified to business_setup_advisory
 * and ran a full discovery to a band B brief, in the same turn.
 *
 * The third test below ("turn two ... finalizes") is still correct for
 * what it actually exercises: this suite's llmExtractServer mock always
 * returns `{ mode: 'mock', extracted: {} }`, which the processor treats
 * as non-live, so mergeLlmResults never promotes anything. That is the
 * genuine, narrower path — LLM extraction unavailable or erroring on the
 * turn — not the normal outcome. See
 * docs/BUILD_PLAN_channel_intake_intro_optionmap_v1.md § 1 and C1 for
 * the full correction record.
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

  it('turn two with LLM extraction unavailable: finalizes rather than re-asking (graceful degradation, not the normal path)', async () => {
    // Turn one already consumed the single guard slot
    // (discoveryFollowUpCount: 1). This suite's llmExtractServer mock
    // always returns empty (mode: 'mock'), so mergeLlmResults never
    // promotes matter_type here — this exercises the LLM-unavailable
    // path specifically, NOT the normal outcome of a turn-two reply (see
    // file header correction). The guard's own discoveryCount === 0
    // condition also prevents it from firing twice regardless, so this
    // must finalize rather than loop even when reclassification does not
    // happen.
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

  it('turn two with live LLM classification: reclassifies away from unknown and continues discovery in the SAME turn (the normal, common-case path — added 2026-08-07 to lock in the corrected understanding)', async () => {
    // This is the field repro's actual outcome (screened_leads.6ff7d438-
    // 2eda-42b4-be43-758df2c89bb1, 2026-08-07): unlike the sibling test
    // above, here llmExtractServer returns a LIVE classification, exactly
    // as it does in production when the Gemini key is configured and the
    // call succeeds. mergeLlmResults promotes matter_type away from
    // 'unknown' (screen-engine/llm/extractor.ts, DR-069 ungated-unknown
    // path) BEFORE this Phase C block runs, so the F2 guard's own
    // condition (matter_type === 'unknown') is false and normal
    // discovery fires immediately — not a second describe-prompt, not a
    // finalize.
    mocks.llmExtractServer.mockResolvedValueOnce({
      mode: 'live',
      extracted: { __matter_type: 'business_setup_advisory' },
    });

    mocks.loadOpenChannelSession.mockResolvedValueOnce({
      id: 'session-uuid',
      firm_id: FIRM_ID,
      channel: 'whatsapp',
      sender_id: '16475492106',
      engine_state: {
        lead_id: 'L-test-unknown-turn-two-live',
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
      text: 'i have a business and i want to formalize it',
      sender: whatsappSender('Adriano'),
    });

    // Did NOT finalize with an empty brief, and did NOT re-send the
    // describe-your-situation ask again.
    expect(r.persisted).toBe(false);
    expect(mocks.insertPayload).toBeNull();
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).not.toMatch(/describe in a sentence or two/i);
    expect(sentText).toMatch(/\?/);

    // The persisted session shows the real matter type, not 'unknown'.
    const persistCall =
      mocks.updateChannelSession.mock.calls[0] ?? mocks.createChannelSession.mock.calls[0];
    const persistedState = (
      persistCall as unknown as Array<{ engineState: { matter_type: string } }>
    )[0].engineState;
    expect(persistedState.matter_type).toBe('business_setup_advisory');
  });
});
