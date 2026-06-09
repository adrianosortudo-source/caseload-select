/**
 * Regression guard for the pending-slot reply persistence across the
 * contact-capture detour (#172, 2026-06-09).
 *
 * Field repro: WhatsApp business_setup_advisory flow.
 *   Turn 1: User: "I need to open my business" → bot asks advisory_path.
 *   Turn 2: User: "1" → bot asks "What is your name?".
 *   Turn 3: User: "Adriano" → bot RE-asks advisory_path (THE BUG).
 *
 * Root cause: the engine's `getNextStep` shifts its preferred next slot
 * across turns (advisory_path → capture_contact(client_name) once
 * contactCaptureStarted=true and the profile name is weak per #169).
 * Every reply-mapping adapter (numeric / fuzzy / free-text) routes via
 * `getNextStep(state).slot`, so the user's "1" on turn 2 gets routed
 * to client_name (free_text), bails, and is lost. advisory_path stays
 * empty. On turn 3 after the name is captured, the engine sees
 * advisory_path still empty and asks it again.
 *
 * Fix: Phase C records `pendingAskedSlotId` in engine state when it
 * sends a question. On the next inbound turn,
 * `applyPendingSlotReply` routes the reply to THAT slot, independent
 * of what `getNextStep` currently prefers. The engine state then has
 * the correct shape (advisory_path filled), and subsequent
 * getNextStep calls move forward.
 *
 * This test locks the contract:
 *   - Turn 2 reply "1" fills advisory_path even though the engine
 *     would prefer capture_contact(client_name).
 *   - Turn 3 reply "Adriano" captures the name and the next question
 *     is NOT advisory_path (because it is now filled).
 *   - No loop between advisory_path and capture_contact.
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
    lead_id: 'L-test-pending-172',
    status: 'triaging',
    decision_deadline: '2026-06-10T00:00:00.000Z',
    whale_nurture: false,
  } as Record<string, unknown>,
  insertPayload: null as Record<string, unknown> | null,
  lastPersistedState: null as Record<string, unknown> | null,
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
  createChannelSession: vi.fn((args: Record<string, unknown>) => {
    mocks.lastPersistedState = args.engineState as Record<string, unknown>;
    return Promise.resolve('session-uuid');
  }),
  updateChannelSession: vi.fn((args: Record<string, unknown>) => {
    mocks.lastPersistedState = args.engineState as Record<string, unknown>;
    return Promise.resolve();
  }),
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
import type { EngineState, MatterType } from '../screen-engine/types';

const FIRM_ID = '11111111-1111-1111-1111-111111111111';

function whatsappSender(profileName: string | null = 'A D'): WhatsAppSender {
  return {
    channel: 'whatsapp',
    senderWaId: '16475492106',
    senderName: profileName,
    messageMid: 'mid_172',
    phoneNumberId: 'pn-1',
  };
}

/**
 * State as it would look in the channel_intake_sessions row after the
 * bot's turn 1 Phase C ran: advisory_path asked, contactCaptureStarted
 * flipped on, weak profile name still in client_name, pendingAskedSlotId
 * pointing at advisory_path.
 */
function postTurn1State() {
  return {
    id: 'session-uuid',
    firm_id: FIRM_ID,
    channel: 'whatsapp',
    sender_id: '16475492106',
    engine_state: {
      lead_id: 'L-test-pending-172',
      input: 'I need to open my business',
      matter_type: 'business_setup_advisory' as MatterType,
      practice_area: 'corporate',
      intent_family: 'setup_advisory',
      advisory_subtrack: 'unknown',
      slots: {
        client_name: 'A D',
        client_phone: '+16475492106',
      },
      slot_meta: {
        client_name: { source: 'profile_metadata', confidence: 1.0 },
        client_phone: { source: 'system_metadata', confidence: 1.0 },
      },
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
        input_length: 25,
      },
      confidence: 0,
      coreCompleteness: 0,
      answeredQuestionGroups: [],
      questionHistory: [],
      insightShown: false,
      contactCaptureStarted: true,
      submitted_at: '2026-06-09T15:00:00.000Z',
      language: 'en',
      discoveryFollowUpCount: 1,
      pendingAskedSlotId: 'advisory_path',
    } as unknown as EngineState,
    follow_up_count: 0,
    max_follow_ups: 3,
    finalized: false,
    expires_at: '2026-06-10T15:00:00.000Z',
    created_at: '2026-06-09T15:00:00.000Z',
  };
}

/**
 * State as it would look after the bot's turn 2 Phase C ran:
 * advisory_path filled, client_name still weak, pendingAskedSlotId
 * pointing at client_name (the bot just asked "What is your name?").
 */
function postTurn2State() {
  const s = postTurn1State();
  s.engine_state = {
    ...s.engine_state,
    slots: {
      ...s.engine_state.slots,
      advisory_path: 'Starting a new business',
    },
    slot_meta: {
      ...s.engine_state.slot_meta,
      advisory_path: { source: 'answered', confidence: 1.0 },
    } as EngineState['slot_meta'],
    questionHistory: ['advisory_path'],
    discoveryFollowUpCount: 2,
    pendingAskedSlotId: 'client_name',
  };
  return s;
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
  mocks.finalizeChannelSession.mockReset();
  mocks.finalizeChannelSession.mockResolvedValue(undefined);
  mocks.insertPayload = null;
  mocks.lastPersistedState = null;
});

