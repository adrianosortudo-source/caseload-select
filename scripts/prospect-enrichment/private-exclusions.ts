import fs from "node:fs/promises";
import path from "node:path";
import { compileCandidate, type CompiledPackage } from "./compiler";
import { extractCandidates, verifyManifest, type ArchivedDocument, type CandidateInput, type SourceManifest } from "./inventory";
import { DEFAULT_OUTPUT, canonicalJson, object, ordinal, protocolHash, sha256, within, type Issue } from "./model";
import type { CandidateCoverage } from "./run-manifest";

export const COHORT_SCHEMA = "prospect-exclusion-cohort-inventory/v1";
export const EXCLUSION_SCHEMA = "prospect-private-exclusions/v1";
export type IdentityNamespace = "databaseFirmId" | "stableFirmId" | "legacyFirmId" | "sourceRecordKey" | "researchKey" | "domain" | "firmName";
export type IdentityRule = { namespace: IdentityNamespace; sourceSystem: string | null; value: string };
export type ExcludedMember = { memberKey: string; identities: IdentityRule[] };
export type ClosedCohortInventory = {
  schemaVersion: typeof COHORT_SCHEMA;
  cohortId: string;
  provenance: { kind: "governed-closed-cohort-export"; exportId: string; exportedAt: string; membershipScope: "all-cohort-members-all-statuses"; membershipPolicyVersion: "closed-cohort-membership/v1" };
  declaredMemberCount: number;
  membersSha256: string;
  members: ExcludedMember[];
};
export type PrivateExclusions = {
  schemaVersion: typeof EXCLUSION_SCHEMA;
  sourceManifestSha256: string;
  cohortInventory: { sourceRoot: string; relativePath: string; fileSha256: string; schemaVersion: typeof COHORT_SCHEMA; declaredMemberCount: number };
  members: ExcludedMember[];
  rulesSha256: string;
};
export type ExclusionContext = { rules: IdentityRule[]; source: SourceManifest; originalSourceManifestSha256: string; rulesSha256: string; cohortInventorySha256: string };
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const namespaces = new Set(["databaseFirmId", "stableFirmId", "legacyFirmId", "sourceRecordKey", "researchKey", "domain", "firmName"]);
const scoped = new Set(["legacyFirmId", "sourceRecordKey", "researchKey"]);
const fail = (): never => { throw Error("exclusion_coverage_unproven"); };
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).sort(ordinal).join("\n") === [...keys].sort(ordinal).join("\n");
}
function nonempty(value: unknown): value is string { return typeof value === "string" && value.trim() === value && value.length > 0 && !/[\u0000-\u001f]/.test(value); }
export function normalizeDomain(value: unknown): string | null {
  if (!nonempty(value)) return null;
  try {
    const url = new URL(value.includes("://") ? value : "https://" + value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash || !["", "/"].includes(url.pathname)) return null;
    const domain = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ? domain : null;
  } catch { return null; }
}
function normalize(namespace: IdentityNamespace, value: unknown): string | null {
  if (!nonempty(value)) return null;
  if (namespace === "domain") return normalizeDomain(value);
  if (namespace === "databaseFirmId") return uuid.test(value) ? value.toLowerCase() : null;
  if (namespace === "stableFirmId") return /^FIRM-[0-9A-HJKMNP-TV-Z]{26}$/.test(value) ? value : null;
  if (namespace === "sourceRecordKey") return /^[a-z0-9][a-z0-9-]{1,159}$/.test(value) ? value : null;
  if (namespace === "firmName") return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  return value;
}
function members(value: unknown): ExcludedMember[] {
  if (!Array.isArray(value) || value.length === 0) return fail();
  const memberKeys = new Set<string>(), ruleOwners = new Set<string>();
  const result = value.map(member => {
    if (!exact(member, ["memberKey", "identities"]) || !nonempty(member.memberKey) || memberKeys.has(member.memberKey) || !Array.isArray(member.identities) || !member.identities.length) return fail();
    memberKeys.add(member.memberKey);
    const identities = member.identities.map(rule => {
      if (!exact(rule, ["namespace", "sourceSystem", "value"]) || !namespaces.has(String(rule.namespace))) return fail();
      const namespace = rule.namespace as IdentityNamespace;
      if (scoped.has(namespace) ? !nonempty(rule.sourceSystem) : rule.sourceSystem !== null) return fail();
      const value = normalize(namespace, rule.value);
      if (!value || value !== rule.value) return fail();
      const normalized = { namespace, sourceSystem: rule.sourceSystem as string | null, value };
      const key = canonicalJson(normalized);
      if (ruleOwners.has(key)) return fail();
      ruleOwners.add(key);
      return normalized;
    }).sort((a, b) => ordinal(canonicalJson(a), canonicalJson(b)));
    if (identities.filter(i => i.namespace === "databaseFirmId").length !== 1 || identities.filter(i => i.namespace === "domain").length !== 1) return fail();
    return { memberKey: member.memberKey, identities };
  }).sort((a, b) => ordinal(a.memberKey, b.memberKey));
  // Canonical order prevents alternate hashes for identical sets.
  if (canonicalJson(result) !== canonicalJson(value)) return fail();
  return result;
}

