import { buildStructuredBrief } from "./brief";
import { getEligibleClarificationCodes } from "./clarifications";
import { validateAnalysisResult } from "./output";
import { resolveAnswerReference } from "./catalog";
import { validateDraftAnswers, validateLegacyV22DraftAnswers, validateLegacyV31DraftAnswers, validateLegacyV32DraftAnswers } from "./validation";
import { migrateV21Answers, migrateV22Answers, migrateV30Answers, migrateV31Answers, migrateV32Answers } from "./migration";
import { type AnalysisResult, type AnswerReferencePath, type ClarificationCode, type DesiredClientAnswers, type DesiredClientBriefV2, type LegacyDesiredClientBriefV1, type SavedBrief, type SavedDraft } from "./types";

export const DRAFT_STORAGE_KEY = "cls-desired-client-v2";
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type DraftLoadResult = { status: "empty" } | { status: "expired" } | { status: "corrupt" } | { status: "unavailable" } | { status: "ready"; draft: SavedDraft; migrated?: boolean };
export type DraftSaveResult = { status: "saved"; draft: SavedDraft } | { status: "invalid" } | { status: "unavailable" };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
const sameJson = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

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
  const answers = schema === "dcm-v2.1" ? migrateV21Answers(value.answers) : schema === "dcm-v2.2" ? migrateV22Answers(value.answers) : schema === "dcm-v3.0" ? migrateV30Answers(value.answers) : schema === "dcm-v3.1" ? migrateV31Answers(value.answers) : schema === "dcm-v3.2" ? migrateV32Answers(value.answers) : null;
  if (!answers) return null;
  const edited = Date.parse(value.lastEditedAt as string), expires = Date.parse(value.expiresAt as string);
  const stage = schema === "dcm-v3.0" ? Math.min(Number(value.currentStage), 2) : schema === "dcm-v3.1" ? Math.min(Number(value.currentStage), 4) : schema === "dcm-v3.2" ? Number(value.currentStage) : mappedStage(Number(value.currentStage));
  let savedBrief: SavedBrief | undefined;
  if (isRecord(value.savedBrief)) {
    const savedValue = schema === "dcm-v2.2"
      ? { ...value.savedBrief, sourceAnswersVersion: "dcm-v2.2", sourceAnswersSnapshot: structuredClone(value.answers) }
      : schema === "dcm-v3.2" && isRecord(value.savedBrief.sourceAnswersSnapshot) && value.savedBrief.sourceAnswersVersion === "dcm-v3.2" && validateLegacyV32DraftAnswers(value.savedBrief.sourceAnswersSnapshot)
      ? { ...value.savedBrief, sourceAnswersVersion: "dcm-v3.3", sourceAnswersSnapshot: migrateV32Answers(value.savedBrief.sourceAnswersSnapshot) }
      : value.savedBrief;
    savedBrief = restoreSavedBrief(savedValue, answers);
  }
  return { schemaVersion: 2, answers, currentStage: stage, lastEditedAt: new Date(edited).toISOString(), expiresAt: new Date(expires).toISOString(), ...(savedBrief ? { savedBrief: savedBrief as SavedBrief } : {}), ...(isRecord(value.savedBrief) && !savedBrief ? { reportNeedsRegeneration: true } : {}) };
}

function legacyTimestampsForSameMigration(value: unknown, answers: DesiredClientAnswers): { edited: number; expires: number } | null {
  if (!isRecord(value) || typeof value.lastEditedAt !== "string" || typeof value.expiresAt !== "string") return null;
  const edited = Date.parse(value.lastEditedAt), expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(edited) || !Number.isFinite(expires) || expires <= edited || expires - edited > DRAFT_TTL_MS + 1000) return null;
  const schema = isRecord(value.answers) ? value.answers.schema_version : null;
  const migrated = schema === "dcm-v2.1" ? migrateV21Answers(value.answers) : schema === "dcm-v2.2" ? migrateV22Answers(value.answers) : schema === "dcm-v3.0" ? migrateV30Answers(value.answers) : schema === "dcm-v3.1" ? migrateV31Answers(value.answers) : schema === "dcm-v3.2" ? migrateV32Answers(value.answers) : null;
  return migrated && migrated.revision === answers.revision ? { edited, expires } : null;
}

