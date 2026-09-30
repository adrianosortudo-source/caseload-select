import type { ProspectEnrichmentEnvelope } from "../../src/lib/prospect-enrichment-contract";
import { object, type Issue } from "./model";

export type WholeFirmIdentityClaimPolicy = {
  schemaVersion: "prospect-whole-firm-identity-claim-policy/v1";
  policyVersion: "retained-registration-stable-claim/v1";
  parentSourceManifestSha256: string; compilerCommit: string; compilerFileSha256: string; baselineLedgerSha256: string;
};
export type RetainedStableClaimProof = { stableIdsPointer: string; receiptPointer: string; queryArtifactRefPointer: string; capturedSha256: string };
const HASH = /^[a-f0-9]{64}$/, STABLE = /^FIRM-[0-9A-HJKMNP-TV-Z]{26}$/;
export function validWholeFirmIdentityClaimPolicy(value: unknown): value is WholeFirmIdentityClaimPolicy {
  const keys = ["schemaVersion", "policyVersion", "parentSourceManifestSha256", "compilerCommit", "compilerFileSha256", "baselineLedgerSha256"];
  return object(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)) && value.schemaVersion === "prospect-whole-firm-identity-claim-policy/v1" && value.policyVersion === "retained-registration-stable-claim/v1" && HASH.test(String(value.parentSourceManifestSha256)) && /^[a-f0-9]{40}$/.test(String(value.compilerCommit)) && HASH.test(String(value.compilerFileSha256)) && HASH.test(String(value.baselineLedgerSha256));
}
function domain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const u = new URL(value.includes("://") ? value : "https://" + value);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.port || u.search || u.hash || u.pathname !== "/") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) && host.includes(".") ? host : null;
  } catch { return null; }
}

/** Retained identifiers are claims only. Fresh signed Admin registry comparison remains mandatory. */
export function retainedWholeFirmStableClaim(revision: unknown, envelope: ProspectEnrichmentEnvelope, sourceInventory: unknown): { stableFirmId: string | null; issue: Issue | null; proof: RetainedStableClaimProof | null; conflicting: boolean } {
  const fail = (reason: string, conflicting = false) => ({ stableFirmId: null, issue: { code: "retained_identity_claim_hold", path: "/candidateContext/stableIds", reason }, proof: null, conflicting });
  if (!object(revision) || revision.schemaVersion !== "whole-firm-producer-revision/v1" || !object(revision.candidateContext) || !object(revision.result) || !object(revision.result.record)) return fail("Retained producer revision context is missing.");
  const context = revision.candidateContext, record = revision.result.record, packet = object(revision.result.researchKey) ? revision.result.researchKey : {};
  if (!Array.isArray(context.stableIds) || !context.stableIds.length || context.stableIds.some(v => typeof v !== "string" || !STABLE.test(v)) || new Set(context.stableIds).size !== 1) return fail("Retained stable identifiers are missing, malformed or ambiguous.", Array.isArray(context.stableIds) && context.stableIds.length > 0);
  const stableFirmId = context.stableIds[0] as string;
  if (!Array.isArray(context.identityConflicts) || context.identityConflicts.length || envelope.subject.identityState === "conflict") return fail("Retained identity context records a conflict or lacks its explicit conflict inventory.", (Array.isArray(context.identityConflicts) && context.identityConflicts.length > 0) || envelope.subject.identityState === "conflict");
  const canonicalDomain = domain(context.canonicalDomain);
  if (!canonicalDomain || domain(record.canonicalDomain) !== canonicalDomain || domain(envelope.subject.canonicalDomain) !== canonicalDomain || (packet.canonicalDomain != null && domain(packet.canonicalDomain) !== canonicalDomain) || (typeof context.key === "string" && context.key.startsWith("domain:") && domain(context.key.slice(7)) !== canonicalDomain)) return fail("Retained candidate and packet domain claims do not match exactly.", true);
  if ([envelope.subject.stableFirmId, record.firmId, packet.stableFirmId].some(v => v != null && v !== stableFirmId)) return fail("An existing packet stable identifier differs from the retained claim.", true);
  if (!object(sourceInventory) || !object(sourceInventory.provenance) || !HASH.test(String(sourceInventory.provenance.sourceSha256)) || !Array.isArray(sourceInventory.provenance.references)) return fail("Frozen source capture provenance is missing.");
  const references = sourceInventory.provenance.references as unknown[];
  const receipts = Array.isArray(context.receipts) ? context.receipts.filter(object) : [];
  const registrations = receipts.filter(receipt => object(receipt.registration));
  const matchingDomain = (value: Record<string, unknown>) => [value.canonicalDomain, value.domain].some(v => v != null) && [value.canonicalDomain, value.domain].filter(v => v != null).every(v => domain(v) === canonicalDomain);
  if (!registrations.length || registrations.some(receipt => { const registration = receipt.registration as Record<string, unknown>; return registration.firmId !== stableFirmId || !matchingDomain(registration); })) return fail("Retained registration receipts are missing or contradict the stable identifier and domain.", registrations.length > 0);
  let proof: RetainedStableClaimProof | null = null;
  for (const receipt of registrations) {
    if (!HASH.test(String(receipt.queryArtifactSha256)) || typeof receipt.queryArtifact !== "string") continue;
    const index = references.findIndex(reference => object(reference) && reference.status === "snapshotted" && reference.value === receipt.queryArtifact && reference.sourceSha256 === receipt.queryArtifactSha256 && reference.expectedSha256 === receipt.queryArtifactSha256 && typeof reference.archivePath === "string" && reference.archivePath.endsWith(receipt.queryArtifactSha256 + ".bin"));
    if (index >= 0) { proof = { stableIdsPointer: "/candidateContext/stableIds", receiptPointer: "/candidateContext/receipts/" + (context.receipts as unknown[]).indexOf(receipt), queryArtifactRefPointer: "/sourceInventory/provenance/references/" + index, capturedSha256: String(receipt.queryArtifactSha256) }; break; }
  }
  if (!proof) return fail("No matching registration query artifact has a verified frozen capture hash.");
  const history = Array.isArray(context.history) ? context.history.filter(object).filter(entry => entry.event === "identity-bound-from-registration-readback") : [];
  if (history.some(entry => entry.firmId !== stableFirmId || !matchingDomain(entry) || (entry.queryArtifactSha256 != null && !HASH.test(String(entry.queryArtifactSha256))))) return fail("Retained identity-binding history contradicts the registration claim.", true);
  return { stableFirmId, issue: null, proof, conflicting: false };
}