/** Independent inventory bytes must be an unchanged, whole artifact in the frozen source manifest. */
export function validatePrivateExclusions(source: SourceManifest, input: unknown, cohortBytes: Uint8Array): ExclusionContext {
  verifyManifest(source);
  if ("exclusionScope" in source || !exact(input, ["schemaVersion", "sourceManifestSha256", "cohortInventory", "members", "rulesSha256"]) || input.schemaVersion !== EXCLUSION_SCHEMA || input.sourceManifestSha256 !== source.manifestSha256) return fail();
  const ref = input.cohortInventory;
  if (!exact(ref, ["sourceRoot", "relativePath", "fileSha256", "schemaVersion", "declaredMemberCount"]) || ref.schemaVersion !== COHORT_SCHEMA || !hash.test(String(ref.fileSha256))) return fail();
  const artifacts = source.artifacts.filter(a => a.sourceRoot === ref.sourceRoot && a.relativePath === ref.relativePath);
  if (artifacts.length !== 1 || artifacts[0].status !== "snapshotted" || artifacts[0].sourcePointer !== "" || artifacts[0].fileSha256 !== ref.fileSha256 || sha256(cohortBytes) !== ref.fileSha256) return fail();
  let cohort: unknown;
  try { cohort = JSON.parse(Buffer.from(cohortBytes).toString("utf8")); } catch { return fail(); }
  if (!exact(cohort, ["schemaVersion", "cohortId", "provenance", "declaredMemberCount", "membersSha256", "members"]) || cohort.schemaVersion !== COHORT_SCHEMA || !nonempty(cohort.cohortId)) return fail();
  const provenance = cohort.provenance;
  if (!exact(provenance, ["kind", "exportId", "exportedAt", "membershipScope", "membershipPolicyVersion"]) || provenance.kind !== "governed-closed-cohort-export" || !nonempty(provenance.exportId) || !nonempty(provenance.exportedAt) || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(provenance.exportedAt) || !Number.isFinite(Date.parse(provenance.exportedAt)) || provenance.membershipScope !== "all-cohort-members-all-statuses" || provenance.membershipPolicyVersion !== "closed-cohort-membership/v1") return fail();
  const closedMembers = members(cohort.members), rules = members(input.members);
  if (cohort.declaredMemberCount !== closedMembers.length || ref.declaredMemberCount !== closedMembers.length || cohort.membersSha256 !== protocolHash(closedMembers) || canonicalJson(closedMembers) !== canonicalJson(rules) || input.rulesSha256 !== protocolHash(rules)) return fail();
  const { manifestSha256: originalSourceManifestSha256, ...content } = source;
  const exclusionScope = { schemaVersion: "prospect-exclusion-compile-scope/v1", originalSourceManifestSha256, rulesSha256: input.rulesSha256 as string, cohortInventorySha256: ref.fileSha256 as string };
  const scopedContent = { ...content, exclusionScope };
  return { rules: rules.flatMap(member => member.identities), source: { ...scopedContent, manifestSha256: protocolHash(scopedContent) }, ...exclusionScope };
}
export async function loadPrivateExclusions(source: SourceManifest, file: string): Promise<ExclusionContext> {
  // Private rules and archived cohort bytes never come from Git or a live DB.
  const privateReal = await fs.realpath(DEFAULT_OUTPUT), rulesReal = await fs.realpath(file);
  if (!within(privateReal, rulesReal)) throw Error("exclusions_must_be_private_local");
  const bytes = await fs.readFile(rulesReal);
  let input: unknown;
  try { input = JSON.parse(bytes.toString("utf8")); } catch { return fail(); }
  if (!object(input) || !object(input.cohortInventory)) return fail();
  const ref = input.cohortInventory;
  const artifact = source.artifacts.find(a => a.sourceRoot === ref.sourceRoot && a.relativePath === ref.relativePath);
  if (!artifact) return fail();
  const archiveReal = await fs.realpath(artifact.archivePath);
  if (!within(await fs.realpath(path.join(DEFAULT_OUTPUT, "artifacts")), archiveReal)) return fail();
  const context = validatePrivateExclusions(source, input, Uint8Array.from(await fs.readFile(archiveReal)));
  if (!(await fs.readFile(rulesReal)).equals(Uint8Array.from(bytes))) throw Error("exclusions_changed_during_read");
  return context;
}
const keyNamespaces: Record<string, IdentityNamespace> = {
  databaseFirmId: "databaseFirmId", database_firm_id: "databaseFirmId", stableFirmId: "stableFirmId", firmId: "stableFirmId",
  legacyFirmId: "legacyFirmId", sourceRecordKey: "sourceRecordKey", source_record_key: "sourceRecordKey",
  researchKey: "researchKey", workKey: "researchKey", canonicalCandidateId: "researchKey",
  canonicalDomain: "domain", normalizedDomain: "domain", domain: "domain",
  firmName: "firmName", canonicalFirmName: "firmName", legalName: "firmName",
};
type Claims = { values: IdentityRule[]; malformed: boolean };
function identityClaims(input: CandidateInput): Claims {
  const systems = new Set<string>();
  function findSystems(v: unknown): void {
    if (Array.isArray(v)) { v.forEach(findSystems); return; }
    if (!object(v)) return;
    for (const [k, child] of Object.entries(v)) { if (k === "sourceSystem" && nonempty(child)) systems.add(child); else if (k === "sourceSystem" && child != null) systems.add(""); findSystems(child); }
  }
  findSystems(input.original); findSystems(input.parentMetadata);
  const system = systems.size === 1 ? [...systems][0] : systems.size === 0 ? input.artifact.sourceRoot : null;
  const result: Claims = { values: [], malformed: systems.size > 1 || system === null || system === "" };
  function collect(v: unknown, aliasContext = false): void {
    if (Array.isArray(v)) { v.forEach(child => collect(child, aliasContext)); return; }
    if (!object(v)) { if (aliasContext && v != null) result.malformed = true; return; }
    for (const [key, child] of Object.entries(v)) {
      if ((key === "identityState" && child === "conflict") || (key === "identityConflict" && object(child) && child.state === "confirmed")) result.malformed = true;
      const ns = (key === "firmId" && typeof child === "string" && uuid.test(child) ? "databaseFirmId" : Object.hasOwn(keyNamespaces, key) ? keyNamespaces[key] : undefined) ?? (aliasContext && key === "name" ? "firmName" : undefined);
      if (ns && child != null) {
        const values = Array.isArray(child) ? child : [child];
        if (!values.length) result.malformed = true;
        for (const value of values) {
          const normalized = normalize(ns, value);
          if (!normalized || (scoped.has(ns) && !system)) result.malformed = true;
          else result.values.push({ namespace: ns, sourceSystem: scoped.has(ns) ? system : null, value: normalized });
        }
      }
      if (!ns && key !== "sourceSystem") collect(child, aliasContext || /identity|aliases|alias|firmSubject/i.test(key));
    }
  }
  collect(input.original); collect(input.parentMetadata);
  result.values = [...new Map(result.values.map(v => [canonicalJson(v), v])).values()];
  return result;
}
export function containsExclusionToken(value: unknown, context: ExclusionContext): boolean {
  const tokens = context.rules.map(rule => rule.value.normalize("NFKC").toLowerCase());
  function walk(v: unknown): boolean {
    if (typeof v === "string") {
      const text = v.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
      return tokens.some(token => text.includes(token));
    }
    if (Array.isArray(v)) return v.some(walk);
    return object(v) && Object.entries(v).some(([key, child]) => walk(key) || walk(child));
  }
  return walk(value);
}
export function screenCandidate(input: CandidateInput, context: ExclusionContext): "excluded" | "identity_uncertain" | "eligible" {
  const claims = identityClaims(input);
  if (claims.values.some(claim => context.rules.some(rule => canonicalJson(rule) === canonicalJson(claim)))) return "excluded";
  if (claims.malformed) return "identity_uncertain";
  const count = (ns: IdentityNamespace) => new Set(claims.values.filter(c => c.namespace === ns).map(c => c.value)).size;
  if (count("databaseFirmId") !== 1 || count("domain") !== 1 || [...namespaces].some(ns => count(ns as IdentityNamespace) > 1)) return "identity_uncertain";
  if (containsExclusionToken(input, context)) return "identity_uncertain";
  return "eligible";
}
export function assertNoExclusionTokens(value: unknown, context: ExclusionContext): void {
  if (containsExclusionToken(value, context)) throw Error("exclusion_token_in_compiled_output");
}
function scopedCandidates(document: ArchivedDocument): { candidates: CandidateInput[]; unknownCount: number; issues: Issue[] } {
  const candidates: CandidateInput[] = []; let unknownCount = 0;
  function walk(value: unknown, pointer: string, parentMetadata: Record<string, unknown>, collectionMember = false): void {
    if (Array.isArray(value)) { value.forEach((v, index) => walk(v, pointer + "/" + index, parentMetadata, true)); return; }
    if (!object(value)) { if (collectionMember) unknownCount++; return; }
    const record = object(value.record) ? value.record : value;
    const recognized = ["firmName","canonicalFirmName","canonicalCandidateId","sourceRecordKey","researchKey","workKey","databaseFirmId"].some(key => value[key] !== undefined || record[key] !== undefined);
    const collections = ["records","candidates","firms","packages","items","results"].filter(key => Array.isArray(value[key]));
    if (!recognized && collections.length) {
      const metadata = Object.fromEntries(Object.entries(value).filter(([, child]) => !Array.isArray(child)));
      if (Object.hasOwn(metadata, "__exclusionAncestorMetadata")) throw Error("exclusion_metadata_namespace_collision");
      collections.forEach(key => walk(value[key], pointer + "/" + key, { ...metadata, __exclusionAncestorMetadata: parentMetadata }));
    } else if (recognized || collectionMember || ["sources","observations","evidence"].some(key => Array.isArray(value[key]))) {
      candidates.push({ original: value, parentMetadata, pointer, artifact: document.artifact });
    }
  }
  walk(document.value, document.pointer, {});
  return { candidates, unknownCount, issues: candidates.length || unknownCount ? [] : extractCandidates(document).issues };
}