function restoreSavedBrief(value: unknown, answers: DesiredClientAnswers): SavedBrief | undefined {
  if (!isRecord(value) || !Number.isSafeInteger(value.sourceBriefRevision) || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt)) || typeof value.wordingReviewed !== "boolean"
    || (value.mode !== "ai" && value.mode !== "structured")) return undefined;
  const openClarificationCode = value.openClarificationCode;
  const priorRefresh = value.refreshedFrom;
  const recoveredSections = value.recoveredSections;
  if (recoveredSections !== undefined && (!Array.isArray(recoveredSections) || recoveredSections.length !== 1 || recoveredSections[0] !== "why_firm_wants_work" || value.mode !== "ai")) return undefined;
  if (priorRefresh !== undefined && (!isRecord(priorRefresh) || !["generatedAt|wordingReviewed", "generatedAt|mode|wordingReviewed"].includes(Object.keys(priorRefresh).sort().join("|")) || typeof priorRefresh.generatedAt !== "string" || !Number.isFinite(Date.parse(priorRefresh.generatedAt)) || typeof priorRefresh.wordingReviewed !== "boolean" || (priorRefresh.mode !== undefined && priorRefresh.mode !== "ai" && priorRefresh.mode !== "structured"))) return undefined;
  const refreshedFrom: SavedBrief["refreshedFrom"] = isRecord(priorRefresh) ? { generatedAt: new Date(Date.parse(priorRefresh.generatedAt as string)).toISOString(), wordingReviewed: priorRefresh.wordingReviewed as boolean, mode: priorRefresh.mode === "ai" || priorRefresh.mode === "structured" ? priorRefresh.mode : value.mode as SavedBrief["mode"] } : undefined;
  const isLegacyV1 = isRecord(value.brief) && value.brief.report_version === "dcm-blueprint-v1";
  if (!isLegacyV1 && openClarificationCode !== undefined && (typeof openClarificationCode !== "string" || !getEligibleClarificationCodes(answers).includes(openClarificationCode as ClarificationCode))) return undefined;
  const brief = value.brief;
  if (recoveredSections && (!isRecord(brief) || brief.report_version !== "dcm-blueprint-v4" ||
    !sameJson(brief.why_firm_wants_work, buildStructuredBrief(answers).why_firm_wants_work))) return undefined;
  if (isRecord(brief) && brief.report_version === "dcm-blueprint-v1") {
    const snapshot = value.sourceAnswersSnapshot;
    if (value.sourceAnswersVersion !== "dcm-v2.2" || !isRecord(snapshot) || snapshot.schema_version !== "dcm-v2.2" ||
      snapshot.revision !== value.sourceBriefRevision || !validateLegacyAnswerSnapshot(snapshot) || !validLegacyBrief(brief, snapshot as unknown as DesiredClientAnswers)) return undefined;
    return { brief: structuredClone(brief) as unknown as LegacyDesiredClientBriefV1, sourceAnswersVersion: "dcm-v2.2", sourceAnswersSnapshot: structuredClone(snapshot), sourceBriefRevision: Number(value.sourceBriefRevision), generatedAt: new Date(Date.parse(value.generatedAt)).toISOString(), wordingReviewed: value.wordingReviewed, mode: value.mode };
  }
  if (isRecord(brief) && brief.report_version === "dcm-blueprint-v2") {
    const snapshot = value.sourceAnswersSnapshot;
    if ((value.sourceAnswersVersion !== undefined && value.sourceAnswersVersion !== "dcm-v3.0") || !isRecord(snapshot) || snapshot.schema_version !== "dcm-v3.0" || snapshot.revision !== value.sourceBriefRevision || !validSavedV2Brief(brief)) return undefined;
    return { brief: structuredClone(brief) as unknown as DesiredClientBriefV2, sourceAnswersVersion: "dcm-v3.0", sourceAnswersSnapshot: structuredClone(snapshot), sourceBriefRevision: Number(value.sourceBriefRevision), generatedAt: new Date(Date.parse(value.generatedAt)).toISOString(), wordingReviewed: value.wordingReviewed, mode: value.mode };
  }
  if (isRecord(brief) && brief.report_version === "dcm-blueprint-v3") {
    const snapshot = value.sourceAnswersSnapshot;
    if (value.sourceAnswersVersion !== "dcm-v3.1" || !isRecord(snapshot) || snapshot.schema_version !== "dcm-v3.1" || snapshot.revision !== value.sourceBriefRevision || !validateLegacyV31DraftAnswers(snapshot) || !validLegacyV3Brief(brief)) return undefined;
    return { brief: structuredClone(brief) as unknown as import("./types").DesiredClientBrief, sourceAnswersVersion: "dcm-v3.1", sourceAnswersSnapshot: structuredClone(snapshot), sourceBriefRevision: Number(value.sourceBriefRevision), generatedAt: new Date(Date.parse(value.generatedAt)).toISOString(), wordingReviewed: value.wordingReviewed, mode: value.mode };
  }
  if (value.sourceBriefRevision !== answers.revision) return undefined;
  if (value.mode === "structured") {
    const rebuilt = buildStructuredBrief(answers);
    const hasCurrentReportMarker = isRecord(brief) && brief.report_version === "dcm-blueprint-v4";
    const currentAnswerSnapshot = isRecord(value.sourceAnswersSnapshot) && value.sourceAnswersSnapshot.schema_version === "dcm-v3.3" && value.sourceAnswersSnapshot.revision === answers.revision && validateDraftAnswers(value.sourceAnswersSnapshot) && sameJson(value.sourceAnswersSnapshot, answers);
    // A prior release could preserve the v3.2 label while already storing a v3.3
    // snapshot. Treat that combination as an exact current-answer snapshot so a
    // saved report can be refreshed once, while still rejecting mismatched data.
    const exactAnswerSnapshot = (value.sourceAnswersVersion === "dcm-v3.3" || value.sourceAnswersVersion === "dcm-v3.2") && currentAnswerSnapshot;
    const reportMatchesCurrentBuilder = sameJson(brief, rebuilt);
    if (!hasCurrentReportMarker || (!reportMatchesCurrentBuilder && !exactAnswerSnapshot)) return undefined;
    const refreshRecord = reportMatchesCurrentBuilder ? refreshedFrom : (refreshedFrom ?? { generatedAt: new Date(Date.parse(value.generatedAt as string)).toISOString(), wordingReviewed: value.wordingReviewed, mode: "structured" as const });
    return { brief: rebuilt, sourceAnswersVersion: "dcm-v3.3", sourceAnswersSnapshot: structuredClone(answers), sourceBriefRevision: answers.revision, generatedAt: reportMatchesCurrentBuilder ? new Date(Date.parse(value.generatedAt as string)).toISOString() : new Date().toISOString(), wordingReviewed: reportMatchesCurrentBuilder ? value.wordingReviewed : false, mode: "structured", ...(refreshRecord ? { refreshedFrom: refreshRecord } : {}), ...(openClarificationCode ? { openClarificationCode: openClarificationCode as ClarificationCode } : {}) };
  }
  const result = validateAnalysisResult({ brief, clarification_code: null }, answers, []);
  if (!result) return undefined;
  const wordingChanged = !sameJson(brief, result.brief);
  const refreshRecord = wordingChanged ? (refreshedFrom ?? { generatedAt: new Date(Date.parse(value.generatedAt)).toISOString(), wordingReviewed: value.wordingReviewed, mode: "ai" as const }) : refreshedFrom;
  return { brief: result.brief, sourceAnswersVersion: "dcm-v3.3", sourceAnswersSnapshot: structuredClone(answers), sourceBriefRevision: answers.revision, generatedAt: wordingChanged ? new Date().toISOString() : new Date(Date.parse(value.generatedAt)).toISOString(), wordingReviewed: wordingChanged ? false : value.wordingReviewed, mode: "ai", ...(recoveredSections ? { recoveredSections: ["why_firm_wants_work"] as Array<"why_firm_wants_work"> } : {}), ...(refreshRecord ? { refreshedFrom: refreshRecord } : {}), ...(openClarificationCode ? { openClarificationCode: openClarificationCode as ClarificationCode } : {}) };
}

