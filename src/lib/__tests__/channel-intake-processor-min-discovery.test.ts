/**
 * Minimum-discovery floor guard for async lead intake (#170, 2026-06-08).
 *
 * Field repro: a WhatsApp lead said "I need to open my business in
 * canada", answered ONE qualifier ("Starting a new business"), and
 * the bot finalized. Single user-answered substantive fact ≠ usable
 * brief. The structural fix: the channel processor enforces a
 * minimum discovery floor before allowing finalize on async channels,
 * regardless of what the engine's stopping rule says.
 *
 * This test locks the contract: business_setup_advisory / contract_
 * dispute / will_drafting MUST NOT finalize after a single substantive
 * answer; they MUST ask a deeper question. Exception matters
 * (out_of_scope) MAY finalize early as today.
 *
 * Provenance discipline (also locked here):
 *  - LLM-inferred values do NOT count toward the floor (lead never
 *    confirmed them; counts would let the engine green-light finalize
 *    on Gemini hints alone).
 *  - profile_metadata client_name does NOT count toward the floor
 *    (matches #169: profile leak is not identity).
 *  - system_metadata client_phone does NOT count toward the floor
 *    (reachability ≠ discovery depth).
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
    lead_id: 'L-test-floor-1',
    status: 'triaging',
    decision_deadline: '2026-06-09T00:00:00.000Z',
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
import type { EngineState, MatterType, SupportedLanguage } from '../screen-engine/types';

const FIRM_ID = '11111111-1111-1111-1111-111111111111';

function whatsappSender(profileName: string | null = 'Adriano Domingues'): WhatsAppSender {
  return {
    channel: 'whatsapp',
    senderWaId: '16475492106',
    senderName: profileName,
    messageMid: 'mid_floor',
    phoneNumberId: 'pn-1',
  };
}

/**
 * Build a resumed session fixture for a (matter, answered slots) shape.
 * The session has contactCaptureStarted=true (post turn 1) and the
 * supplied substantive slots already user-answered.
 */
function resumedSession(opts: {
  matter_type: MatterType;
  answeredSlots: Record<string, string>;
  profileName?: string;
  language?: SupportedLanguage;
  discoveryFollowUpCount?: number;
}) {
  const slot_meta: Record<string, { source: string; confidence: number }> = {
    client_name: { source: 'profile_metadata', confidence: 1.0 },
    client_phone: { source: 'system_metadata', confidence: 1.0 },
  };
  for (const slotId of Object.keys(opts.answeredSlots)) {
    slot_meta[slotId] = { source: 'answered', confidence: 1.0 };
  }
  return {
    id: 'session-uuid',
    firm_id: FIRM_ID,
    channel: 'whatsapp',
    sender_id: '16475492106',
    engine_state: {
      lead_id: 'L-test-floor',
      input: 'seed text',
      matter_type: opts.matter_type,
      practice_area: 'corporate',
      intent_family: 'setup_advisory',
      advisory_subtrack: 'unknown',
      slots: {
        client_name: opts.profileName ?? 'Adriano Domingues',
        client_phone: '+16475492106',
        ...opts.answeredSlots,
      },
      slot_meta,
      slot_evidence: {},
      raw: {
        mentions_urgency: false,
        mentions_money: false,
        mentions_access: false,
        mentions_ownership: false,
        mentions_documents: false,
        mentions_payment: false,
        mentions_agreement: false,
        mentions_vendor: false,
        mentions_fraud: false,
        mentions_property: false,
        mentions_closing: false,
        mentions_lease: false,
        mentions_construction: false,
        mentions_mortgage: false,
        mentions_preconstruction: false,
        input_length: 30,
      },
      confidence: 0,
      coreCompleteness: 0,
      answeredQuestionGroups: [],
      questionHistory: Object.keys(opts.answeredSlots),
      insightShown: false,
      contactCaptureStarted: true,
      lead_id_secondary: undefined,
      submitted_at: '2026-06-08T18:00:00.000Z',
      language: opts.language ?? 'en',
      discoveryFollowUpCount: opts.discoveryFollowUpCount ?? 1,
    } as unknown as EngineState,
    follow_up_count: 0,
    max_follow_ups: 3,
    finalized: false,
    expires_at: '2026-06-09T18:00:00.000Z',
    created_at: '2026-06-08T18:00:00.000Z',
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

describe('Minimum discovery floor: launch lanes do NOT finalize after 1 answer', () => {
  it('business_setup_advisory: 1 substantive answer + strong name → asks deeper, does not finalize', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      resumedSession({
        matter_type: 'business_setup_advisory' as MatterType,
        answeredSlots: { advisory_path: 'Starting a new business' },
        profileName: 'Adriano Domingues',
      }) as never,
    );

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'something more about my business',
      sender: whatsappSender('Adriano Domingues'),
    });

    expect(r.persisted).toBe(false);
    expect(r.followUpSent).toBe(true);
    expect(['awaiting_discovery_answer', 'awaiting_floor_discovery']).toContain(r.reason);
    expect(mocks.sendChannelMessage).toHaveBeenCalled();
  });

  it('business_setup_advisory: 1 substantive answer + WEAK profile name → asks for name (capture_contact path)', async () => {
    // The exact field repro: profile name "A D" + 1 substantive answer.
    // Engine returns capture_contact via #169; processor now honors it
    // instead of treating it as finalize.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      resumedSession({
        matter_type: 'business_setup_advisory' as MatterType,
        answeredSlots: { advisory_path: 'Starting a new business' },
        profileName: 'A D',
      }) as never,
    );

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: '1',
      sender: whatsappSender('A D'),
    });

    expect(r.persisted).toBe(false);
    expect(r.reason).toBe('awaiting_contact_capture');
    expect(r.followUpSent).toBe(true);
  });

  it('contract_dispute: 1 substantive answer + strong name → asks deeper', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      resumedSession({
        matter_type: 'contract_dispute' as MatterType,
        answeredSlots: { written_terms: 'Yes' },
        profileName: 'Adriano Domingues',
      }) as never,
    );

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: '1',
      sender: whatsappSender('Adriano Domingues'),
    });

    expect(r.persisted).toBe(false);
    expect(r.followUpSent).toBe(true);
    expect(['awaiting_discovery_answer', 'awaiting_floor_discovery']).toContain(r.reason);
  });

  it('will_drafting: 1 substantive answer + strong name → asks deeper', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      resumedSession({
        matter_type: 'will_drafting' as MatterType,
        answeredSlots: { existing_will_status: 'No, I have never had one' },
        profileName: 'Adriano Domingues',
      }) as never,
    );

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: '1',
      sender: whatsappSender('Adriano Domingues'),
    });

    expect(r.persisted).toBe(false);
    expect(r.followUpSent).toBe(true);
    expect(['awaiting_discovery_answer', 'awaiting_floor_discovery']).toContain(r.reason);
  });

  it('out_of_scope: 0 substantive answers → MAY finalize (exception)', async () => {
    // Exception matters never need the floor: the engine has classified
    // the matter as outside the firm's practice, and the lawyer reviews
    // and refers. No point asking more discovery.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      resumedSession({
        matter_type: 'out_of_scope' as MatterType,
        answeredSlots: {},
        profileName: 'Adriano Domingues',
      }) as never,
    );

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'family law question',
      sender: whatsappSender('Adriano Domingues'),
    });

    // The processor finalizes (out_of_scope bypasses the discovery
    // phase entirely via inDiscoveryPhase=false; the floor doesn't
    // even apply since the matter is on the EARLY_FINALIZE_MATTERS
    // exception list).
    expect(r.persisted).toBe(true);
  });
});

