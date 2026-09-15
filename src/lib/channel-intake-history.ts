import { SLOT_REGISTRY } from './screen-engine/slotRegistry';
import { getOptionDescription, getOptionDisplayLabel, getQuestionDisplayText } from './screen-engine/i18n/display';
import { getI18n } from './screen-engine/i18n/loader';
import type { EngineState, SupportedLanguage } from './screen-engine/types';

export const CHANNEL_INTAKE_HISTORY_VERSION = 1 as const;
export const MAX_CHANNEL_INTAKE_EXCHANGES = 64;
export const MAX_CHANNEL_INTAKE_BODY_BYTES = 8192;

export type ChannelIntakeExchangeStatus =
  | 'received'
  | 'pending'
  | 'sent'
  | 'failed'
  | 'delivery_unknown';

export type ChannelIntakeExchangeKind =
  | 'opening'
  | 'answer'
  | 'contact_question'
  | 'discovery_question'
  | 'clarification';

export interface ChannelIntakeOptionSnapshot {
  number: number;
  value: string;
  label: string;
  description?: string;
}

export interface ChannelIntakeNormalizedAnswer {
  slotId: string;
  value: string;
}

export interface ChannelIntakeExchange {
  id: string;
  sequence: number;
  direction: 'inbound' | 'outbound';
  body: string;
  occurredAt: string | null;
  status: ChannelIntakeExchangeStatus;
  kind: ChannelIntakeExchangeKind;
  slotIds: string[];
  replyToEventId: string | null;
  normalizedAnswers: ChannelIntakeNormalizedAnswer[];
  options?: ChannelIntakeOptionSnapshot[];
  providerMessageId?: string | null;
  failureReason?: string | null;
  bodyTruncated?: boolean;
  originalByteLength?: number;
}

export interface ChannelIntakeHistoryV1 {
  version: typeof CHANNEL_INTAKE_HISTORY_VERSION;
  events: ChannelIntakeExchange[];
  truncated: boolean;
}

export type ChannelIntakeHistoryProvenance =
  | 'recorded'
  | 'reconstructed'
  | 'raw_only'
  | 'unavailable';

export interface ChannelIntakeHistoryView {
  version: typeof CHANNEL_INTAKE_HISTORY_VERSION;
  events: ChannelIntakeExchange[];
  truncated: boolean;
  provenance: ChannelIntakeHistoryProvenance;
  notice: string | null;
  /** Original inbound-only text. Never positionally paired to reconstructed questions. */
  rawTranscript: string | null;
}

export const EMPTY_CHANNEL_INTAKE_HISTORY: ChannelIntakeHistoryV1 = Object.freeze({
  version: CHANNEL_INTAKE_HISTORY_VERSION,
  events: Object.freeze([]) as unknown as ChannelIntakeExchange[],
  truncated: false,
});

/** Safe fallback when a stored envelope cannot be trusted as complete. */
export const INCOMPLETE_CHANNEL_INTAKE_HISTORY: ChannelIntakeHistoryV1 = Object.freeze({
  version: CHANNEL_INTAKE_HISTORY_VERSION,
  events: Object.freeze([]) as unknown as ChannelIntakeExchange[],
  truncated: true,
});

