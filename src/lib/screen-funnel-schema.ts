/**
 * The only browser-to-server Screen funnel event shape. Keep this module
 * client-safe: it deliberately has no database, server secret, or widget-state
 * imports. Adding a property here is a privacy review, not a convenience edit.
 */

export const SCREEN_FUNNEL_EVENT_NAMES = [
  "flow_started",
  "question_presented",
  "question_answered",
  "review_reached",
  "report_opened",
  "contact_reached",
  "lead_submitted",
  "flow_restarted",
] as const;
export type ScreenFunnelEventName = (typeof SCREEN_FUNNEL_EVENT_NAMES)[number];

export const SCREEN_FUNNEL_STAGES = ["opening", "discovery", "review", "contact", "report", "done"] as const;
export type ScreenFunnelStage = (typeof SCREEN_FUNNEL_STAGES)[number];

export const SCREEN_FUNNEL_ANSWER_MODES = ["listed_option", "free_text", "skip"] as const;
export type ScreenFunnelAnswerMode = (typeof SCREEN_FUNNEL_ANSWER_MODES)[number];

export const SCREEN_FUNNEL_LOCALES = ["en", "pt", "other"] as const;
export type ScreenFunnelLocale = (typeof SCREEN_FUNNEL_LOCALES)[number];

export const SCREEN_FUNNEL_VIEWPORTS = ["mobile_small", "mobile", "desktop"] as const;
export type ScreenFunnelViewport = (typeof SCREEN_FUNNEL_VIEWPORTS)[number];

export type ScreenFunnelSurface = "marketing_demo" | "firm_widget";

export interface ScreenFunnelEventV1 {
  schemaVersion: 1;
  eventId: string;
  flowId: string;
  sequence: number;
  contextToken: string;
  event: ScreenFunnelEventName;
  stage: ScreenFunnelStage;
  stepIndex: number;
  questionCount: number;
  answerMode?: ScreenFunnelAnswerMode;
  isRevisit?: boolean;
  locale: ScreenFunnelLocale;
  viewport: ScreenFunnelViewport;
  elapsedMs: number;
}

export const SCREEN_FUNNEL_MAX_PAYLOAD_BYTES = 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_KEYS = new Set<keyof ScreenFunnelEventV1>([
  "schemaVersion", "eventId", "flowId", "sequence", "contextToken", "event", "stage", "stepIndex",
  "questionCount", "answerMode", "isRevisit", "locale", "viewport", "elapsedMs",
]);

function oneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function integerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function hasExpectedStage(event: ScreenFunnelEventName, stage: ScreenFunnelStage): boolean {
  const expected: Record<ScreenFunnelEventName, ScreenFunnelStage> = {
    flow_started: "opening",
    question_presented: "discovery",
    question_answered: "discovery",
    review_reached: "review",
    report_opened: "report",
    contact_reached: "contact",
    lead_submitted: "done",
    flow_restarted: "discovery",
  };
  return expected[event] === stage;
}

/**
 * Validates a strict, flat allowlist. Invalid payloads intentionally return no
 * field-level explanation so a rejected request never causes its contents to
 * be logged or reflected back to a browser.
 */
export function parseScreenFunnelEventV1(value: unknown): ScreenFunnelEventV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  if (entries.some(([key, item]) => !ALLOWED_KEYS.has(key as keyof ScreenFunnelEventV1) || item === null || typeof item === "object")) {
    return null;
  }

  if (
    record.schemaVersion !== 1 ||
    typeof record.eventId !== "string" || !UUID_RE.test(record.eventId) ||
    typeof record.flowId !== "string" || !UUID_RE.test(record.flowId) ||
    typeof record.contextToken !== "string" || record.contextToken.length === 0 ||
    !integerInRange(record.sequence, 0, 64) ||
    !oneOf(record.event, SCREEN_FUNNEL_EVENT_NAMES) ||
    !oneOf(record.stage, SCREEN_FUNNEL_STAGES) ||
    !integerInRange(record.stepIndex, 0, 8) ||
    !integerInRange(record.questionCount, 0, 8) ||
    !oneOf(record.locale, SCREEN_FUNNEL_LOCALES) ||
    !oneOf(record.viewport, SCREEN_FUNNEL_VIEWPORTS) ||
    !integerInRange(record.elapsedMs, 0, 7_200_000) ||
    !hasExpectedStage(record.event, record.stage)
  ) return null;

  const hasAnswerMode = Object.hasOwn(record, "answerMode");
  if (hasAnswerMode && !oneOf(record.answerMode, SCREEN_FUNNEL_ANSWER_MODES)) return null;
  if ((record.event === "question_answered") !== hasAnswerMode) return null;
  if (Object.hasOwn(record, "isRevisit") && typeof record.isRevisit !== "boolean") return null;
  if (record.isRevisit === true && record.event !== "question_presented") return null;

  return record as unknown as ScreenFunnelEventV1;
}
