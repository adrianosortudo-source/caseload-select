/**
 * C3 (2026-08-07): LLM option-mapping fallback for off-list replies to a
 * numbered (single_select) question.
 *
 * Uses `advisory_path` (screen-engine/slotRegistry.ts) as the real
 * pending slot under test: tier 'core' (not contact), input_type
 * 'single_select', applies_to business_setup_advisory, four real options.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  sendChannelMessage: vi.fn(),
  llmExtractServer: vi.fn(() => Promise.resolve({ mode: 'mock', extracted: {} })),
  llmMapOptionReply: vi.fn(),
  renderBriefHtmlServer: vi.fn(() => '<div class="brief">brief</div>'),
  notifyLawyersOfNewLead: vi.fn(() => Promise.resolve()),
  loadOpenChannelSession: vi.fn(() => Promise.resolve(null)),
  createChannelSession: vi.fn(() => Promise.resolve('session-uuid')),
  updateChannelSession: vi.fn(() => Promise.resolve()),
  finalizeChannelSession: vi.fn(() => Promise.resolve()),
  persistUnconfirmedInquiry: vi.fn(() => Promise.resolve()),
  insertedRow: {
    id: 'row-uuid',
    lead_id: 'L-test-optionmap',
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

vi.mock('@/lib/llm-option-map', () => ({
  llmMapOptionReply: mocks.llmMapOptionReply,
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
    messageMid: 'mid_optionmap',
    phoneNumberId: 'pn-1',
  };
}

/** Resumed session with advisory_path pending (the bot just asked it). */
function advisoryPathPendingSession() {
  return {
    id: 'session-uuid',
    firm_id: FIRM_ID,
    channel: 'whatsapp',
    sender_id: '16475492106',
    engine_state: {
      lead_id: 'L-test-optionmap',
      input: 'i have a business and i want to formalize it',
      matter_type: 'business_setup_advisory',
      practice_area: 'corporate',
      intent_family: 'setup_advisory',
      advisory_subtrack: 'unknown',
      slots: {
        client_name: 'Adriano',
        client_phone: '+16475492106',
      },
      slot_meta: {
        client_name: { source: 'answered', confidence: 1.0 },
        client_phone: { source: 'system_metadata', confidence: 1.0 },
      },
      slot_evidence: {},
      raw: {
        mentions_urgency: false, mentions_money: false, mentions_access: false,
        mentions_ownership: false, mentions_documents: false, mentions_payment: false,
        mentions_agreement: false, mentions_vendor: false, mentions_fraud: false,
        mentions_property: false, mentions_closing: false, mentions_lease: false,
        mentions_construction: false, mentions_mortgage: false,
        mentions_preconstruction: false, input_length: 40,
      },
      confidence: 0,
      coreCompleteness: 0,
      answeredQuestionGroups: [],
      questionHistory: ['advisory_path'],
      insightShown: false,
      contactCaptureStarted: true,
      pendingAskedSlotId: 'advisory_path',
      submitted_at: '2026-08-07T00:00:00.000Z',
      language: 'en',
      discoveryFollowUpCount: 1,
    },
    follow_up_count: 0,
    max_follow_ups: 3,
    finalized: false,
    expires_at: '2026-08-08T00:00:00.000Z',
    created_at: '2026-08-07T00:00:00.000Z',
  };
}