function validateLegacyAnswerSnapshot(value: unknown): boolean {
  return isRecord(value) && validateLegacyV22DraftAnswers(value);
}

function validLegacyV3Brief(value: Record<string, unknown>): boolean {
  if (value.report_version !== "dcm-blueprint-v3" || typeof value.definition_sentence !== "string" || !isRecord(value.definition_components) || !isRecord(value.practice_context)) return false;
  const statement = (item: unknown) => isRecord(item) && typeof item.text === "string" && !!item.text.trim() && item.text.length <= 900 && Array.isArray(item.source_answer_ids) && item.source_answer_ids.length > 0 && item.source_answer_ids.length <= 8 && typeof item.kind === "string" && typeof item.evidence_basis === "string";
  const card = (item: unknown) => isRecord(item) && Array.isArray(item.claims) && item.claims.length > 0 && item.claims.length <= 6 && item.claims.every(statement);
  return ["firm", "client_matter", "reasons", "outcome"].every((key) => statement((value.definition_components as Record<string, unknown>)[key])) &&
    ["current_practice", "work_to_grow", "experience_supporting_direction", "development_needs", "marketing_emphasis_to_reduce"].every((key) => statement((value.practice_context as Record<string, unknown>)[key])) &&
    ["desired_client_matter", "value_rationale", "relevance_signals", "opportunity_evidence", "repeatability"].every((key) => card(value[key])) && Array.isArray(value.open_questions) && value.open_questions.length <= 4 && value.open_questions.every(statement);
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
  const answers = hydrateLegacyFollowupFingerprints(value.answers);
  const savedBrief = value.savedBrief === undefined ? undefined : restoreSavedBrief(value.savedBrief, answers);
  const reportNeedsRegeneration = value.reportNeedsRegeneration === true || (value.savedBrief !== undefined && value.savedBrief !== null && !savedBrief);
  return { schemaVersion: 2, answers, currentStage: Number(value.currentStage), lastEditedAt: new Date(edited).toISOString(), expiresAt: new Date(expires).toISOString(), ...(savedBrief ? { savedBrief } : {}), ...(reportNeedsRegeneration ? { reportNeedsRegeneration: true } : {}) };
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
  if (!draft) return { status: "corrupt" };
  const structuredRefresh = !!draft.savedBrief?.refreshedFrom && isRecord(parsed) && isRecord(parsed.savedBrief) && !sameJson(parsed.savedBrief, draft.savedBrief);
  if (structuredRefresh) {
    try { storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft)); } catch { /* keep the recovered report available in memory */ }
  }
  return { status: "ready", draft, ...(structuredRefresh ? { migrated: true } : {}) };
}

