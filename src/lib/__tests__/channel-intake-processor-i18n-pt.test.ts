/**
 * processChannelInbound PT propagation guard (2026-06-08).
 *
 * Reproduces the DRG WhatsApp PT smoke test:
 *   Inbound:  "quero abrir minha empresa no canada"
 *   Expected: state.language='pt' AND the discovery question sent back
 *             to WhatsApp is in Portuguese, not English.
 *
 * The bug before today's fix was three-layered (see
 * `screen-engine/__tests__/i18n-question-propagation.test.ts` for the
 * unit coverage). This file locks the END-TO-END propagation through
 * `processChannelInbound`: the LLM's `__detected_language` flows into
 * `state.language`, which is then passed to `formatDiscoveryQuestion`,
 * which routes through the i18n helpers to produce a PT outbound
 * message.
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
    lead_id: 'L-test-pt-1',
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

const FIRM_ID = '11111111-1111-1111-1111-111111111111';

function whatsappSender(): WhatsAppSender {
  return {
    channel: 'whatsapp',
    senderWaId: '16475492106',
    senderName: 'Adriano',
    messageMid: 'mid_pt',
    phoneNumberId: 'pn-1',
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

describe('processChannelInbound: Portuguese intake propagates to outbound', () => {
  it('PT opener produces a PT discovery question on the WhatsApp send', async () => {
    // LLM mirrors what Gemini would return for the PT opener: matter
    // classified as business_setup_advisory + language detected as 'pt'.
    mocks.llmExtractServer.mockResolvedValueOnce({
      mode: 'live',
      extracted: {
        __matter_type: 'business_setup_advisory',
        __detected_language: 'pt',
      },
    });

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'quero abrir minha empresa no canada',
      sender: whatsappSender(),
    });

    // Phase C should have sent a discovery question (not finalised the brief).
    expect(r.persisted).toBe(false);
    expect(r.reason).toBe('awaiting_discovery_answer');
    expect(r.followUpSent).toBe(true);

    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;

    // The first business_setup_advisory slot the engine asks is
    // advisory_path. The PT translation MUST surface, not the English.
    expect(sentText).toContain('Você está abrindo um novo negócio');
    expect(sentText).not.toContain('Are you starting something new');

    // The numbered option labels MUST also be PT.
    expect(sentText).toContain('1. Abrindo um novo negócio');
    expect(sentText).toContain('2. Comprando participação em uma empresa existente');
    expect(sentText).toContain('3. Não tenho certeza');

    // Negative: no leakage of the English option labels.
    expect(sentText).not.toContain('1. Starting a new business');
    expect(sentText).not.toContain('2. Buying into an existing business');
  });

  it('EN opener still produces an EN discovery question (no regression)', async () => {
    // Baseline: English leads keep getting English copy. The specific
    // slot asked depends on which slots the EN regex auto-resolves on
    // turn 1, so the assertion focuses on the language posture: no
    // PT strings leak in.
    mocks.llmExtractServer.mockResolvedValueOnce({
      mode: 'live',
      extracted: {
        __matter_type: 'business_setup_advisory',
        __detected_language: 'en',
      },
    });

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'i want to start a business in canada',
      sender: whatsappSender(),
    });

    expect(r.followUpSent).toBe(true);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;

    // No PT leakage in the EN flow.
    expect(sentText).not.toContain('Você');
    expect(sentText).not.toContain('Não tenho certeza');
    expect(sentText).not.toContain('Abrindo um novo');

    // Either advisory_path or co_owner_count fires depending on what
    // the regex resolved from "i want to start a business"; both are
    // English business_setup_advisory slots and both end in '?'.
    expect(sentText).toMatch(/\?\s*$|business\?|with you\?/m);
  });

  it('PT lead with out-of-scope matter type falls back to English question text', async () => {
    // Employment Phase B is intentionally NOT in the launch-week PT
    // scope (wrongful_dismissal slots are not in pt.json). PT leads
    // with such matter types must keep working with English text
    // instead of breaking.
    mocks.llmExtractServer.mockResolvedValueOnce({
      mode: 'live',
      extracted: {
        __matter_type: 'wrongful_dismissal',
        __detected_language: 'pt',
      },
    });

    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'fui demitido sem justa causa pelo meu empregador',
      sender: whatsappSender(),
    });

    expect(r.followUpSent).toBe(true);
    const sentText = mocks.sendChannelMessage.mock.calls[0][0].text as string;

    // The out-of-scope wrongful_dismissal slots have no PT translation.
    // Their English question text must surface (not throw, not render
    // an empty string).
    expect(sentText.length).toBeGreaterThan(20);
    expect(sentText).not.toContain('undefined');
  });
});
