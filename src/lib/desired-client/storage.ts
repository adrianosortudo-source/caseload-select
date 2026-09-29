import { buildStructuredBrief } from "./brief";
import { getEligibleClarificationCodes } from "./clarifications";
import { validateAnalysisResult } from "./output";
import { resolveAnswerReference } from "./catalog";
import { validateDraftAnswers, validateLegacyV22DraftAnswers } from "./validation";
import { migrateV21Answers, migrateV22Answers } from "./migration";
import type { AnalysisResult, AnswerReferencePath, ClarificationCode, DesiredClientAnswers, LegacyDesiredClientBriefV1, SavedBrief, SavedDraft } from "./types";

export const DRAFT_STORAGE_KEY = "cls-desired-client-v2";
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type DraftLoadResult = { status: "empty" } | { status: "expired" } | { status: "corrupt" } | { status: "unavailable" } | { status: "ready"; draft: SavedDraft; migrated?: boolean };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function validDraftEnvelope(value: unknown, now: number): value is Record<string, unknown> {
  if (!isRecord(value) || value.schemaVersion !== 2 || !Number.isInteger(value.currentStage) || Number(value.currentStage) < 1 || Number(value.currentStage) > 7 ||
      typeof value.lastEditedAt !== "string" || typeof value.expiresAt !== "string") return false;
  const edited = Date.parse(value.lastEditedAt), expires = Date.parse(value.expiresAt);
  return Number.isFinite(edited) && Number.isFinite(expires) && expires > now && expires > edited && expires - edited <= DRAFT_TTL_MS + 1000;
}

function mappedStage(value: number): number {
  return ({ 1: 1, 2: 2, 3: 2, 4: 3, 5: 4, 6: 5, 7: 7 } as Record<number, number>)[value] ?? 1;
}

function migratedLegacyDraft(value: unknown, now: number): SavedDraft | null {
  if (!validDraftEnvelope(value, now)) return null;
  const schema = isRecord(value.answers) ? value.answers.schema_version : null;
  const answers = schema === "dcm-v2.1" ? migrateV21Answers(value.answers) : schema === "dcm-v2.2" ? migrateV22Answers(value.answers) : null;
  if (!answers) return null;
  const edited = Date.parse(value.lastEditedAt as string), expires = Date.parse(value.expiresAt as string);
  const stage = mappedStage(Number(value.currentStage));
  const savedBrief = schema === "dcm-v2.2" && isRecord(value.savedBrief)
    ? restoreSavedBrief({ ...value.savedBrief, sourceAnswersVersion: "dcm-v2.2", sourceAnswersSnapshot: structuredClone(value.answers) }, answers)
    : undefined;
  return { schemaVersion: 2, answers, currentStage: stage, lastEditedAt: new Date(edited).toISOString(), expiresAt: new Date(expires).toISOString(), ...(savedBrief ? { savedBrief: savedBrief as SavedBrief } : {}) };
}

function legacyTimestampsForSameMigration(value: unknown, answers: DesiredClientAnswers): { edited: number; expires: number } | null {
  if (!isRecord(value) || typeof value.lastEditedAt !== "string" || typeof value.expiresAt !== "string") return null;
  const edited = Date.parse(value.lastEditedAt), expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(edited) || !Number.isFinite(expires) || expires <= edited || expires - edited > DRAFT_TTL_MS + 1000) return null;
  const schema = isRecord(value.answers) ? value.answers.schema_version : null;
  const migrated = schema === "dcm-v2.1" ? migrateV21Answers(value.answers) : schema === "dcm-v2.2" ? migrateV22Answers(value.answers) : null;
  return migrated && migrated.revision === answers.revision ? { edited, expires } : null;
}

