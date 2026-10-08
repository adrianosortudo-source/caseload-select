import { describe, expect, it } from "vitest";
import { validateAnalysisResult, validateAnalysisResponseResult, type AnalysisValidationFailure } from "../output";
import { mixedPaymentProviderBlueprint, negativeEconomicsAnswers, providerBlueprint, validBlueprint } from "./blueprint-helpers";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { buildDesiredClientEvidenceGroups, getProviderEvidenceSelection, isUnresolvedEvidenceSource, safeEvidenceDiagnostic } from "../evidence-contract";
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
  decoded.brief.why_firm_wants_work.claims.forEach((claim,index) => {
   claim.text = `DISCARDED_GENERATED_SENTINEL_${index}: 99 clients, audited records prove positive contribution, and payment is not predictable.`;
  });
  const { result, failures } = inspect(decoded, answers);
  expect(result, JSON.stringify(failures)).not.toBeNull();
  expect(result!.recoveredSections).toEqual(["why_firm_wants_work"]);
  const builder = buildStructuredBlueprintV4(answers);
  expect(result!.brief.why_firm_wants_work.claims.slice(0, builder.why_firm_wants_work.claims.length)).toEqual(builder.why_firm_wants_work.claims);
  expect(result!.brief.why_firm_wants_work.claims).toHaveLength(7);
  const baseline = validateAnalysisResult(validBlueprint(answers), answers, [])!;
  for (const key of Object.keys(baseline.brief) as Array<keyof typeof baseline.brief>) {
   if (key !== "why_firm_wants_work") expect(result!.brief[key]).toEqual(baseline.brief[key]);
  }
  const claims = result!.brief.why_firm_wants_work.claims;
  const unknownDevelopment = claims.find(claim => claim.source_answer_ids.includes("practice.development_needs"));
  expect(unknownDevelopment).toMatchObject({ kind: "unknown", evidence_basis: "unknown", text: expect.stringContaining("development needs") });
  expect(unknownDevelopment?.text).toMatch(/not specified|unspecified|unknown/iu);
  const selectedPaths = buildDesiredClientEvidenceGroups("why_firm_wants_work", answers)
   .filter(group => raw.brief.why_firm_wants_work.claims.some(claim => claim.evidence_group_ids.includes(group.id)))
   .flatMap(group => group.source_answer_ids);
  const retainedSources = new Set<string>();
  const collectSources = (node: unknown): void => {
   if (Array.isArray(node)) { node.forEach(collectSources); return; }
   if (!node || typeof node !== "object") return;
   const value = node as Record<string, unknown>;
   if (Array.isArray(value.source_answer_ids)) value.source_answer_ids.forEach(path => { if (typeof path === "string") retainedSources.add(path); });
   Object.values(value).forEach(collectSources);
  };
  collectSources(result);
  for (const path of selectedPaths) expect(retainedSources.has(path)).toBe(true);
  expect(selectedPaths).toContain("delivery.fit_signals");
  expect(result!.brief.recognizable_circumstances.claims.some(claim => claim.source_answer_ids.includes("delivery.fit_signals"))).toBe(true);
  expect(claims.every(claim => claim.source_answer_ids.length <= 8)).toBe(true);
  expect(JSON.stringify(result)).not.toContain("DISCARDED_GENERATED_SENTINEL");
  expect(JSON.stringify(result)).not.toContain("99 clients");
  expect(JSON.stringify(result)).not.toContain("audited records prove");
  expect(JSON.stringify(result)).not.toContain("payment is not predictable");
  const selectedDirection = claims.find(claim => claim.source_answer_ids.includes("practice.direction"));
  expect(selectedDirection).toMatchObject({ kind: "preference", evidence_basis: "firm_preference", text: expect.stringContaining("The firm prefers this selected growth direction:") });
  expect(selectedDirection?.text).toContain("Grow work the firm is equipped to handle");
  expect(claims.some(claim => claim.source_answer_ids.includes("practice.enjoys"))).toBe(true);
  expect(claims.some(claim => claim.source_answer_ids.includes("practice.capability"))).toBe(true);
  const firmType = claims.find(claim => claim.source_answer_ids.includes("practice.firm_type"));
  expect(firmType).toMatchObject({ evidence_basis: "firm_reported_experience", text: expect.stringContaining(answers.practice.firm_type) });
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
  expect(result?.brief.why_firm_wants_work?.claims.slice(0, buildStructuredBlueprintV4(answers).why_firm_wants_work.claims.length)).toEqual(buildStructuredBlueprintV4(answers).why_firm_wants_work.claims);
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
  ["selection_count", "selection_count"], ["over_limit", "card_claim_limit"], ["source_coverage", "source_coverage"],
 ])("keeps %s fail-closed and identifies the recovery gate", (mutation, reason) => {
  const { answers, raw, decode } = setup();
  const claims = raw.brief.why_firm_wants_work.claims;
  const mixed = claims[6];
  if (mutation === "unknown") mixed.evidence_group_ids.push("private-unrecognized-id-sentinel");
  if (mutation === "duplicate") mixed.evidence_group_ids.push(mixed.evidence_group_ids[0]);
  if (mutation === "wrong_slot") mixed.evidence_group_ids.push(buildDesiredClientEvidenceGroups("evidence_and_open_questions", answers)[0].id);
  if (mutation === "selection_count") mixed.evidence_group_ids = buildDesiredClientEvidenceGroups("why_firm_wants_work", answers).slice(0, 9).map(group => group.id);
  if (mutation === "over_limit") claims.push(structuredClone(claims[0]));
  if (mutation === "source_coverage") raw.brief.recognizable_circumstances.claims[0].text = "A routine matter may proceed normally.";
  const { result, diagnostic, failures } = inspect(decode(), answers);
  expect(result).toBeNull();
  expect(diagnostic?.reason).toBe(reason);
  expect(diagnostic?.cardClaimCount).toBe(mutation === "over_limit" ? 8 : 7);
  if (mutation === "source_coverage") expect(diagnostic?.missingSourceCount).toBe(1);
  expect(JSON.stringify(failures)).not.toContain("private-unrecognized-id-sentinel");
 });

 it.each(["client_and_matter", "client_goals_needs", "why_firm_wants_work", "why_client_chooses_firm", "recognizable_circumstances"] as const)(
  "still rejects invalid content in untouched section %s through normal validation", section => {
   const answers = negativeEconomicsAnswers();
   const candidate = validBlueprint(answers);
   const card = candidate.brief[section];
   card.claims[0].text = "Invented: 99 clients received audited positive returns.";
   expect(validateAnalysisResult(candidate, answers, [])).toBeNull();
  });

 it("identifies lost selector metadata on an earlier claim without guessing at the live output", () => {
  const { answers, decode } = setup();
  const decoded = decode();
  decoded.brief.why_firm_wants_work.claims[0] = { ...decoded.brief.why_firm_wants_work.claims[0] };
  const { result, diagnostic } = inspect(decoded, answers);
  expect(result).toBeNull();
  expect(diagnostic).toMatchObject({ reason: "metadata_missing", blockedClaimIndex: 1, cardClaimCount: 7 });
 });

 it("recovers each currently permitted why-firm source across known, blank and unknown answers within selector limits", () => {
  const answers = negativeEconomicsAnswers();
  const groups = buildDesiredClientEvidenceGroups("why_firm_wants_work", answers);
  const paths = [...new Set(groups.flatMap(group => group.source_answer_ids))];
  expect(paths).toHaveLength(32);
  for (const candidate of groups) {
   const anchor = groups.find(group => group.evidence_basis !== candidate.evidence_basis &&
    group.kind !== candidate.kind && !group.source_answer_ids.some(path => candidate.source_answer_ids.includes(path))) ??
    groups.find(group => group.evidence_basis !== candidate.evidence_basis && !group.source_answer_ids.some(path => candidate.source_answer_ids.includes(path)));
   expect(anchor, `missing mixed-basis anchor for ${candidate.source_answer_ids.join(",")}`).toBeDefined();
   const raw = providerBlueprint(validBlueprint(answers), answers) as { brief: { why_firm_wants_work: { claims: Array<Record<string, unknown>> } } };
   raw.brief.why_firm_wants_work.claims = [{ text: "DISCARDED_SELECTOR_MATRIX_SENTINEL", evidence_group_ids: [anchor!.id, candidate.id] }];
   const decoded = decodeProviderEvidenceGroups(decodeProviderTargetCard(raw, answers), answers);
   const { result, failures } = inspect(decoded, answers);
   expect(result, `${candidate.id}: ${JSON.stringify(failures)}`).not.toBeNull();
   const selectedPaths = [...new Set([...anchor!.source_answer_ids, ...candidate.source_answer_ids])];
   const returned = new Set<string>();
   const collect = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    if (Array.isArray(item.source_answer_ids)) item.source_answer_ids.forEach(path => { if (typeof path === "string") returned.add(path); });
    Object.values(item).forEach(collect);
   };
   collect(result);
   for (const path of selectedPaths) {
    expect(returned.has(path), `${candidate.id} omitted ${path}`).toBe(true);
    if (isUnresolvedEvidenceSource(path, answers)) {
     const unknownClaim = JSON.stringify(result!.brief).includes(path)
      ? Object.values(result!.brief).flatMap(value => value && typeof value === "object" && "claims" in value ? (value as { claims: Array<Record<string, unknown>> }).claims : [])
       .find(claim => Array.isArray(claim.source_answer_ids) && claim.source_answer_ids.includes(path) && claim.evidence_basis === "unknown" && claim.kind === "unknown")
      : undefined;
     expect(unknownClaim, `${candidate.id} did not retain ${path} as unknown`).toBeDefined();
     expect(String(unknownClaim?.text)).toMatch(/unknown|not established|not supplied|not specified|not defined|unspecified|not yet/iu);
    }
   }
   expect(JSON.stringify(result)).not.toContain("DISCARDED_SELECTOR_MATRIX_SENTINEL");
  }
 });

 it("does not count a cross-card citation with unrelated wording as source coverage", () => {
  const { answers, raw, decode } = setup();
  raw.brief.recognizable_circumstances.claims[0].text = "A routine matter may proceed normally.";
  const { result, diagnostic } = inspect(decode(), answers);
  expect(result).toBeNull();
  expect(diagnostic).toMatchObject({ reason: "source_coverage", missingSourceCount: 1 });
 });

 it("does not count a cross-card citation that reverses the selected fit signal", () => {
  const { answers, raw, decode } = setup();
  raw.brief.recognizable_circumstances.claims[0].text = "The client is not open to agreeing the scope and next step.";
  const { result, diagnostic } = inspect(decode(), answers);
  expect(result).toBeNull();
  expect(diagnostic).toMatchObject({ reason: "source_coverage", missingSourceCount: 1 });
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
  expect(diagnostic).toMatchObject({ claimIndex: 9, claimIndexCapped: false, selectionFailure: "duplicate_group_id", rawGroupIdCount: 6, uniqueGroupIdCount: 5, resolvedGroupIdCount: 5, groupIdCountsCapped: false });
  expect(JSON.stringify(diagnostic)).not.toContain("private-unrecognized-id-sentinel");
  expect(safeEvidenceDiagnostic("why_firm_wants_work", claim, 99, answers)).toMatchObject({ claimIndex: 32, claimIndexCapped: true });
  mixed.evidence_group_ids = Array.from({ length: 100 }, () => "private-unrecognized-id-sentinel");
  expect(safeEvidenceDiagnostic("why_firm_wants_work", decode().brief.why_firm_wants_work.claims[6], 0, answers)).toMatchObject({ rawGroupIdCount: 32, uniqueGroupIdCount: 1, resolvedGroupIdCount: 0, groupIdCountsCapped: true });
 });
});