describe('Floor counts only substantive user-answered facts', () => {
  it('business_setup_advisory: floor NOT met when only client fields + 1 answer', async () => {
    // client_name (profile_metadata) and client_phone (system_metadata)
    // are excluded from the floor. Only advisory_path is substantive.
    // 1 substantive < 3 → floor not met → keep asking.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      resumedSession({
        matter_type: 'business_setup_advisory' as MatterType,
        answeredSlots: { advisory_path: 'Starting a new business' },
        profileName: 'Adriano Domingues',
      }) as never,
    );

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: '1',
      sender: whatsappSender('Adriano Domingues'),
    });

    expect(r.persisted).toBe(false);
    expect(r.followUpSent).toBe(true);
  });

  it('business_setup_advisory: floor met after 3 substantive answers from the candidate set', async () => {
    // 3 user-answered slots from the business_setup_advisory candidate
    // set (advisory_path, business_activity_type, hiring_timeline) →
    // floor met → engine's stop signal is honored if returned.
    // (selectNextSlot may still return continue if there's a high-
    // priority slot the engine wants to ask; that's also acceptable
    // behavior. We only assert the floor predicate via the helper.)
    const { meetsDiscoveryFloor } = await import('../discovery-floor');
    const state = resumedSession({
      matter_type: 'business_setup_advisory' as MatterType,
      answeredSlots: {
        advisory_path: 'Starting a new business',
        business_activity_type: 'Professional services',
        hiring_timeline: 'Within the next 30 days',
      },
      profileName: 'Adriano Domingues',
    }).engine_state;
    expect(meetsDiscoveryFloor(state)).toBe(true);
  });

  it('floor predicate: LLM-inferred slots do NOT count', async () => {
    const { meetsDiscoveryFloor } = await import('../discovery-floor');
    const state = resumedSession({
      matter_type: 'business_setup_advisory' as MatterType,
      answeredSlots: {},
      profileName: 'Adriano Domingues',
    }).engine_state;
    // Manually attach 5 llm_inferred slots; floor should still be unmet.
    state.slots.advisory_path = 'Starting a new business';
    state.slots.business_activity_type = 'Professional services';
    state.slots.co_owner_count = 'Just me';
    state.slots.advisory_concern = 'Knowing what kind of company to set up';
    state.slots.hiring_timeline = 'Now (this week)';
    for (const k of [
      'advisory_path',
      'business_activity_type',
      'co_owner_count',
      'advisory_concern',
      'hiring_timeline',
    ]) {
      state.slot_meta[k] = { source: 'llm_inferred' as never, confidence: 0.8 };
    }
    expect(meetsDiscoveryFloor(state)).toBe(false);
  });

  it('floor predicate: profile_metadata client_name does NOT count toward floor', async () => {
    const { meetsDiscoveryFloor } = await import('../discovery-floor');
    const state = resumedSession({
      matter_type: 'business_setup_advisory' as MatterType,
      answeredSlots: { advisory_path: 'Starting a new business' },
      profileName: 'Adriano Domingues',
    }).engine_state;
    // client_name is strong profile_metadata, advisory_path is answered.
    // Only advisory_path counts (1 substantive); floor not met.
    expect(meetsDiscoveryFloor(state)).toBe(false);
  });

  it('floor predicate: system_metadata client_phone does NOT count toward floor', async () => {
    const { meetsDiscoveryFloor } = await import('../discovery-floor');
    const state = resumedSession({
      matter_type: 'contract_dispute' as MatterType,
      answeredSlots: { written_terms: 'Yes' },
      profileName: 'Adriano Domingues',
    }).engine_state;
    // client_phone is system_metadata (carrier reachability), written_terms
    // is the only substantive answer. Floor not met.
    expect(meetsDiscoveryFloor(state)).toBe(false);
  });

  it('floor predicate: out_of_scope passes regardless of slot count', async () => {
    const { meetsDiscoveryFloor } = await import('../discovery-floor');
    const state = resumedSession({
      matter_type: 'out_of_scope' as MatterType,
      answeredSlots: {},
      profileName: 'Adriano Domingues',
    }).engine_state;
    expect(meetsDiscoveryFloor(state)).toBe(true);
  });

  it('floor predicate: unknown matter passes regardless (cannot ask matter-specific)', async () => {
    const { meetsDiscoveryFloor } = await import('../discovery-floor');
    const state = resumedSession({
      matter_type: 'unknown' as MatterType,
      answeredSlots: {},
      profileName: 'Adriano Domingues',
    }).engine_state;
    expect(meetsDiscoveryFloor(state)).toBe(true);
  });
});