function restoreSavedBrief(value: unknown, answers: DesiredClientAnswers): SavedBrief | undefined {
  if (!isRecord(value) || !Number.isSafeInteger(value.sourceBriefRevision) || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt)) || typeof value.wordingReviewed !== "boolean"
    || (value.mode !== "ai" && value.mode !== "structured")) return undefined;
  const openClarificationCode = value.openClarificationCode;
  const isLegacyV1 = isRecord(value.brief) && value.brief.report_version === "dcm-blueprint-v1";
  if (!isLegacyV1 && openClarificationCode !== undefined && (typeof openClarificationCode !== "string" || !getEligibleClarificationCodes(answers).includes(openClarificationCode as ClarificationCode))) return undefined;
  const brief = value.brief;
  if (isRecord(brief) && brief.report_version === "dcm-blueprint-v1") {
    const snapshot = value.sourceAnswersSnapshot;
    if (value.sourceAnswersVersion !== "dcm-v2.2" || !isRecord(snapshot) || snapshot.schema_version !== "dcm-v2.2" ||
      snapshot.revision !== value.sourceBriefRevision || !validateLegacyAnswerSnapshot(snapshot) || !validLegacyBrief(brief, snapshot as unknown as DesiredClientAnswers)) return undefined;
    return { brief: structuredClone(brief) as unknown as LegacyDesiredClientBriefV1, sourceAnswersVersion: "dcm-v2.2", sourceAnswersSnapshot: structuredClone(snapshot), sourceBriefRevision: Number(value.sourceBriefRevision), generatedAt: new Date(Date.parse(value.generatedAt)).toISOString(), wordingReviewed: value.wordingReviewed, mode: value.mode };
  }
  if (value.sourceBriefRevision !== answers.revision) return undefined;
  if (value.mode === "structured") {
    const rebuilt = buildStructuredBrief(answers);
    return sameJson(brief, rebuilt) ? { brief: rebuilt, sourceAnswersVersion: "dcm-v3.0", sourceAnswersSnapshot: structuredClone(answers), sourceBriefRevision: answers.revision, generatedAt: new Date(Date.parse(value.generatedAt)).toISOString(), wordingReviewed: value.wordingReviewed, mode: "structured", ...(openClarificationCode?{openClarificationCode:openClarificationCode as ClarificationCode}:{}) } : undefined;
  }
  const result = validateAnalysisResult({ brief, clarification_code: null }, answers, []);
  return result ? { brief: result.brief, sourceAnswersVersion: "dcm-v3.0", sourceAnswersSnapshot: structuredClone(answers), sourceBriefRevision: answers.revision, generatedAt: new Date(Date.parse(value.generatedAt)).toISOString(), wordingReviewed: value.wordingReviewed, mode: "ai", ...(openClarificationCode?{openClarificationCode:openClarificationCode as ClarificationCode}:{}) } : undefined;
}

function validateLegacyAnswerSnapshot(value: unknown): boolean {
  return isRecord(value) && validateLegacyV22DraftAnswers(value);
}

function validLegacyBrief(value: Record<string, unknown>, answers: DesiredClientAnswers): boolean {
  if (Object.keys(value).sort().join("|") !== ["client_need","firm_value","marketing","open_questions","portrait","report_version"].sort().join("|") ||
    value.report_version !== "dcm-blueprint-v1" || !Array.isArray(value.open_questions) || value.open_questions.length > 2 || !isRecord(value.marketing) ||
    Object.keys(value.marketing).sort().join("|") !== "content|message|next_step") return false;
  const statements = [value.portrait, value.client_need, value.firm_value, value.marketing.message, value.marketing.content, value.marketing.next_step, ...value.open_questions];
  return statements.every((item) => {
    if (!isRecord(item) || Object.keys(item).sort().join("|") !== "kind|source_answer_ids|text" || typeof item.text !== "string" || !item.text.trim() ||
      item.text.length > 420 || !["experience","preference","hypothesis","unknown","suggestion"].includes(String(item.kind)) ||
      !Array.isArray(item.source_answer_ids) || item.source_answer_ids.length < 1 || item.source_answer_ids.length > 8) return false;
    const ids = item.source_answer_ids as unknown[];
    if (ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) return false;
    return ids.every((id) => {
      try { const resolved = resolveAnswerReference(id as AnswerReferencePath, answers); return resolved.present && resolved.value !== null; } catch { return false; }
    });
  });
}