export function compileExclusionScoped(context: ExclusionContext, documents: ArchivedDocument[], initialIssues: Issue[] = []) {
  const candidates: CandidateCoverage[] = [], packages: CompiledPackage[] = [], issues = [...initialIssues];
  let excludedCount = 0, identityUncertainHoldCount = 0, eligibleCount = 0;
  for (const document of documents) {
    // The independent membership inventory is governance metadata, never candidate research.
    if (document.artifact.fileSha256 === context.cohortInventorySha256) continue;
    const extraction = scopedCandidates(document); issues.push(...extraction.issues); identityUncertainHoldCount += extraction.unknownCount;
    for (const candidate of extraction.candidates) {
      const status = screenCandidate(candidate, context);
      if (status === "excluded") { excludedCount++; continue; }
      if (status === "identity_uncertain") { identityUncertainHoldCount++; continue; }
      const result = compileCandidate(candidate, context.source);
      // A generated or parent-retained field cannot silently reintroduce excluded content.
      if (containsExclusionToken(result, context)) { identityUncertainHoldCount++; continue; }
      eligibleCount++;
      packages.push(...result.packages); issues.push(...result.issues);
      candidates.push({ researchKey: result.researchKey, sourceRoot: candidate.artifact.sourceRoot, relativePath: candidate.artifact.relativePath, sourcePointer: candidate.pointer, sourceSha256: candidate.artifact.fileSha256, original: result.retainedOriginal, packageIds: result.packages.map(p => p.envelope.packageId), issues: result.issues });
    }
  }
  assertNoExclusionTokens({ candidates, packages, issues }, context);
  const content = {
    schemaVersion: "prospect-private-exclusion-audit/v1", originalSourceManifestSha256: context.originalSourceManifestSha256,
    compileSourceManifestSha256: context.source.manifestSha256, rulesSha256: context.rulesSha256, cohortInventorySha256: context.cohortInventorySha256,
    candidateOccurrenceCount: excludedCount + identityUncertainHoldCount + eligibleCount, excludedCount, identityUncertainHoldCount, eligibleCount,
    compiledPackageCount: packages.length, eligibleCompilerHoldCount: candidates.filter(c => !c.packageIds.length).length,
    tokenScan: "passed", identityAuthority: "source-claims-only", networkRequests: 0,
  };
  return { candidates, packages, issues, audit: { ...content, auditSha256: protocolHash(content) } };
}
