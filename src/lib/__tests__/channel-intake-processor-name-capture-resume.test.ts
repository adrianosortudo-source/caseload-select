/**
 * Regression guard for the name-capture resume loop (#171, 2026-06-09).
 *
 * Field repro: after the minimum-discovery floor (#170) shipped, the
 * weak-profile-name path correctly triggered "What is your name?" on
 * resume turn 2. But the lead typed `"Adriano Domingues"` and the bot
 * asked the same question again. And again. And again. Infinite loop.
 *
 * Root cause: applyContactExtractionToState gates bare-name extraction
 * on email/phone in the same message. The lead's reply was a name
 * only. Neither applyContactExtractionToState nor applyFreeTextAnswerMapping
 * (which deliberately delegates contact slots upstream) caught the
 * reply. State stayed unchanged, getNextStep returned capture_contact
 * again, Phase C re-asked.
 *
 * Fix: nameCaptureContext flag on extractContactFromTurn lifts the
 * email/phone guard when the processor detects (via pre-extraction
 * getNextStep) that the engine intends to ask client_name on this
 * turn. The flag is plumbed from channel-intake-processor only on
 * resume turns to avoid false positives on turn-1 self-introductions
 * or casual matter descriptions.
 *
 * This test locks the contract: a name-only reply to a name-capture
 * ask DOES advance the conversation. The bot must NOT loop.
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
    lead_id: 'L-test-name-resume',
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
  createChannelSession: mocks.createChannelSession,
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
    messageMid: 'mid_name_resume',
    phoneNumberId: 'pn-1',
  };
}

/**
 * Build a resumed session AFTER the bot asked "What is your name?".
 * State has:
 *   - weak profile name (the trigger for capture_contact)
 *   - one substantive matter answer (the engine has asked discovery + name)
 *   - contactCaptureStarted=true
 *   - discoveryFollowUpCount=2 (1 = advisory_path, 2 = name ask)
 */
function nameAskedSession(opts: { matter_type: MatterType; profileName: string }) {
  return {
    id: 'session-uuid',
    firm_id: FIRM_ID,
    channel: 'whatsapp',
    sender_id: '16475492106',
    engine_state: {
      lead_id: 'L-test-name-resume',
      input: 'seed text',
      matter_type: opts.matter_type,
      practice_area: 'corporate',
      intent_family: 'setup_advisory',
      advisory_subtrack: 'unknown',
      slots: {
        client_name: opts.profileName,
        client_phone: '+16475492106',
        advisory_path: 'Starting a new business',
      },
      slot_meta: {
        client_name: { source: 'profile_metadata', confidence: 1.0 },
        client_phone: { source: 'system_metadata', confidence: 1.0 },
        advisory_path: { source: 'answered', confidence: 1.0 },
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
        input_length: 30,
      },
      confidence: 0,
      coreCompleteness: 0,
      answeredQuestionGroups: [],
      questionHistory: ['advisory_path'],
      insightShown: false,
      contactCaptureStarted: true,
      submitted_at: '2026-06-09T15:00:00.000Z',
      language: 'en',
      discoveryFollowUpCount: 2,
    } as unknown as EngineState,
    follow_up_count: 0,
    max_follow_ups: 3,
    finalized: false,
    expires_at: '2026-06-10T15:00:00.000Z',
    created_at: '2026-06-09T15:00:00.000Z',
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
  mocks.finalizeChannelSession.mockReset();
  mocks.finalizeChannelSession.mockResolvedValue(undefined);
  mocks.insertPayload = null;
  mocks.lastPersistedState = null;
});