export function validateSavedDraft(value: unknown): SavedDraft | null {
  if (!isRecord(value) || value.schemaVersion !== 2 || !validateDraftAnswers(value.answers)
    || !Number.isInteger(value.currentStage) || Number(value.currentStage) < 1 || Number(value.currentStage) > 7
    || typeof value.lastEditedAt !== "string" || typeof value.expiresAt !== "string") return null;
  const edited = Date.parse(value.lastEditedAt), expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(edited) || !Number.isFinite(expires) || expires <= edited || expires - edited > DRAFT_TTL_MS + 1000) return null;
  const answers = value.answers;
  const savedBrief = value.savedBrief === undefined ? undefined : restoreSavedBrief(value.savedBrief, answers);
  return { schemaVersion: 2, answers, currentStage: Number(value.currentStage), lastEditedAt: new Date(edited).toISOString(), expiresAt: new Date(expires).toISOString(), ...(savedBrief ? { savedBrief } : {}) };
}

export function loadDraft(storage: Storage, now = Date.now()): DraftLoadResult {
  let raw: string | null;
  try { raw = storage.getItem(DRAFT_STORAGE_KEY); } catch { return { status: "unavailable" }; }
  if (raw === null) return { status: "empty" };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { status: "corrupt" }; }
  if (isRecord(parsed) && typeof parsed.expiresAt === "string") {
    const expires = Date.parse(parsed.expiresAt);
    if (Number.isFinite(expires) && expires <= now) return { status: "expired" };
  }
  const migrated = migratedLegacyDraft(parsed, now);
  if (migrated) {
    try { storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(migrated)); } catch { /* resume from the validated in-memory copy; a later edit can retry */ }
    return { status: "ready", draft: migrated, migrated: true };
  }
  const draft = validateSavedDraft(parsed);
  return draft ? { status: "ready", draft } : { status: "corrupt" };
}

export function saveDraft(storage: Storage, answers: DesiredClientAnswers, currentStage: number, savedBrief?: SavedBrief, now = Date.now()): SavedDraft | null {
  if (!validateDraftAnswers(answers) || !Number.isInteger(currentStage) || currentStage < 1 || currentStage > 7) return null;
  let editedAt = now;
  let expiresAt = now + DRAFT_TTL_MS;
  try {
    const old = storage.getItem(DRAFT_STORAGE_KEY);
    if (old) {
      const parsed = JSON.parse(old) as unknown;
      const previous = validateSavedDraft(parsed);
      if (previous && previous.answers.revision === answers.revision) { editedAt = Date.parse(previous.lastEditedAt); expiresAt = Date.parse(previous.expiresAt); }
      else if (answers.schema_version === "dcm-v3.0") {
        const legacy = legacyTimestampsForSameMigration(parsed, answers);
        if (legacy) { editedAt = legacy.edited; expiresAt = legacy.expires; }
      }
    }
  } catch { /* continue in memory and report a storage failure below */ }
  const timestamp = new Date(editedAt).toISOString();
  const safeBrief = savedBrief ? restoreSavedBrief(savedBrief, answers) : undefined;
  const draft: SavedDraft = { schemaVersion: 2, answers, currentStage, lastEditedAt: timestamp,
    expiresAt: new Date(expiresAt).toISOString(), ...(safeBrief ? { savedBrief: safeBrief } : {}) };
  try { storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft)); return draft; } catch { return null; }
}
export function clearDraft(storage: Storage): boolean { try { storage.removeItem(DRAFT_STORAGE_KEY); return true; } catch { return false; } }
export function savedAnalysis(result: AnalysisResult, answers: DesiredClientAnswers): SavedBrief | undefined {
  const checked = validateAnalysisResult(result, answers, []);
  return checked ? { brief: checked.brief, sourceAnswersVersion: "dcm-v3.0", sourceAnswersSnapshot: structuredClone(answers), sourceBriefRevision: answers.revision, generatedAt: new Date().toISOString(), wordingReviewed: false, mode: "ai" } : undefined;
}