export function saveDraft(storage: Storage, answers: DesiredClientAnswers, currentStage: number, savedBrief?: SavedBrief, now = Date.now(), reportNeedsRegeneration = false): DraftSaveResult {
  if (!validateDraftAnswers(answers) || !Number.isInteger(currentStage) || currentStage < 1 || currentStage > 7) return { status: "invalid" };
  let editedAt = now;
  let expiresAt = now + DRAFT_TTL_MS;
  let needsRegeneration = reportNeedsRegeneration;
  let old: string | null;
  try { old = storage.getItem(DRAFT_STORAGE_KEY); } catch { return { status: "unavailable" }; }
  try {
    if (old) {
      const parsed = JSON.parse(old) as unknown;
      const previous = validateSavedDraft(parsed);
      if (previous) needsRegeneration = needsRegeneration || previous.reportNeedsRegeneration === true;
      if (previous && previous.answers.revision === answers.revision) { editedAt = Date.parse(previous.lastEditedAt); expiresAt = Date.parse(previous.expiresAt); }
      else if (["dcm-v3.1", "dcm-v3.2", "dcm-v3.3"].includes(answers.schema_version)) {
        const legacy = legacyTimestampsForSameMigration(parsed, answers);
        if (legacy) { editedAt = legacy.edited; expiresAt = legacy.expires; }
      }
    }
  } catch { /* continue in memory and report a storage failure below */ }
  const timestamp = new Date(editedAt).toISOString();
  const safeBrief = savedBrief ? restoreSavedBrief(savedBrief, answers) : undefined;
  if (safeBrief) needsRegeneration = false;
  const draft: SavedDraft = { schemaVersion: 2, answers, currentStage, lastEditedAt: timestamp,
    expiresAt: new Date(expiresAt).toISOString(), ...(safeBrief ? { savedBrief: safeBrief } : {}), ...(needsRegeneration ? { reportNeedsRegeneration: true } : {}) };
  try { storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft)); return { status: "saved", draft }; } catch { return { status: "unavailable" }; }
}

