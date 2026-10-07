import { describe, expect, it } from "vitest";
import { validateAnalysisResult, validateAnalysisResponseResult, type AnalysisValidationFailure } from "../output";
import { mixedPaymentProviderBlueprint, negativeEconomicsAnswers, validBlueprint } from "./blueprint-helpers";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { buildDesiredClientEvidenceGroups, getProviderEvidenceSelection, safeEvidenceDiagnostic } from "../evidence-contract";
import { decodeProviderEvidenceGroups, decodeProviderTargetCard } from "../provider-schema";

function setup(paraphrase = true) {
 const answers = negativeEconomicsAnswers();
 const raw = mixedPaymentProviderBlueprint(answers, paraphrase);
 const decode = () => decodeProviderEvidenceGroups(decodeProviderTargetCard(raw, answers), answers) as { brief: { why_firm_wants_work: { claims: Record<string, unknown>[] } } };
 return { answers, raw, decode };
}
function inspect(value: unknown, answers: ReturnType<typeof negativeEconomicsAnswers>) {
 const failures: AnalysisValidationFailure[] = [];
 const result = validateAnalysisResult(value, answers, [], failure => failures.push(failure));
 return { result, failures, diagnostic: failures.find(failure => failure.recoveryDiagnostic)?.recoveryDiagnostic };
}

