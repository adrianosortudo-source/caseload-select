/**
 * F1 regression guard (2026-08-06 field repro, build plan
 * docs/BUILD_PLAN_meta_channel_intake_fixes_v1.md).
 *
 * Field repro: Messenger, no profile name available, lead sends
 * "i want to speak to a lawyer" then "adriano\n6475492106" then "adriano".
 * The bot asked for the name three times and never captured it.
 *
 * Root cause: Phase A/B (the contact-capture follow-up branch) persisted
 * engine state verbatim on send, without setting `contactCaptureStarted`.
 * control.ts:960 gates the ENTIRE contact-doctrine branch on that flag, so
 * on the resume turn `getNextStep` never returned `capture_contact`, so
 * `nameCaptureContext` never lifted, so a bare-name reply fell through to
 * the default (capitalised-only, pre-F3) bare-name path and was dropped.
 * Gate failed again, Phase B re-asked. Loop until MAX_FOLLOW_UPS.
 *
 * This suite starts from REAL Phase B output (turn 1 runs through
 * processChannelInbound for real and the resulting engineState is
 * captured from the mock call), not hand-seeded engine state — the
 * existing sibling suite (channel-intake-processor-name-capture-resume)
 * seeds contactCaptureStarted=true directly, which is the exact state
 * Phase B never actually produced in production. That gap is why 5000+
 * passing tests coexisted with a fully broken channel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  sendChannelMessage: vi.fn(),
  buildContactCaptureFollowUp: vi.fn(
    (missing: string) => `NEEDS:${missing} — can you share that so the firm can reach you?`,
  ),
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
    lead_id: 'L-test-phase-b',
    status: 'triaging',
    decision_deadline: '2026-08-07T00:00:00.000Z',
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
  type MessengerSender,
} from '../channel-intake-processor';

const FIRM_ID = '11111111-1111-1111-1111-111111111111';

function messengerSender(senderName: string | null = null): MessengerSender {
  return {
    channel: 'facebook',
    senderPsid: '26924934080492300',
    senderName,
    messageMid: 'mid_1',
    pageId: 'page-1',
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

describe('Phase B (contact-capture follow-up) persists contactCaptureStarted', () => {
  it('turn 1: no profile name, no phone/email in text → contact gate fails, Phase B asks, and persists contactCaptureStarted=true', async () => {
    const r = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'i want to speak to a lawyer',
      sender: messengerSender(null),
    });

    expect(r.persisted).toBe(false);
    expect(r.reason).toBe('awaiting_contact');
    expect(r.followUpSent).toBe(true);
    expect(mocks.createChannelSession).toHaveBeenCalledTimes(1);

    const sessionPayload = (mocks.createChannelSession.mock.calls as unknown as Array<
      Array<{ engineState: { contactCaptureStarted: boolean } }>
    >)[0][0];

    // This is the F1 assertion. Before the fix this was false (or
    // undefined), which is the entire root cause of the Messenger loop.
    expect(sessionPayload.engineState.contactCaptureStarted).toBe(true);
  });

  it('end-to-end repro: turn 2 reply "adriano" (lowercase, name only) is captured and the bot does not re-ask', async () => {
    // Turn 1: real Phase B run, capture what it actually persists.
    await processChannelInbound({
      firmId: FIRM_ID,
      text: 'i want to speak to a lawyer',
      sender: messengerSender(null),
    });
    const turn1State = (mocks.createChannelSession.mock.calls as unknown as Array<
      Array<{ engineState: Record<string, unknown> }>
    >)[0][0].engineState;

    // Clear turn 1's call log so turn-2-only assertions aren't polluted
    // by the first send.
    mocks.sendChannelMessage.mockClear();
    mocks.updateChannelSession.mockClear();
    mocks.createChannelSession.mockClear();

    // Turn 2 resumes from turn 1's REAL persisted state, not a hand-built
    // fixture. This is the field repro's second message.
    mocks.loadOpenChannelSession.mockResolvedValueOnce({
      id: 'session-uuid',
      firm_id: FIRM_ID,
      channel: 'facebook',
      sender_id: '26924934080492300',
      engine_state: turn1State,
      follow_up_count: 1,
      max_follow_ups: 3,
      finalized: false,
      expires_at: '2026-08-07T00:00:00.000Z',
      created_at: '2026-08-06T00:00:00.000Z',
    } as never);

    const r2 = await processChannelInbound({
      firmId: FIRM_ID,
      text: 'adriano',
      sender: messengerSender(null),
    });

    // The bug: the bot re-asks "share your name and the best phone or
    // email" a second time because the name was never captured. The fix:
    // the reply is consumed. Whatever happens next (contact still
    // incomplete because phone/email is still missing, so the SAME
    // Phase B branch may fire again asking for reachability) — the
    // ask must NOT be an unmodified repeat of the exact same
    // name+phone/email prompt with client_name still unset.
    expect(mocks.sendChannelMessage).toHaveBeenCalledTimes(1);

    // Whichever path fired (Phase B asking for phone/email now that name
    // is known, or Phase C asking a discovery question), the session
    // persisted after this turn must show the name captured.
    const persistCall =
      mocks.updateChannelSession.mock.calls[0] ?? mocks.createChannelSession.mock.calls[1];
    expect(persistCall).toBeTruthy();
    const persistedState = (
      persistCall as unknown as Array<{ engineState: { slots: Record<string, string> } }>
    )[0].engineState;
    expect(persistedState.slots.client_name).toBe('Adriano');
    expect(r2.followUpSent).toBe(true);

    // Direct proof the loop is broken: turn 1's gate reported both name
    // and reachability missing (see stdout: "missing=both"); turn 2's gate
    // (now that the name is captured) must report only reachability
    // missing, NOT "both" again. Pre-fix this stayed "both" forever
    // because contactCaptureStarted was never set, so the name was never
    // captured and the bot asked the identical question every turn.
    const sentText2 = mocks.sendChannelMessage.mock.calls[0][0].text as string;
    expect(sentText2).not.toContain('NEEDS:both');
  });
});