beforeEach(() => {
  mocks.sendChannelMessage.mockReset();
  mocks.sendChannelMessage.mockResolvedValue({ sent: true, messageId: 'mid_out' });
  mocks.llmExtractServer.mockReset();
  mocks.llmExtractServer.mockResolvedValue({ mode: 'mock', extracted: {} });
  mocks.llmMapOptionReply.mockReset();
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

describe('LLM option-mapping fallback for off-list replies (C3)', () => {
  it('mapped: an off-list reply that clearly selects an option is applied with answered provenance; llmExtractServer is skipped; a NEW question is sent', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(advisoryPathPendingSession() as never);
    mocks.llmMapOptionReply.mockResolvedValueOnce({
      value: 'Starting a new business',
      mode: 'live',
    });

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'yeah just getting it off the ground from scratch',
      sender: whatsappSender('Adriano'),
    });

    expect(mocks.llmMapOptionReply).toHaveBeenCalledTimes(1);
    const callArgs = mocks.llmMapOptionReply.mock.calls[0][0];
    expect(callArgs.questionLabel).toBe(
      'Are you starting something new, or buying into an existing business?',
    );
    expect(callArgs.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'Starting a new business' }),
      ]),
    );

    // The mapped answer means llmExtractServer is not needed this turn.
    expect(mocks.llmExtractServer).not.toHaveBeenCalled();

    // NOT the clarifier ("I want to make sure I record this correctly").
    expect(r.followUpSent).toBe(true);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).not.toContain('make sure I record this correctly');

    const persistCall =
      mocks.updateChannelSession.mock.calls[0] ?? mocks.createChannelSession.mock.calls[0];
    const persistedState = (
      persistCall as unknown as Array<{
        engineState: {
          slots: Record<string, string>;
          slot_meta: Record<string, { source: string }>;
          pendingAskedSlotId: string | null;
        };
      }>
    )[0].engineState;
    expect(persistedState.slots.advisory_path).toBe('Starting a new business');
    expect(persistedState.slot_meta.advisory_path.source).toBe('answered');
    // The pointer moved to the NEW question the engine asked next, not
    // left dangling on advisory_path.
    expect(persistedState.pendingAskedSlotId).not.toBe('advisory_path');
  });

  it('null: LLM cannot confidently map the reply; falls through to the sticky clarifier with the softened copy; pointer retained', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(advisoryPathPendingSession() as never);
    mocks.llmMapOptionReply.mockResolvedValueOnce({ value: null, mode: 'live' });

    await processChannelInbound({
      firmId: FIRM_ID,
      text: 'not sure what you mean by that question',
      sender: whatsappSender('Adriano'),
    });

    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).toContain('make sure I record this correctly');
    expect(sentText).toContain('Are you starting something new');

    const persistCall =
      mocks.updateChannelSession.mock.calls[0] ?? mocks.createChannelSession.mock.calls[0];
    const persistedState = (
      persistCall as unknown as Array<{ engineState: { pendingAskedSlotId: string | null } }>
    )[0].engineState;
    expect(persistedState.pendingAskedSlotId).toBe('advisory_path');
  });

  it('error/disabled: helper failure never crashes the turn, behaves identically to null', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(advisoryPathPendingSession() as never);
    mocks.llmMapOptionReply.mockResolvedValueOnce({ value: null, mode: 'error' });

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'hmm',
      sender: whatsappSender('Adriano'),
    });

    expect(r.followUpSent).toBe(true);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText).toContain('make sure I record this correctly');
  });

  it('membership guard: a value the LLM returns that is NOT one of the slot\'s real options is treated as null, never reaches applyAnswer', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(advisoryPathPendingSession() as never);
    // Invented value, not in advisory_path's option list.
    mocks.llmMapOptionReply.mockResolvedValueOnce({
      value: 'Something the model made up',
      mode: 'live',
    });

    await processChannelInbound({
      firmId: FIRM_ID,
      text: 'whatever the situation is',
      sender: whatsappSender('Adriano'),
    });

    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    // Falls through to the clarifier exactly as a null response would.
    expect(sentText).toContain('make sure I record this correctly');

    const persistCall =
      mocks.updateChannelSession.mock.calls[0] ?? mocks.createChannelSession.mock.calls[0];
    const persistedState = (
      persistCall as unknown as Array<{
        engineState: { slots: Record<string, string>; pendingAskedSlotId: string | null };
      }>
    )[0].engineState;
    expect(persistedState.slots.advisory_path).toBeUndefined();
    expect(persistedState.pendingAskedSlotId).toBe('advisory_path');
  });

  it('does not fire when the reply already resolved via a deterministic matcher (numeric option)', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(advisoryPathPendingSession() as never);

    await processChannelInbound({
      firmId: FIRM_ID,
      text: '1',
      sender: whatsappSender('Adriano'),
    });

    // Numeric mapping resolves "1" deterministically; the LLM fallback
    // must never be invoked when isUserGroundedFill already returns true.
    expect(mocks.llmMapOptionReply).not.toHaveBeenCalled();
  });
});
