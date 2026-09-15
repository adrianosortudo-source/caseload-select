import { describe, expect, it } from 'vitest';

import {
  MAX_CHANNEL_INTAKE_BODY_BYTES,
  MAX_CHANNEL_INTAKE_EXCHANGES,
  annotateInboundAnswers,
  appendInboundExchange,
  appendOutboundQuestion,
  parseChannelIntakeHistory,
  reconstructLegacyChannelIntakeHistory,
  settleOutboundQuestion,
  type ChannelIntakeHistoryV1,
} from '../channel-intake-history';
import type { EngineState } from '../screen-engine/types';

const EMPTY: ChannelIntakeHistoryV1 = { version: 1, events: [], truncated: false };

function state(
  slots: Record<string, string> = {},
  sources: Record<string, string> = {},
): EngineState {
  return {
    slots,
    slot_meta: Object.fromEntries(
      Object.entries(sources).map(([slotId, source]) => [slotId, { source, confidence: 1 }]),
    ),
    slot_evidence: {},
  } as unknown as EngineState;
}

describe('channel intake exchange history', () => {
  it('keeps exact ordered bodies, reply linkage, delivery state, and normalized answers', () => {
    const inbound = appendInboundExchange(EMPTY, {
      id: 'in-1',
      body: 'I was dismissed yesterday.',
      occurredAt: '2026-09-15T12:00:00.000Z',
      providerMessageId: 'meta-in-1',
    });
    const question = appendOutboundQuestion(inbound.history, {
      id: 'out-1',
      body: 'What severance were you offered?',
      occurredAt: '2026-09-15T12:00:01.000Z',
      kind: 'discovery_question',
      slotIds: ['offer_amount'],
    });
    const delivered = settleOutboundQuestion(question.history, {
      eventId: question.eventId,
      sent: true,
      providerMessageId: 'meta-out-1',
    });
    const answer = appendInboundExchange(delivered, {
      id: 'in-2',
      body: 'Six weeks.',
      occurredAt: '2026-09-15T12:03:00.000Z',
    });
    const annotated = annotateInboundAnswers(
      answer.history,
      answer.eventId,
      state(),
      state({ offer_amount: 'Six weeks' }, { offer_amount: 'answered' }),
    );

    expect(annotated.events.map((event) => event.body)).toEqual([
      'I was dismissed yesterday.',
      'What severance were you offered?',
      'Six weeks.',
    ]);
    expect(annotated.events[1]).toMatchObject({
      status: 'sent',
      providerMessageId: 'meta-out-1',
      slotIds: ['offer_amount'],
    });
    expect(annotated.events[2]).toMatchObject({
      replyToEventId: 'out-1',
      normalizedAnswers: [{ slotId: 'offer_amount', value: 'Six weeks' }],
    });
    expect(parseChannelIntakeHistory(annotated)).toEqual(annotated);
  });

  it('records failed and delivery-unknown questions without claiming they were delivered', () => {
    const failed = appendOutboundQuestion(EMPTY, {
      id: 'failed',
      body: 'What is your name?',
      occurredAt: '2026-09-15T12:00:00.000Z',
      kind: 'contact_question',
      slotIds: ['client_name'],
    });
    const failure = settleOutboundQuestion(failed.history, {
      eventId: 'failed',
      sent: false,
      failureReason: 'Graph rejected the request',
    });
    expect(failure.events[0]).toMatchObject({
      status: 'failed',
      failureReason: 'Graph rejected the request',
    });

    const unknown = settleOutboundQuestion(failed.history, {
      eventId: 'failed',
      sent: false,
      deliveryUnknown: true,
    });
    expect(unknown.events[0].status).toBe('delivery_unknown');
  });

  it('does not link a later inbound message to a question known to have failed', () => {
    const delivered = settleOutboundQuestion(
      appendOutboundQuestion(EMPTY, {
        id: 'delivered',
        body: 'What happened?',
        occurredAt: '2026-09-15T12:00:00.000Z',
        kind: 'discovery_question',
      }).history,
      { eventId: 'delivered', sent: true },
    );
    const failed = settleOutboundQuestion(
      appendOutboundQuestion(delivered, {
        id: 'failed',
        body: 'Could you choose a listed option?',
        occurredAt: '2026-09-15T12:01:00.000Z',
        kind: 'clarification',
      }).history,
      { eventId: 'failed', sent: false, failureReason: 'provider rejected request' },
    );

    const inbound = appendInboundExchange(failed, {
      id: 'answer',
      body: 'Here are the details.',
      occurredAt: '2026-09-15T12:02:00.000Z',
    });

    expect(inbound.history.events[2].replyToEventId).toBe('delivered');
  });

  it('bounds individual bodies and the total number of retained events honestly', () => {
    const oversized = '🙂'.repeat(MAX_CHANNEL_INTAKE_BODY_BYTES);
    let current = appendInboundExchange(EMPTY, {
      body: oversized,
      occurredAt: null,
    }).history;
    expect(new TextEncoder().encode(current.events[0].body).length).toBeLessThanOrEqual(
      MAX_CHANNEL_INTAKE_BODY_BYTES,
    );
    expect(current.events[0].bodyTruncated).toBe(true);
    expect(current.events[0].originalByteLength).toBeGreaterThan(MAX_CHANNEL_INTAKE_BODY_BYTES);

    for (let index = 1; index <= MAX_CHANNEL_INTAKE_EXCHANGES; index++) {
      current = appendInboundExchange(current, {
        body: `message ${index}`,
        occurredAt: null,
      }).history;
    }
    expect(current.events).toHaveLength(MAX_CHANNEL_INTAKE_EXCHANGES);
    expect(current.truncated).toBe(true);
  });

  it('prefers recorded history and keeps the raw text as unpaired supporting evidence', () => {
    const recorded = appendInboundExchange(EMPTY, {
      id: 'recorded-1',
      body: 'My exact message',
      occurredAt: null,
    }).history;
    const view = reconstructLegacyChannelIntakeHistory({
      rawTranscript: 'legacy raw text',
      slotAnswers: { intake_exchanges: recorded },
      intakeLanguage: 'en',
    });
    expect(view.provenance).toBe('recorded');
    expect(view.events[0].body).toBe('My exact message');
    expect(view.rawTranscript).toBe('legacy raw text');
  });

  it('labels historical reconstruction and never positionally pairs the raw transcript', () => {
    const view = reconstructLegacyChannelIntakeHistory({
      rawTranscript: '1\n3\nTaylor',
      slotAnswers: {
        questionHistory: ['offer_signed'],
        slots: { offer_signed: 'no' },
      },
      intakeLanguage: 'en',
    });
    expect(view.provenance).toBe('reconstructed');
    expect(view.notice).toMatch(/reconstructed|not retained/i);
    expect(view.rawTranscript).toBe('1\n3\nTaylor');
    expect(view.events.some((event) => event.body === '1\n3\nTaylor')).toBe(false);
  });
});
