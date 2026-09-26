import { buildStructuredBrief } from "./brief";
import { getEligibleClarificationCodes } from "./clarifications";
import { validateAnalysisResult } from "./output";
import { validateDraftAnswers } from "./validation";
import type { AnalysisResult, ClarificationCode, DesiredClientAnswers, SavedBrief, SavedDraft } from "./types";

export const DRAFT_STORAGE_KEY = "cls-desired-client-v2";
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type DraftLoadResult = { status: "empty" } | { status: "expired" } | { status: "corrupt" } | { status: "unavailable" } | { status: "ready"; draft: SavedDraft };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function restoreSavedBrief(value: unknown, answers: DesiredClientAnswers): SavedBrief | undefined {
  if (!isRecord(value) || value.sourceBriefRevision !== answers.revision || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt)) || typeof value.wordingReviewed !== "boolean"
    || (value.mode !== "ai" && value.mode !== "structured")) return undefined;
  const openClarificationCode = value.openClarificationCode;
  if (openClarificationCode !== undefined && (typeof openClarificationCode !== "string" || !getEligibleClarificationCodes(answers).includes(openClarificationCode as ClarificationCode))) return undefined;
  if (value.mode === "structured") {
    const rebuilt = buildStructuredBrief(answers);
    return sameJson(value.brief, rebuilt) ? { brief: rebuilt, sourceBriefRevision: answers.revision, generatedAt: new Date(Date.parse(value.generatedAt)).toISOString(), wordingReviewed: value.wordingReviewed, mode: "structured", ...(openClarificationCode?{openClarificationCode:openClarificationCode as ClarificationCode}:{}) } : undefined;
  }
  const result = validateAnalysisResult({ brief: value.brief, clarification_code: null }, answers, []);
  return result ? { brief: result.brief, sourceBriefRevision: answers.revision, generatedAt: new Date(Date.parse(value.generatedAt)).toISOString(), wordingReviewed: value.wordingReviewed, mode: "ai", ...(openClarificationCode?{openClarificationCode:openClarificationCode as ClarificationCode}:{}) } : undefined;
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
  const draft = validateSavedDraft(parsed);
  return draft ? { status: "ready", draft } : { status: "corrupt" };
}

export function saveDraft(storage: Storage, answers: DesiredClientAnswers, currentStage: number, savedBrief?: SavedBrief, now = Date.now()): SavedDraft | null {
  if (!validateDraftAnswers(answers) || !Number.isInteger(currentStage) || currentStage < 1 || currentStage > 7) return null;
  let editedAt = now;
  try {
    const old = storage.getItem(DRAFT_STORAGE_KEY);
    if (old) { const previous = validateSavedDraft(JSON.parse(old)); if (previous && previous.answers.revision === answers.revision) editedAt = Date.parse(previous.lastEditedAt); }
  } catch { /* continue in memory and report a storage failure below */ }
  const timestamp = new Date(editedAt).toISOString();
  const safeBrief = savedBrief ? restoreSavedBrief(savedBrief, answers) : undefined;
  const draft: SavedDraft = { schemaVersion: 2, answers, currentStage, lastEditedAt: timestamp,
    expiresAt: new Date(editedAt + DRAFT_TTL_MS).toISOString(), ...(safeBrief ? { savedBrief: safeBrief } : {}) };
  try { storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft)); return draft; } catch { return null; }
}
export function clearDraft(storage: Storage): boolean { try { storage.removeItem(DRAFT_STORAGE_KEY); return true; } catch { return false; } }
export function savedAnalysis(result: AnalysisResult, answers: DesiredClientAnswers): SavedBrief | undefined {
  const checked = validateAnalysisResult(result, answers, []);
  return checked ? { brief: checked.brief, sourceBriefRevision: answers.revision, generatedAt: new Date().toISOString(), wordingReviewed: false, mode: "ai" } : undefined;
}