describe('Name capture resume: bare-name reply advances the conversation', () => {
  it('reproduces and fixes the field bug: "Adriano Domingues" reply → next discovery question (not loop)', async () => {
    // Setup: bot asked "What is your name?". Weak profile name "A D".
    // Lead replies with a real name. The engine must accept the name
    // AND the processor must advance to the next discovery question on
    // the SAME webhook handling cycle so the lead sees forward motion.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      nameAskedSession({
        matter_type: 'business_setup_advisory' as MatterType,
        profileName: 'A D',
      }) as never,
    );

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'Adriano Domingues',
      sender: whatsappSender('A D'),
    });

    expect(r.persisted).toBe(false);
    expect(r.followUpSent).toBe(true);
    // The processor sent ONE message: the NEXT discovery question.
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    // The sent message MUST NOT be the name re-ask (the loop symptom).
    expect(sentText.toLowerCase()).not.toContain('what is your name');
    // It IS a substantive discovery question (matter-aware, ends in '?').
    expect(sentText).toMatch(/\?/);
    expect(sentText.length).toBeGreaterThan(20);

    // The persisted state has the captured name with an answered
    // provenance, not the original "A D" profile_metadata.
    const persisted = mocks.lastPersistedState as
      | { slots: Record<string, string>; slot_meta: Record<string, { source: string }> }
      | null;
    expect(persisted).toBeTruthy();
    expect(persisted!.slots.client_name).toBe('Adriano Domingues');
    expect(persisted!.slot_meta.client_name.source).toBe('explicit');
  });

  it('lowercase reply "adriano domingues" is title-cased and accepted', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      nameAskedSession({
        matter_type: 'business_setup_advisory' as MatterType,
        profileName: 'A D',
      }) as never,
    );

    await processChannelInbound({
      firmId: FIRM_ID,
      text: 'adriano domingues',
      sender: whatsappSender('A D'),
    });

    const persisted = mocks.lastPersistedState as
      | { slots: Record<string, string>; slot_meta: Record<string, { source: string }> }
      | null;
    expect(persisted!.slots.client_name).toBe('Adriano Domingues');
  });

  it('intro-phrase reply "my name is Adriano" is accepted', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      nameAskedSession({
        matter_type: 'business_setup_advisory' as MatterType,
        profileName: 'A D',
      }) as never,
    );

    await processChannelInbound({
      firmId: FIRM_ID,
      text: 'my name is Adriano',
      sender: whatsappSender('A D'),
    });

    const persisted = mocks.lastPersistedState as
      | { slots: Record<string, string>; slot_meta: Record<string, { source: string }> }
      | null;
    expect(persisted!.slots.client_name).toBe('Adriano');
  });

  it('weak/invalid reply ("A D" again) leaves client_name UNCHANGED so bot can re-ask', async () => {
    // Lead types "A D" in response to "What is your name?". That is
    // still weak. The processor must NOT promote it to a confirmed
    // identity; client_name stays as the original profile_metadata
    // value (or empty) so the next getNextStep re-issues capture_contact.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      nameAskedSession({
        matter_type: 'business_setup_advisory' as MatterType,
        profileName: 'A D',
      }) as never,
    );

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'A D',
      sender: whatsappSender('A D'),
    });

    expect(r.followUpSent).toBe(true);
    // The sent message is the name re-ask (engine still asks because
    // weak name was not promoted).
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText.toLowerCase()).toContain('what is your name');
  });

  it('garbage reply ("ok thanks") leaves client_name UNCHANGED', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      nameAskedSession({
        matter_type: 'business_setup_advisory' as MatterType,
        profileName: 'A D',
      }) as never,
    );

    await processChannelInbound({
      firmId: FIRM_ID,
      text: 'ok thanks',
      sender: whatsappSender('A D'),
    });

    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    // First token "ok" is in NAME_BLOCKLIST; the reply does not
    // promote client_name. Bot re-asks.
    expect(sentText.toLowerCase()).toContain('what is your name');
  });

  it('strong typed name OVERRIDES weak profile_metadata seed (source upgrade)', async () => {
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      nameAskedSession({
        matter_type: 'business_setup_advisory' as MatterType,
        profileName: 'A D',
      }) as never,
    );

    await processChannelInbound({
      firmId: FIRM_ID,
      text: 'Adriano Domingues',
      sender: whatsappSender('A D'),
    });

    const persisted = mocks.lastPersistedState as
      | { slots: Record<string, string>; slot_meta: Record<string, { source: string }> }
      | null;
    // Source upgraded from profile_metadata to explicit.
    expect(persisted!.slot_meta.client_name.source).toBe('explicit');
    // Value upgraded from "A D" to the real name.
    expect(persisted!.slots.client_name).toBe('Adriano Domingues');
  });

  it('name-capture turn does NOT corrupt other free_text slots (no false-positive into business_location etc)', async () => {
    // Defense-in-depth: even if applyFreeTextAnswerMapping would have
    // tried to consume "Adriano Domingues" into the next free_text
    // discovery slot, the short-circuit in the processor prevents it.
    mocks.loadOpenChannelSession.mockResolvedValueOnce(
      nameAskedSession({
        matter_type: 'business_setup_advisory' as MatterType,
        profileName: 'A D',
      }) as never,
    );

    await processChannelInbound({
      firmId: FIRM_ID,
      text: 'Adriano Domingues',
      sender: whatsappSender('A D'),
    });

    const persisted = mocks.lastPersistedState as
      | { slots: Record<string, string> }
      | null;
    // business_location is a free_text discovery slot that
    // applyFreeTextAnswerMapping could have falsely filled. Must be
    // empty.
    expect(persisted!.slots.business_location).toBeFalsy();
  });
});