describe("complete negative-economics mixed payment recovery", () => {
 it.each([false, true])("recovers the seven-claim card with earlier context paraphrase=%s and preserves every supplied fact", paraphrase => {
  const { answers, raw, decode } = setup(paraphrase);
  expect(raw.brief.why_firm_wants_work.claims).toHaveLength(7);
  const decoded = decode();
  const metadata = decoded.brief.why_firm_wants_work.claims.map(getProviderEvidenceSelection);
  expect(metadata.every(Boolean)).toBe(true);
  expect(metadata[6]?.failure).toBe("mixed_basis_or_kind");
  const { result, failures } = inspect(decoded, answers);
  expect(result, JSON.stringify(failures)).not.toBeNull();
  expect(result!.recoveredSections).toEqual(["why_firm_wants_work"]);
  const builder = buildStructuredBlueprintV4(answers);
  expect(result!.brief.why_firm_wants_work).toEqual(builder.why_firm_wants_work);
  expect(result!.brief.why_firm_wants_work.claims).toHaveLength(6);
  const baseline = validateAnalysisResult(validBlueprint(answers), answers, [])!;
  for (const key of Object.keys(baseline.brief) as Array<keyof typeof baseline.brief>) {
   if (key !== "why_firm_wants_work") expect(result!.brief[key]).toEqual(baseline.brief[key]);
  }
  const claims = result!.brief.why_firm_wants_work.claims;
  const selectedPaths = buildDesiredClientEvidenceGroups("why_firm_wants_work", answers)
   .filter(group => raw.brief.why_firm_wants_work.claims.some(claim => claim.evidence_group_ids.includes(group.id)))
   .flatMap(group => group.source_answer_ids);
  for (const path of selectedPaths) expect(claims.some(claim => claim.source_answer_ids.includes(path))).toBe(true);
  expect(claims.every(claim => claim.source_answer_ids.length <= 8)).toBe(true);
  expect(claims.find(claim => claim.source_answer_ids.includes("value.payment"))?.evidence_basis).toBe("firm_reported_observation");
  expect(claims.find(claim => claim.source_answer_ids.includes("value.payment_context"))).toMatchObject({ evidence_basis: "client_reported", text: expect.stringContaining(answers.value.payment_context) });
  expect(JSON.stringify(result)).toContain("8000");
  expect(JSON.stringify(result)).toContain("8500");
  expect(JSON.stringify(result)).toContain("−C$500.00");
  expect(claims.find(claim => claim.source_answer_ids.includes("repeatability.additional_matters"))?.evidence_basis).toBe("firm_reported_observation");
  expect(claims.find(claim => claim.source_answer_ids.includes("repeatability.staffing_constraint"))?.evidence_basis).toBe("firm_preference");
  expect(validateAnalysisResponseResult(JSON.parse(JSON.stringify(result)), answers, [])).toEqual(result);
 });

 it.each(["replace_separate_payment", "quoted_canonical_context"])("recovers the packet's %s success variant", variant => {
  const { answers, raw, decode } = setup(false);
  const mixed = raw.brief.why_firm_wants_work.claims[6];
  if (variant === "replace_separate_payment") {
   raw.brief.why_firm_wants_work.claims = raw.brief.why_firm_wants_work.claims.filter(claim => claim === mixed || !claim.evidence_group_ids.some(id => id.includes("_payment")));
   expect(raw.brief.why_firm_wants_work.claims).toHaveLength(5);
  } else {
   mixed.text = 'The firm reports that payment is usually predictable. Basis not specified. Client feedback reported by the firm: “Clients told the firm that the first invoice was usually paid on schedule.”';
  }
  const { result } = inspect(decode(), answers);
  expect(result?.recoveredSections).toEqual(["why_firm_wants_work"]);
  expect(result?.brief.why_firm_wants_work).toEqual(buildStructuredBlueprintV4(answers).why_firm_wants_work);
 });

 it("keeps ordinary payment normalization working without a recovery marker", () => {
  const { answers, raw, decode } = setup();
  raw.brief.why_firm_wants_work.claims.pop();
  const { result } = inspect(decode(), answers);
  expect(result).not.toBeNull();
  expect(result).not.toHaveProperty("recoveredSections");
 });

 it.each([
  ["unknown", "selection_unresolved"], ["duplicate", "selection_duplicate"], ["wrong_slot", "selection_unresolved"],
  ["over_limit", "card_claim_limit"], ["omitted_meaning", "mixed_text_not_authentic"],
  ["number", "mixed_text_not_authentic"], ["negated", "mixed_text_not_authentic"],
  ["early_number", "payment_not_authentic"], ["early_negation", "payment_not_authentic"],
  ["early_audit", "payment_not_authentic"], ["source_coverage", "source_coverage"],
 ])("keeps %s fail-closed and identifies the recovery gate", (mutation, reason) => {
  const { answers, raw, decode } = setup();
  const claims = raw.brief.why_firm_wants_work.claims;
  const mixed = claims[6];
  const context = claims.find(claim => claim.evidence_group_ids.some(id => id.includes("_payment_context")))!;
  if (mutation === "unknown") mixed.evidence_group_ids.push("private-unrecognized-id-sentinel");
  if (mutation === "duplicate") mixed.evidence_group_ids.push(mixed.evidence_group_ids[0]);
  if (mutation === "wrong_slot") mixed.evidence_group_ids.push(buildDesiredClientEvidenceGroups("evidence_and_open_questions", answers)[0].id);
  if (mutation === "over_limit") claims.push(structuredClone(claims[0]));
  if (mutation === "omitted_meaning") mixed.text = answers.value.payment_context;
  if (mutation === "number") mixed.text += " This applies to 99 clients.";
  if (mutation === "negated") mixed.text = "Payment is not usually predictable. " + answers.value.payment_context;
  if (mutation === "early_number") context.text += " This applies to 99 clients.";
  if (mutation === "early_negation") context.text = "Clients reported that their first invoice was not paid on schedule.";
  if (mutation === "early_audit") context.text = "Audited records prove all clients paid the first invoice on schedule.";
  if (mutation === "source_coverage") claims[0] = { text: "The firm prefers this work.", evidence_group_ids: [buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).find(group => group.source_answer_ids.includes("direction.evidence"))!.id] };
  const { result, diagnostic, failures } = inspect(decode(), answers);
  expect(result).toBeNull();
  expect(diagnostic?.reason).toBe(reason);
  expect(diagnostic?.cardClaimCount).toBe(mutation === "over_limit" ? 8 : 7);
  if (mutation === "source_coverage") expect(diagnostic?.missingSourceCount).toBe(1);
  if (mutation.startsWith("early_")) expect(diagnostic?.blockedClaimIndex).toBe(claims.indexOf(context) + 1);
  expect(JSON.stringify(failures)).not.toContain("private-unrecognized-id-sentinel");
  expect(JSON.stringify(failures)).not.toContain(context.text);
 });

 it("identifies lost selector metadata on an earlier claim without guessing at the live output", () => {
  const { answers, decode } = setup();
  const decoded = decode();
  decoded.brief.why_firm_wants_work.claims[0] = { ...decoded.brief.why_firm_wants_work.claims[0] };
  const { result, diagnostic } = inspect(decoded, answers);
  expect(result).toBeNull();
  expect(diagnostic).toMatchObject({ reason: "metadata_missing", blockedClaimIndex: 1, cardClaimCount: 7 });
 });

 it("rejects stale payment groups after decode", () => {
  const { answers, raw, decode } = setup();
  const decoded = decode();
  const contextIndex = raw.brief.why_firm_wants_work.claims.findIndex(claim => claim.evidence_group_ids.some(id => id.includes("_payment_context")));
  answers.value.payment_context = "A different synthetic payment note.";
  const { result, diagnostic } = inspect(decoded, answers);
  expect(result).toBeNull();
  expect(diagnostic).toMatchObject({ reason: "selection_unresolved", blockedClaimIndex: contextIndex + 1 });
 });

 it("counts raw, unique and resolved selectors without logging raw IDs or collapsing positions after seven", () => {
  const { answers, raw, decode } = setup(false);
  const mixed = raw.brief.why_firm_wants_work.claims[6];
  mixed.evidence_group_ids.push(mixed.evidence_group_ids[0], "private-unrecognized-id-sentinel");
  const claim = decode().brief.why_firm_wants_work.claims[6];
  const diagnostic = safeEvidenceDiagnostic("why_firm_wants_work", claim, 8, answers);
  expect(diagnostic).toMatchObject({ claimIndex: 9, claimIndexCapped: false, selectionFailure: "duplicate_group_id", rawGroupIdCount: 4, uniqueGroupIdCount: 3, resolvedGroupIdCount: 3, groupIdCountsCapped: false });
  expect(JSON.stringify(diagnostic)).not.toContain("private-unrecognized-id-sentinel");
  expect(safeEvidenceDiagnostic("why_firm_wants_work", claim, 99, answers)).toMatchObject({ claimIndex: 32, claimIndexCapped: true });
  mixed.evidence_group_ids = Array.from({ length: 100 }, () => "private-unrecognized-id-sentinel");
  expect(safeEvidenceDiagnostic("why_firm_wants_work", decode().brief.why_firm_wants_work.claims[6], 0, answers)).toMatchObject({ rawGroupIdCount: 32, uniqueGroupIdCount: 1, resolvedGroupIdCount: 0, groupIdCountsCapped: true });
 });
});