function emptyHistory(): ChannelIntakeHistoryV1 {
  return { version: CHANNEL_INTAKE_HISTORY_VERSION, events: [], truncated: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStatus(value: unknown): value is ChannelIntakeExchangeStatus {
  return (
    value === 'received' ||
    value === 'pending' ||
    value === 'sent' ||
    value === 'failed' ||
    value === 'delivery_unknown'
  );
}

function isKind(value: unknown): value is ChannelIntakeExchangeKind {
  return (
    value === 'opening' ||
    value === 'answer' ||
    value === 'contact_question' ||
    value === 'discovery_question' ||
    value === 'clarification'
  );
}

function isNormalizedAnswer(value: unknown): value is ChannelIntakeNormalizedAnswer {
  return (
    isRecord(value) &&
    typeof value.slotId === 'string' &&
    value.slotId.length > 0 &&
    typeof value.value === 'string'
  );
}

function isOptionSnapshot(value: unknown): value is ChannelIntakeOptionSnapshot {
  return (
    isRecord(value) &&
    Number.isInteger(value.number) &&
    (value.number as number) > 0 &&
    typeof value.value === 'string' &&
    typeof value.label === 'string' &&
    (value.description === undefined || typeof value.description === 'string')
  );
}

function isExchange(value: unknown): value is ChannelIntakeExchange {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    !Number.isInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    (value.direction !== 'inbound' && value.direction !== 'outbound') ||
    typeof value.body !== 'string' ||
    (value.occurredAt !== null && typeof value.occurredAt !== 'string') ||
    !isStatus(value.status) ||
    !isKind(value.kind) ||
    !Array.isArray(value.slotIds) ||
    !value.slotIds.every((slotId) => typeof slotId === 'string') ||
    (value.replyToEventId !== null && typeof value.replyToEventId !== 'string') ||
    !Array.isArray(value.normalizedAnswers) ||
    !value.normalizedAnswers.every(isNormalizedAnswer) ||
    new TextEncoder().encode(value.body).length > MAX_CHANNEL_INTAKE_BODY_BYTES ||
    (value.providerMessageId !== undefined &&
      value.providerMessageId !== null &&
      typeof value.providerMessageId !== 'string') ||
    (value.failureReason !== undefined &&
      value.failureReason !== null &&
      typeof value.failureReason !== 'string') ||
    (value.bodyTruncated !== undefined && typeof value.bodyTruncated !== 'boolean') ||
    (value.originalByteLength !== undefined &&
      (!Number.isInteger(value.originalByteLength) || (value.originalByteLength as number) < 0))
  ) {
    return false;
  }
  if (value.options !== undefined) {
    if (!Array.isArray(value.options) || !value.options.every(isOptionSnapshot)) return false;
  }
  return true;
}

export function parseChannelIntakeHistory(value: unknown): ChannelIntakeHistoryV1 | null {
  if (!isRecord(value)) return null;
  const events = value.events;
  if (
    value.version !== CHANNEL_INTAKE_HISTORY_VERSION ||
    !Array.isArray(events) ||
    events.length > MAX_CHANNEL_INTAKE_EXCHANGES ||
    typeof value.truncated !== 'boolean'
  ) {
    return null;
  }
  if (!events.every(isExchange)) return null;
  if (
    !events.every((event, index) => event.sequence === index + 1) ||
    new Set(events.map((event) => event.id)).size !== events.length
  ) {
    return null;
  }
  return {
    version: CHANNEL_INTAKE_HISTORY_VERSION,
    events: events.map((event) => ({
      ...event,
      slotIds: [...event.slotIds],
      normalizedAnswers: event.normalizedAnswers.map((answer) => ({ ...answer })),
      ...(event.options ? { options: event.options.map((option) => ({ ...option })) } : {}),
    })) as ChannelIntakeExchange[],
    truncated: value.truncated,
  };
}

function normalizedHistory(value: unknown): ChannelIntakeHistoryV1 {
  return parseChannelIntakeHistory(value) ?? emptyHistory();
}

function randomEventId(): string {
  return globalThis.crypto.randomUUID();
}

function boundedBody(body: string): Pick<
  ChannelIntakeExchange,
  'body' | 'bodyTruncated' | 'originalByteLength'
> {
  const originalByteLength = new TextEncoder().encode(body).length;
  if (originalByteLength <= MAX_CHANNEL_INTAKE_BODY_BYTES) return { body };

  const pieces: string[] = [];
  let used = 0;
  for (const character of body) {
    const bytes = new TextEncoder().encode(character).length;
    if (used + bytes > MAX_CHANNEL_INTAKE_BODY_BYTES) break;
    pieces.push(character);
    used += bytes;
  }
  return {
    body: pieces.join(''),
    bodyTruncated: true,
    originalByteLength,
  };
}

function appendEvent(
  history: ChannelIntakeHistoryV1 | unknown,
  event: Omit<ChannelIntakeExchange, 'sequence' | 'body'> & { body: string },
): ChannelIntakeHistoryV1 {
  const current = normalizedHistory(history);
  if (current.events.length >= MAX_CHANNEL_INTAKE_EXCHANGES) {
    return { ...current, truncated: true };
  }
  const body = boundedBody(event.body);
  return {
    ...current,
    events: [
      ...current.events,
      {
        ...event,
        ...body,
        sequence: current.events.length + 1,
      },
    ],
  };
}

function latestQuestion(history: ChannelIntakeHistoryV1): ChannelIntakeExchange | null {
  return (
    [...history.events]
      .reverse()
      .find(
        (event) =>
          event.direction === 'outbound' &&
          event.status !== 'failed' &&
          (event.kind === 'contact_question' ||
            event.kind === 'discovery_question' ||
            event.kind === 'clarification'),
      ) ?? null
  );
}

export function appendInboundExchange(
  history: ChannelIntakeHistoryV1 | unknown,
  args: {
    body: string;
    occurredAt: string | null;
    providerMessageId?: string | null;
    id?: string;
  },
): { history: ChannelIntakeHistoryV1; eventId: string } {
  const current = normalizedHistory(history);
  const eventId = args.id ?? randomEventId();
  const next = appendEvent(current, {
    id: eventId,
    direction: 'inbound',
    body: args.body,
    occurredAt: args.occurredAt,
    status: 'received',
    kind: current.events.length === 0 ? 'opening' : 'answer',
    slotIds: [],
    replyToEventId: latestQuestion(current)?.id ?? null,
    normalizedAnswers: [],
    providerMessageId: args.providerMessageId ?? null,
  });
  return { history: next, eventId };
}

export function appendOutboundQuestion(
  history: ChannelIntakeHistoryV1 | unknown,
  args: {
    body: string;
    occurredAt: string;
    kind: Extract<ChannelIntakeExchangeKind, 'contact_question' | 'discovery_question' | 'clarification'>;
    slotIds?: string[];
    options?: ChannelIntakeOptionSnapshot[];
    id?: string;
  },
): { history: ChannelIntakeHistoryV1; eventId: string } {
  const eventId = args.id ?? randomEventId();
  const next = appendEvent(history, {
    id: eventId,
    direction: 'outbound',
    body: args.body,
    occurredAt: args.occurredAt,
    status: 'pending',
    kind: args.kind,
    slotIds: args.slotIds ?? [],
    replyToEventId: null,
    normalizedAnswers: [],
    options: args.options,
  });
  return { history: next, eventId };
}

export function settleOutboundQuestion(
  history: ChannelIntakeHistoryV1 | unknown,
  args: {
    eventId: string;
    sent: boolean;
    deliveryUnknown?: boolean;
    providerMessageId?: string | null;
    failureReason?: string | null;
  },
): ChannelIntakeHistoryV1 {
  const current = normalizedHistory(history);
  return {
    ...current,
    events: current.events.map((event) =>
      event.id !== args.eventId
        ? event
        : {
            ...event,
            status: args.deliveryUnknown ? 'delivery_unknown' : args.sent ? 'sent' : 'failed',
            providerMessageId: args.providerMessageId ?? null,
            failureReason: args.sent ? null : (args.failureReason?.slice(0, 500) ?? null),
          },
    ),
  };
}

const USER_GROUNDED_SOURCES = new Set(['answered', 'explicit', 'inferred']);

export function annotateInboundAnswers(
  history: ChannelIntakeHistoryV1 | unknown,
  inboundEventId: string,
  before: EngineState,
  after: EngineState,
): ChannelIntakeHistoryV1 {
  const current = normalizedHistory(history);
  const normalizedAnswers = Object.keys(after.slots)
    .filter((slotId) => {
      const value = after.slots[slotId];
      return (
        typeof value === 'string' &&
        value.length > 0 &&
        (value !== before.slots[slotId] ||
          !USER_GROUNDED_SOURCES.has(before.slot_meta[slotId]?.source ?? '')) &&
        USER_GROUNDED_SOURCES.has(after.slot_meta[slotId]?.source ?? '')
      );
    })
    .sort()
    .map((slotId) => ({ slotId, value: after.slots[slotId] as string }));
  if (normalizedAnswers.length === 0) return current;

  return {
    ...current,
    events: current.events.map((event) =>
      event.id === inboundEventId
        ? {
            ...event,
            slotIds: [...new Set([...event.slotIds, ...normalizedAnswers.map((answer) => answer.slotId)])],
            normalizedAnswers,
          }
        : event,
    ),
  };
}

function supportedLanguage(value: unknown): SupportedLanguage {
  return value === 'fr' || value === 'es' || value === 'pt' || value === 'zh' || value === 'ar'
    ? value
    : 'en';
}

export function optionSnapshotsForSlot(
  slotId: string,
  languageValue: unknown,
): ChannelIntakeOptionSnapshot[] {
  const slot = SLOT_REGISTRY.find((candidate) => candidate.id === slotId);
  if (!slot?.options) return [];
  const language = supportedLanguage(languageValue);
  const i18n = getI18n(language);
  return slot.options.map((option, index) => ({
    number: index + 1,
    value: option.value,
    label: getOptionDisplayLabel(option, slot.id, language, i18n),
    ...(getOptionDescription(option, slot.id, language, i18n)
      ? { description: getOptionDescription(option, slot.id, language, i18n) }
      : {}),
  }));
}

export interface LegacyChannelIntakeSlotAnswers {
  questionHistory?: unknown;
  slots?: unknown;
  intake_exchanges?: unknown;
}

export function reconstructLegacyChannelIntakeHistory(args: {
  rawTranscript: string | null | undefined;
  slotAnswers: LegacyChannelIntakeSlotAnswers | null | undefined;
  intakeLanguage: unknown;
}): ChannelIntakeHistoryView {
  const recorded = parseChannelIntakeHistory(args.slotAnswers?.intake_exchanges);
  const rawTranscript = args.rawTranscript?.trim() ? args.rawTranscript : null;
  if (recorded) {
    return {
      ...recorded,
      provenance: 'recorded',
      notice: recorded.truncated
        ? 'This intake record is incomplete. The saved events are shown in their recorded order.'
        : null,
      rawTranscript,
    };
  }

  const questionHistory = Array.isArray(args.slotAnswers?.questionHistory)
    ? args.slotAnswers.questionHistory.filter((value): value is string => typeof value === 'string')
    : [];
  const slots = isRecord(args.slotAnswers?.slots) ? args.slotAnswers.slots : {};
  const language = supportedLanguage(args.intakeLanguage);
  const i18n = getI18n(language);
  const seen = new Set<string>();
  let reconstructed = emptyHistory();

  for (const slotId of questionHistory) {
    if (seen.has(slotId)) continue;
    seen.add(slotId);
    const savedValue = slots[slotId];
    if (typeof savedValue !== 'string' || savedValue.length === 0) continue;
    const slot = SLOT_REGISTRY.find((candidate) => candidate.id === slotId);
    const question = slot
      ? getQuestionDisplayText(slot.id, slot.question, language, i18n)
      : `Recorded question ID: ${slotId}`;
    const questionId = `legacy-question:${slotId}`;
    reconstructed = appendEvent(reconstructed, {
      id: questionId,
      direction: 'outbound',
      body: question,
      occurredAt: null,
      status: 'sent',
      kind: 'discovery_question',
      slotIds: [slotId],
      replyToEventId: null,
      normalizedAnswers: [],
      options: optionSnapshotsForSlot(slotId, language),
    });
    reconstructed = appendEvent(reconstructed, {
      id: `legacy-answer:${slotId}`,
      direction: 'inbound',
      body: savedValue,
      occurredAt: null,
      status: 'received',
      kind: 'answer',
      slotIds: [slotId],
      replyToEventId: questionId,
      normalizedAnswers: [{ slotId, value: savedValue }],
    });
  }

  if (reconstructed.events.length > 0) {
    return {
      ...reconstructed,
      provenance: 'reconstructed',
      notice:
        'Historical question wording is reconstructed from the current question bank. Exact prompts, clarifications, and message order were not retained.',
      rawTranscript,
    };
  }
  if (rawTranscript) {
    return {
      ...emptyHistory(),
      provenance: 'raw_only',
      notice:
        'Only the original inbound text was retained for this intake. The questions that prompted it are unavailable.',
      rawTranscript,
    };
  }
  return {
    ...emptyHistory(),
    provenance: 'unavailable',
    notice: 'No intake exchange record is available for this lead.',
    rawTranscript: null,
  };
}