describe('Floor probe: next question chosen for each launch lane after 1 answer', () => {
  // Diagnostic test that captures the actual question text the
  // processor sends on the second turn for each lane. Confirms the
  // floor is producing coherent deeper discovery, not just blocking
  // finalize.

  async function probeNextQuestion(opts: {
    matter_type: MatterType;
    firstAnswerSlot: string;
    firstAnswerValue: string;
  }): Promise<string> {
    mocks.sendChannelMessage.mockReset();
    mocks.sendChannelMessage.mockResolvedValue({ sent: true, messageId: 'mid_out' });
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      resumedSession({
        matter_type: opts.matter_type,
        answeredSlots: { [opts.firstAnswerSlot]: opts.firstAnswerValue },
        profileName: 'Adriano Domingues',
      }) as never,
    );

    await processChannelInbound({
      firmId: FIRM_ID,
      text: '1',
      sender: whatsappSender('Adriano Domingues'),
    });

    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    return mocks.sendChannelMessage.mock.calls[0][0].text as string;
  }

  it('business_setup_advisory after advisory_path → second question is substantive', async () => {
    const next = await probeNextQuestion({
      matter_type: 'business_setup_advisory' as MatterType,
      firstAnswerSlot: 'advisory_path',
      firstAnswerValue: 'Starting a new business',
    });
    // Probe: log the actual question so the operator can read it in
    // the test output.
    console.log('[probe] business_setup_advisory next question:', JSON.stringify(next));
    // Asserts shape, not exact wording (slot priorities may evolve).
    expect(next.length).toBeGreaterThan(20);
    expect(next).toMatch(/\?/);
  });

  it('contract_dispute after written_terms → second question is substantive', async () => {
    const next = await probeNextQuestion({
      matter_type: 'contract_dispute' as MatterType,
      firstAnswerSlot: 'written_terms',
      firstAnswerValue: 'Yes',
    });
    console.log('[probe] contract_dispute next question:', JSON.stringify(next));
    expect(next.length).toBeGreaterThan(20);
    expect(next).toMatch(/\?/);
  });

  it('will_drafting after existing_will_status → second question is substantive', async () => {
    const next = await probeNextQuestion({
      matter_type: 'will_drafting' as MatterType,
      firstAnswerSlot: 'existing_will_status',
      firstAnswerValue: 'No, I have never had one',
    });
    console.log('[probe] will_drafting next question:', JSON.stringify(next));
    expect(next.length).toBeGreaterThan(20);
    expect(next).toMatch(/\?/);
  });
});