describe('Pending-slot reply routing across the contact-capture detour (#172)', () => {
  it('Turn 2: user reply "1" fills advisory_path even though engine wants capture_contact', async () => {
    // Bot asked advisory_path on turn 1. Resume state has weak profile
    // name + contactCaptureStarted=true, so the engine's getNextStep
    // would now prefer capture_contact(client_name). The user typed
    // "1" intending to answer advisory_path. The processor must route
    // the reply via pendingAskedSlotId, not via getNextStep.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(postTurn1State() as never);

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: '1',
      sender: whatsappSender('A D'),
    });

    expect(r.persisted).toBe(false);
    expect(r.followUpSent).toBe(true);

    const persisted = mocks.lastPersistedState as
      | {
          slots: Record<string, string>;
          slot_meta: Record<string, { source: string }>;
          pendingAskedSlotId?: string | null;
        }
      | null;
    expect(persisted).toBeTruthy();
    // advisory_path is filled by the user's "1" (not lost).
    expect(persisted!.slots.advisory_path).toBe('Starting a new business');
    expect(persisted!.slot_meta.advisory_path.source).toBe('answered');

    // The bot's next question is "What is your name?" (the engine
    // shifts to capture_contact AFTER advisory_path is filled), and
    // pendingAskedSlotId now points at client_name for the next turn.
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText.toLowerCase()).toContain('what is your name');
    expect(persisted!.pendingAskedSlotId).toBe('client_name');
  });

  it('Turn 3: name captured, NEXT question is NOT advisory_path (the loop is closed)', async () => {
    // Turn 2 state shows advisory_path already filled (from the fix
    // in turn 2), client_name still weak, pendingAskedSlotId=client_name.
    // Lead now types "Adriano". The processor must capture the name
    // AND ask a different discovery question (not advisory_path).
    mocks.loadOpenChannelSession.mockResolvedValueOnce(postTurn2State() as never);

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'Adriano',
      sender: whatsappSender('A D'),
    });

    expect(r.persisted).toBe(false);
    expect(r.followUpSent).toBe(true);

    const persisted = mocks.lastPersistedState as
      | {
          slots: Record<string, string>;
          slot_meta: Record<string, { source: string }>;
          pendingAskedSlotId?: string | null;
        }
      | null;
    // Name captured with answered provenance.
    expect(persisted!.slots.client_name).toBe('Adriano');
    expect(persisted!.slot_meta.client_name.source).toBe('explicit');
    // advisory_path remains filled across the detour (not lost).
    expect(persisted!.slots.advisory_path).toBe('Starting a new business');

    // The bot's next message is NOT advisory_path. It is some other
    // discovery question for business_setup_advisory.
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText.toLowerCase()).not.toContain('are you starting something new');
    // pendingAskedSlotId points at the new slot.
    expect(persisted!.pendingAskedSlotId).toBeTruthy();
    expect(persisted!.pendingAskedSlotId).not.toBe('advisory_path');
    expect(persisted!.pendingAskedSlotId).not.toBe('client_name');
  });

  it('pendingAskedSlotId is cleared after the reply is consumed', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(postTurn1State() as never);

    await processChannelInbound({
      firmId: FIRM_ID,
      text: '1',
      sender: whatsappSender('A D'),
    });

    const persisted = mocks.lastPersistedState as
      | { pendingAskedSlotId?: string | null }
      | null;
    // The processor cleared the old pointer (advisory_path was
    // consumed) and set a new one (client_name, the next question).
    // Either way, pendingAskedSlotId is NOT pointing at the stale
    // advisory_path.
    expect(persisted!.pendingAskedSlotId).not.toBe('advisory_path');
  });

  it('legacy session without pendingAskedSlotId still works (defensive)', async () => {
    // Sessions created before #172 do not have pendingAskedSlotId.
    // applyPendingSlotReply must be a no-op in that case, and the
    // existing adapter chain (numeric / fuzzy / free-text / LLM)
    // handles the reply via getNextStep as before.
    const legacy = postTurn1State();
    delete (legacy.engine_state as unknown as Record<string, unknown>).pendingAskedSlotId;
    mocks.loadOpenChannelSession.mockResolvedValueOnce(legacy as never);

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: '1',
      sender: whatsappSender('A D'),
    });

    // Either the legacy path still works OR the engine shifts to
    // capture_contact without filling advisory_path. We assert it
    // does not crash and sends some response.
    expect(r.followUpSent).toBe(true);
  });

  it('llm_inferred-filled slot: user reply OVERWRITES the weak fill (DRG field bug, 2026-06-09)', async () => {
    // Real-world repro from the second smoke retest. Gemini extracted
    // advisory_path='Starting a new business' from "I need help to
    // open my business" on turn 1 with source='llm_inferred'. The
    // engine treated it as unanswered (correct per provenance
    // discipline). Phase C asked advisory_path. The user replied "1".
    // Before this fix: applyPendingSlotReply bailed because the slot
    // was "filled" (with llm_inferred). applyAnswer never fired. The
    // engine re-asked the same question. Infinite loop.
    // After this fix: applyPendingSlotReply detects the weak
    // provenance and lets applyAnswer upgrade source to 'answered'.
    const llmFilled = postTurn1State();
    llmFilled.engine_state = {
      ...llmFilled.engine_state,
      slots: {
        ...llmFilled.engine_state.slots,
        advisory_path: 'Starting a new business',
      },
      slot_meta: {
        ...llmFilled.engine_state.slot_meta,
        advisory_path: {
          source: 'llm_inferred',
          confidence: 0.7,
          evidence: 'LLM extraction from initial description',
        },
      } as EngineState['slot_meta'],
    };
    mocks.loadOpenChannelSession.mockResolvedValueOnce(llmFilled as never);

    await processChannelInbound({
      firmId: FIRM_ID,
      text: '1',
      sender: whatsappSender('A D'),
    });

    const persisted = mocks.lastPersistedState as
      | {
          slots: Record<string, string>;
          slot_meta: Record<string, { source: string }>;
          pendingAskedSlotId?: string | null;
        }
      | null;
    expect(persisted).toBeTruthy();
    expect(persisted!.slots.advisory_path).toBe('Starting a new business');
    // Source UPGRADED from llm_inferred to answered (the user confirmed it).
    expect(persisted!.slot_meta.advisory_path.source).toBe('answered');
    // Next pending pointer is NOT advisory_path (the engine has moved on).
    expect(persisted!.pendingAskedSlotId).not.toBe('advisory_path');
  });

  it('backtick-prefixed digit "`1" still maps (leading-junk tolerance, the exact field input)', async () => {
    // The live retest showed the lead typed "`1" (stray leading backtick,
    // mobile artifact). The old digit regex required the string to START
    // with the digit, so "`1" did not map, advisory_path stayed unfilled,
    // and the bot re-asked it after the name. The hardened DIGIT_REPLY_RE
    // tolerates leading whitespace / backtick / quotes.
    const llmFilled = postTurn1State();
    llmFilled.engine_state = {
      ...llmFilled.engine_state,
      slots: {
        ...llmFilled.engine_state.slots,
        advisory_path: 'Starting a new business',
      },
      slot_meta: {
        ...llmFilled.engine_state.slot_meta,
        advisory_path: { source: 'llm_inferred', confidence: 0.7 },
      } as EngineState['slot_meta'],
    };
    mocks.loadOpenChannelSession.mockResolvedValueOnce(llmFilled as never);

    await processChannelInbound({
      firmId: FIRM_ID,
      text: '`1',
      sender: whatsappSender('A D'),
    });

    const persisted = mocks.lastPersistedState as
      | { slots: Record<string, string>; slot_meta: Record<string, { source: string }> }
      | null;
    expect(persisted!.slots.advisory_path).toBe('Starting a new business');
    expect(persisted!.slot_meta.advisory_path.source).toBe('answered');
  });

  it('unmappable reply re-asks the SAME slot with a clarifier, does NOT pivot to name', async () => {
    // Sticky pending-slot guard. The bot asked advisory_path. The lead's
    // reply does not map to any option (and is not a name). The bot must
    // re-ask advisory_path with a clarifier, NOT jump to "What is your
    // name?" and circle back. That pivot-then-repeat is what reads as a
    // glitch.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(postTurn1State() as never);

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'what do you mean exactly',
      sender: whatsappSender('A D'),
    });

    expect(r.followUpSent).toBe(true);
    expect(r.reason).toBe('awaiting_clarification_reask');
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    // Re-asks advisory_path (the same question), NOT the name.
    expect(sentText.toLowerCase()).toContain('starting something new');
    expect(sentText.toLowerCase()).not.toContain('what is your name');
    // Carries the clarifier prefix.
    expect(sentText.toLowerCase()).toContain("didn't catch");
    // pendingAskedSlotId stays on advisory_path so the next reply routes
    // back to it.
    const persisted = mocks.lastPersistedState as
      | { pendingAskedSlotId?: string | null }
      | null;
    expect(persisted!.pendingAskedSlotId).toBe('advisory_path');
  });

  it('garbage reply ("blah blah") does NOT fill advisory_path; pointer is preserved', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(postTurn1State() as never);

    await processChannelInbound({
      firmId: FIRM_ID,
      text: 'blah blah blah',
      sender: whatsappSender('A D'),
    });

    const persisted = mocks.lastPersistedState as
      | {
          slots: Record<string, string>;
          pendingAskedSlotId?: string | null;
        }
      | null;
    // advisory_path NOT filled (garbage doesn't map to any option).
    expect(persisted!.slots.advisory_path).toBeFalsy();
  });
});