function hydrateLegacyFollowupFingerprints(input: DesiredClientAnswers): DesiredClientAnswers {
  // Historical clarifications without a fingerprint cannot be proven to belong
  // to the current answer context. Keep them for the user's record, but do not
  // stamp them against potentially edited answers during migration.
  return input;
}
export function clearDraft(storage: Storage): boolean { try { storage.removeItem(DRAFT_STORAGE_KEY); return true; } catch { return false; } }
export function savedAnalysis(result: AnalysisResult, answers: DesiredClientAnswers): SavedBrief | undefined {
  const checked = validateAnalysisResult({ brief: result.brief, clarification_code: result.clarification_code }, answers, []);
  const recovered = result.recoveredSections?.length === 1 && result.recoveredSections[0] === "why_firm_wants_work" &&
    sameJson(result.brief.why_firm_wants_work, buildStructuredBrief(answers).why_firm_wants_work);
  return checked ? { brief: checked.brief, sourceAnswersVersion: "dcm-v3.3", sourceAnswersSnapshot: structuredClone(answers), sourceBriefRevision: answers.revision, generatedAt: new Date().toISOString(), wordingReviewed: false, mode: "ai", ...(recovered ? { recoveredSections: ["why_firm_wants_work"] as Array<"why_firm_wants_work"> } : {}) } : undefined;
}

function validSavedV2Brief(value: Record<string, unknown>): boolean {
  const same = (item: unknown) => isRecord(item) && typeof item.text === "string" && !!item.text.trim() && item.text.length <= 900 &&
    ["experience", "preference", "hypothesis", "unknown", "suggestion"].includes(String(item.kind)) && Array.isArray(item.source_answer_ids) && item.source_answer_ids.length > 0 && item.source_answer_ids.length <= 8 &&
    ["firm_reported_recorded", "firm_reported_estimate", "firm_preference", "source_observed", "hypothesis", "unknown"].includes(String(item.evidence_basis));
  const card = (item: unknown) => isRecord(item) && Array.isArray(item.claims) && item.claims.length > 0 && item.claims.length <= 6 && item.claims.every(same);
  return Object.keys(value).sort().join("|") === ["definition_sentence", "definition_components", "desired_client_matter", "open_questions", "opportunity_evidence", "practice_context", "repeatability", "report_version", "relevance_signals", "value_rationale"].sort().join("|") &&
    typeof value.definition_sentence === "string" && isRecord(value.definition_components) && ["firm", "client_matter", "reasons", "outcome"].every((key) => same(value.definition_components && (value.definition_components as Record<string, unknown>)[key])) &&
    ["practice_context", "desired_client_matter", "value_rationale", "relevance_signals", "opportunity_evidence", "repeatability"].every((key) => card(value[key])) && Array.isArray(value.open_questions) && value.open_questions.length <= 4 && value.open_questions.every(same);
}
