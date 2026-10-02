import { TextDecoder } from "node:util";
import {
  parseProspectEnrichmentEnvelope,
  PROSPECT_ENRICHMENT_KINDS,
  type JsonValue,
  type ProspectEnrichmentEnvelope,
  type ProspectEnrichmentKind,
  type ProspectEnrichmentObservation,
  type ProspectEnrichmentObservationData,
  type ProspectEnrichmentSource,
} from "../../src/lib/prospect-enrichment-contract";
import { canonicalJson, object, protocolHash, sha256, type Issue } from "./model";
import { WHOLE_FIRM_PROFILE } from "./profiles";
import { validateOutboundUrl } from "../../src/lib/ssrf";
import type { PublicSourceCaptureReceipt } from "./public-source-capture";
import type { WholeFirmCoordinatorExport } from "./whole-firm";

export const PUBLIC_FACTS_SCHEMA_VERSION = "prospect-public-facts/v1" as const;
const BODY_CHUNK_CHARACTERS = 32_768;
const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const nonempty = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && Buffer.byteLength(v, "utf8") <= max;
const json = (v: unknown): JsonValue => JSON.parse(canonicalJson(v)) as JsonValue;
const utcTime = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v) || !Number.isFinite(Date.parse(v))) return false;
  return new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
};

export type PublicFactOriginalLink = {
  sourceManifestSha256: string | null;
  revisionId: string | null;
  packageId: string | null;
  payloadSha256: string | null;
  sourcePointer: string;
};
export type PublicFactContentLocator = { startByte: number; endByte: number };
export type PublicVerificationFact = {
  [K in ProspectEnrichmentKind]: {
    kind: K;
    data: ProspectEnrichmentObservationData[K];
    disposition: "supported" | "held";
    reason: string | null;
    verifiedAt: string | null;
    excerpt: string;
    contentLocator: PublicFactContentLocator;
    excerptExtractionMethod: "utf8-byte-range/v1";
  };
}[ProspectEnrichmentKind];
export type PublicFactsInput = {
  schemaVersion: typeof PUBLIC_FACTS_SCHEMA_VERSION;
  researchKey: string;
  displayName: string;
  canonicalDomain: string | null;
  originalLinks: PublicFactOriginalLink[];
  facts: PublicVerificationFact[];
};
export type PublicVerificationBuildInput = {
  receipt: PublicSourceCaptureReceipt;
  receiptPath: string;
  receiptSha256: string;
  body: Buffer;
  facts: unknown;
  snapshotAt: string;
  factsSourcePath: string;
  factsSourceSha256: string;
};
export type PublicVerificationBuildResult = {
  exported: WholeFirmCoordinatorExport;
  issues: Issue[];
  supportedFactCount: number;
  heldFactCount: number;
};

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function issue(code: string, path: string, reason: string): Issue { return { code, path, reason }; }
function subject(facts: PublicFactsInput): ProspectEnrichmentEnvelope["subject"] {
  return { researchKey: facts.researchKey, displayName: facts.displayName, canonicalDomain: facts.canonicalDomain, databaseFirmId: null, stableFirmId: null, sourceRecordKey: null, identityState: "unresolved" };
}
function envelope(input: PublicVerificationBuildInput, facts: PublicFactsInput, original: JsonValue, sources: ProspectEnrichmentSource[], observations: ProspectEnrichmentObservation[]): ProspectEnrichmentEnvelope {
  return {
    schemaVersion: "prospect-enrichment/v1", runId: "run-prepared", packageId: "pe-prepared", supersedesPackageId: null,
    sourceSystem: WHOLE_FIRM_PROFILE.sourceSystem, sourceName: WHOLE_FIRM_PROFILE.sourceName, generatedAt: input.snapshotAt, mode: "propose",
    subject: subject(facts), sources, observations, assessment: null,
    originalResearch: { sourcePath: input.factsSourcePath, sourceSha256: input.factsSourceSha256, sourcePointer: "", contentSha256: protocolHash(original), content: original, unmappedPaths: ["/capture", "/factsSource", "/responseBody"] },
    controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false },
  };
}
function typedDataIssues(kind: ProspectEnrichmentKind, data: unknown): Issue[] {
  const timestamp = "2000-01-01T00:00:00.000Z", original = {};
  const parsed = parseProspectEnrichmentEnvelope({
    schemaVersion: "prospect-enrichment/v1", runId: "run-schema-check", packageId: "pe-schema-check", supersedesPackageId: null,
    sourceSystem: WHOLE_FIRM_PROFILE.sourceSystem, sourceName: WHOLE_FIRM_PROFILE.sourceName, generatedAt: timestamp, mode: "propose",
    subject: { researchKey: "schema-check", displayName: "Schema check", canonicalDomain: null, databaseFirmId: null, stableFirmId: null, sourceRecordKey: null, identityState: "unresolved" },
    sources: [], observations: [{ observationId: "obs-schema-check", evidenceState: "asserted", retractionReason: null, retractionSourceIds: [], missingProvenanceReason: null, kind, observedAt: timestamp, observedOn: null, sourceIds: [], data, existingRecord: null }], assessment: null,
    originalResearch: { sourcePath: "schema-check", sourceSha256: "0".repeat(64), sourcePointer: "", contentSha256: protocolHash(original), content: original, unmappedPaths: [] },
    controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false },
  });
  if (parsed.ok) return [];
  // A contact edge needs the actual generated sources, so adjudicate it later.
  return parsed.issues.filter(i => i.path.startsWith("observations[0].data") && !(i.path.startsWith("observations[0].data.roleSourceIds[") && i.message.includes("must reference one of this observation's sourceIds")))
    .map(i => issue("public_fact_schema_invalid", i.path.replace("observations[0].data", "/data"), i.message));
}

/** Structural validation retains the input unchanged; support is verified separately. */
export function parsePublicFactsInput(input: unknown): { ok: true; facts: PublicFactsInput; issues: [] } | { ok: false; facts: null; issues: Issue[] } {
  const issues: Issue[] = [];
  const bad = (path: string, reason: string) => issues.push(issue("public_facts_schema_invalid", path, reason));
  if (!exactKeys(input, ["schemaVersion", "researchKey", "displayName", "canonicalDomain", "originalLinks", "facts"])) {
    bad("", "Facts require exactly the prospect-public-facts/v1 fields.");
    return { ok: false, facts: null, issues };
  }
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== PUBLIC_FACTS_SCHEMA_VERSION) bad("/schemaVersion", "Unsupported fact-input schema.");
  if (!nonempty(value.researchKey, 2000)) bad("/researchKey", "A recorded researchKey is required.");
  if (!nonempty(value.displayName, 500)) bad("/displayName", "A recorded displayName is required.");
  if (value.canonicalDomain !== null && !nonempty(value.canonicalDomain, 253)) bad("/canonicalDomain", "Use the recorded domain or null.");
  if (!Array.isArray(value.originalLinks)) bad("/originalLinks", "Original links must be an array.");
  else value.originalLinks.forEach((link, i) => {
    const at = "/originalLinks/" + i;
    if (!exactKeys(link, ["sourceManifestSha256", "revisionId", "packageId", "payloadSha256", "sourcePointer"])) { bad(at, "Original links require exact parent fields; unavailable bindings remain null."); return; }
    const v = link as Record<string, unknown>;
    for (const k of ["sourceManifestSha256", "payloadSha256"]) if (v[k] !== null && !digest(v[k])) bad(at + "/" + k, "Parent digest must be a lowercase SHA-256 or null.");
    for (const k of ["revisionId", "packageId"]) if (v[k] !== null && (!nonempty(v[k], 120) || !/^[a-z0-9][a-z0-9._:-]*$/.test(String(v[k])))) bad(at + "/" + k, "Parent ID must be an exact recorded identifier or null.");
    if (typeof v.sourcePointer !== "string" || Buffer.byteLength(v.sourcePointer, "utf8") > 2000 || (v.sourcePointer !== "" && !/^\/(?:[^~]|~[01])*$/.test(v.sourcePointer))) bad(at + "/sourcePointer", "Parent sourcePointer must be a recorded RFC 6901 pointer.");
    if ([v.sourceManifestSha256, v.revisionId, v.packageId, v.payloadSha256].every(v => v === null)) bad(at, "A link needs at least one recorded parent binding.");
  });
  if (!Array.isArray(value.facts)) bad("/facts", "Facts must be an array.");
  else value.facts.forEach((fact, i) => {
    const at = "/facts/" + i;
    if (!exactKeys(fact, ["kind", "data", "disposition", "reason", "verifiedAt", "excerpt", "contentLocator", "excerptExtractionMethod"])) { bad(at, "Each fact requires the exact typed fact and verification fields."); return; }
    const v = fact as Record<string, unknown>;
    if (typeof v.kind !== "string" || !(PROSPECT_ENRICHMENT_KINDS as readonly string[]).includes(v.kind)) bad(at + "/kind", "Unsupported observation kind.");
    else issues.push(...typedDataIssues(v.kind as ProspectEnrichmentKind, v.data).map(i => ({ ...i, path: at + i.path })));
    if (v.disposition !== "supported" && v.disposition !== "held") bad(at + "/disposition", "Disposition must be supported or held.");
    if (v.disposition === "supported" && v.reason !== null) bad(at + "/reason", "Supported facts require reason:null.");
    if (v.disposition === "held" && !nonempty(v.reason, 2000)) bad(at + "/reason", "Held facts require the actual reason.");
    if (v.verifiedAt !== null && !utcTime(v.verifiedAt)) bad(at + "/verifiedAt", "Verification time must be an actual UTC timestamp or null.");
    if (typeof v.excerpt !== "string") bad(at + "/excerpt", "Excerpt must be text, preserving the exact quote.");
    if (v.excerptExtractionMethod !== "utf8-byte-range/v1") bad(at + "/excerptExtractionMethod", "Only explicit UTF-8 byte-range extraction is supported.");
    if (!exactKeys(v.contentLocator, ["startByte", "endByte"])) bad(at + "/contentLocator", "Use exact inclusive startByte and exclusive endByte fields.");
    else {
      const locator = v.contentLocator as Record<string, unknown>;
      if (!Number.isSafeInteger(locator.startByte) || !Number.isSafeInteger(locator.endByte) || Number(locator.startByte) < 0 || Number(locator.endByte) < Number(locator.startByte)) bad(at + "/contentLocator", "Byte offsets must be nonnegative ordered integers.");
    }
  });
  return issues.length ? { ok: false, facts: null, issues } : { ok: true, facts: input as PublicFactsInput, issues: [] };
}

function eventId(prefix: "src" | "obs", researchKey: string, kind: string, semantic: unknown): string {
  return prefix + "-" + protocolHash([WHOLE_FIRM_PROFILE.adapterVersion, WHOLE_FIRM_PROFILE.sourceSystem, researchKey, kind, semantic]).slice(0, 48);
}
function captureIssues(input: PublicVerificationBuildInput): Issue[] {
  const issues: Issue[] = [];
  const bad = (path: string, reason: string) => issues.push(issue("public_capture_binding_invalid", path, reason));
  const receiptValue: unknown = input.receipt;
  const r: Record<string, unknown> = object(receiptValue) ? receiptValue : {};
  if (!exactKeys(r, ["schemaVersion", "requestedUrl", "finalUrl", "retrievedAt", "startedAt", "httpStatus", "contentType", "bytes", "bodySha256", "bodyFile", "method", "observationsVerified"]) || r.schemaVersion !== "prospect-public-source-capture/v1" || r.method !== "public-https-get" || r.observationsVerified !== false) bad("/capture/receipt", "An unchanged successful capture receipt is required; capture does not assert content verification.");
  if (!utcTime(r.startedAt) || !utcTime(r.retrievedAt) || Date.parse(r.startedAt) > Date.parse(r.retrievedAt) || Date.parse(r.retrievedAt) - Date.parse(r.startedAt) > 20_000) bad("/capture/receipt/retrievedAt", "Capture timestamps must be consistent and within the 20-second retrieval bound.");
  if (!Number.isInteger(r.httpStatus) || Number(r.httpStatus) < 200 || Number(r.httpStatus) >= 300 || !Buffer.isBuffer(input.body) || input.body.byteLength === 0 || input.body.byteLength > MAX_CAPTURE_BYTES || r.bytes !== input.body.byteLength) bad("/responseBody", "Capture must be successful, nonempty, within 5 MiB and exact in size.");
  if (!digest(r.bodySha256) || sha256(input.body) !== r.bodySha256) bad("/responseBody/bodySha256", "Captured body bytes do not match the receipt hash.");
  if (r.bodyFile !== "bodies/" + r.bodySha256 + ".body" || !(r.contentType === null || (typeof r.contentType === "string" && r.contentType.length <= 16_384))) bad("/capture/receipt", "Capture must retain its hash-named body file and actual nullable content type.");
  const urls: URL[] = [];
  for (const key of ["requestedUrl", "finalUrl"] as const) {
    try {
      if (typeof r[key] !== "string" || !r[key] || r[key].trim() !== r[key] || r[key].length > 8192) throw Error();
      const u = new URL(r[key]); if (!validateOutboundUrl(u).ok || u.hash) throw Error(); urls.push(u);
    }
    catch { bad("/capture/receipt/" + key, "Only the actual public HTTPS URL is supported."); }
  }
  if (urls.length === 2 && (urls[0].origin !== urls[1].origin || r.finalUrl !== urls[1].href)) bad("/capture/receipt/finalUrl", "A verified receipt requires a canonical final URL on the requested origin.");
  if (!nonempty(input.receiptPath, 2000) || !digest(input.receiptSha256)) bad("/capture/receiptSha256", "The loader must provide an exact receipt path and file digest.");
  return issues;
}

/**
 * Pure offline builder. It binds a researcher's explicit support declaration to
 * captured bytes; it does not decide semantic truth, resolve firms or transport.
 */
export function buildPublicVerificationExport(input: PublicVerificationBuildInput): PublicVerificationBuildResult {
  if (!utcTime(input.snapshotAt)) throw Error("public_verification_snapshot_invalid");
  // Non-JSON caller values cannot be retained truthfully. The file CLI supplies parsed JSON.
  const immutableFacts = json(input.facts), immutableReceipt = json(input.receipt);
  const parsed = parsePublicFactsInput(immutableFacts), issues = [...parsed.issues, ...captureIssues(input)];
  if (!nonempty(input.factsSourcePath, 2000) || !digest(input.factsSourceSha256)) issues.push(issue("public_facts_binding_invalid", "/factsSource", "Exact fact-file path and SHA-256 are required."));
  if (object(input.receipt) && utcTime(input.receipt.retrievedAt) && Date.parse(input.receipt.retrievedAt) > Date.parse(input.snapshotAt)) issues.push(issue("public_capture_binding_invalid", "/snapshotAt", "Snapshot cannot precede retrieval completion."));
  const facts = parsed.ok ? parsed.facts : null;
  const rawFacts = object(immutableFacts) && Array.isArray(immutableFacts.facts) ? immutableFacts.facts : [];
  const researchKey = facts?.researchKey ?? (object(immutableFacts) && nonempty(immutableFacts.researchKey, 2000) ? immutableFacts.researchKey : "public-verification-hold:" + protocolHash([input.receiptSha256, input.factsSourceSha256]));
  const sources: ProspectEnrichmentSource[] = [], observations: ProspectEnrichmentObservation[] = [], verificationRecords: JsonValue[] = [];
  const blockingInput = issues.length > 0;
  if (facts && !blockingInput) facts.facts.forEach((fact, index) => {
    const at = "/factsSource/content/facts/" + index;
    if (fact.disposition === "held") { issues.push(issue("public_fact_held", at, fact.reason!)); return; }
    let hold: string | null = null;
    if (!utcTime(fact.verifiedAt) || Date.parse(fact.verifiedAt) < Date.parse(input.receipt.retrievedAt) || Date.parse(fact.verifiedAt) > Date.parse(input.snapshotAt)) hold = "Actual content verification must occur after retrieval and no later than the snapshot.";
    const { startByte, endByte } = fact.contentLocator;
    if (!hold && (endByte > input.body.byteLength || endByte <= startByte || endByte - startByte > 4000 || Buffer.byteLength(fact.excerpt, "utf8") > 4000)) hold = "Supporting excerpt must be a nonempty captured byte range of at most 4000 bytes.";
    if (!hold) {
      try {
        const bytes = input.body.subarray(startByte, endByte), quote = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        if (quote !== fact.excerpt || !Buffer.from(fact.excerpt, "utf8").equals(bytes)) hold = "The quote does not equal the exact UTF-8 byte range in the immutable body.";
      } catch { hold = "The supporting byte range is not complete valid UTF-8."; }
    }
    if (!hold && fact.kind === "contact" && fact.data.roleSourceIds.length > 0) hold = "Existing contact-role source references have no verified binding in this additive capture; retain them unchanged.";
    if (hold) { issues.push(issue("public_fact_verification_hold", at, hold)); return; }
    const semanticSource: Omit<ProspectEnrichmentSource, "sourceId"> = {
      url: input.receipt.finalUrl, requestedUrl: input.receipt.requestedUrl, finalUrl: input.receipt.finalUrl, policyState: "public-source",
      publicationLabel: null, publicationPrecision: "unknown", publisher: null, observedAt: fact.verifiedAt, observedOn: null,
      retrievedAt: input.receipt.retrievedAt, retrievalMethod: input.receipt.method, retrievalOutcome: "success-content-verified",
      httpStatus: input.receipt.httpStatus, bodySha256: input.receipt.bodySha256, excerpt: fact.excerpt, missingProvenanceReason: null,
    };
    const sourceId = eventId("src", researchKey, "source", { captureReceiptSha256: input.receiptSha256, content: semanticSource });
    if (!sources.some(s => s.sourceId === sourceId)) sources.push({ sourceId, ...semanticSource });
    const semanticObservation = { evidenceState: "asserted" as const, retractionReason: null, retractionSourceIds: [], missingProvenanceReason: null, kind: fact.kind, observedAt: fact.verifiedAt, observedOn: null, sourceIds: [sourceId], data: fact.data, existingRecord: null };
    const observationId = eventId("obs", researchKey, fact.kind, semanticObservation);
    if (!observations.some(o => o.observationId === observationId)) observations.push({ observationId, ...semanticObservation } as ProspectEnrichmentObservation);
    verificationRecords.push(json({ schemaVersion: "prospect-public-fact-verification/v1", captureReceiptPath: input.receiptPath, captureReceiptSha256: input.receiptSha256,
      bodyFile: input.receipt.bodyFile, bodySha256: input.receipt.bodySha256, requestedUrl: input.receipt.requestedUrl, finalUrl: input.receipt.finalUrl,
      verifiedAt: fact.verifiedAt, sourceId, observationId, kind: fact.kind, factPointer: at, excerpt: fact.excerpt,
      excerptExtractionMethod: fact.excerptExtractionMethod, contentLocator: fact.contentLocator, originalLinks: facts.originalLinks }));
  });
  const bodyBase64 = input.body.toString("base64"), chunks: string[] = [];
  for (let start = 0; start < bodyBase64.length; start += BODY_CHUNK_CHARACTERS) chunks.push(bodyBase64.slice(start, start + BODY_CHUNK_CHARACTERS));
  const original = json({ schemaVersion: "prospect-public-verification-revision/v1", disposition: "held", capture: { receiptPath: input.receiptPath, receiptSha256: input.receiptSha256, receipt: immutableReceipt },
    responseBody: { encoding: "base64", bytes: input.body.byteLength, bodySha256: sha256(input.body), chunks },
    factsSource: { path: input.factsSourcePath, sha256: input.factsSourceSha256, content: immutableFacts }, verificationRecords });
  const revisionId = "revision-" + protocolHash([researchKey, original]).slice(0, 48);
  let standardEnvelope: ProspectEnrichmentEnvelope | null = null;
  if (facts && !blockingInput && observations.length) {
    const validated = parseProspectEnrichmentEnvelope(envelope(input, facts, original, sources, observations));
    if (validated.ok) standardEnvelope = validated.envelope;
    else issues.push(...validated.issues.map(i => issue("public_verification_envelope_hold", i.path, i.message)));
  }
  if (!standardEnvelope && !issues.length) issues.push(issue("public_fact_verification_hold", "/facts", "No supported content-verification fact was supplied; retain the complete originals."));
  const exported: WholeFirmCoordinatorExport = { schemaVersion: "prospect-whole-firm-coordinator-export/v1", snapshotAt: input.snapshotAt,
    expectedRevisions: [{ revisionId, researchKey }], revisions: [{ revisionId, originalRevision: original, ...(standardEnvelope ? { standardEnvelope } : {}), producerIssues: issues }],
    sourceInventory: { schemaVersion: "prospect-public-verification-inventory/v1", receiptSha256: input.receiptSha256, factsSourceSha256: input.factsSourceSha256, bodySha256: sha256(input.body) } };
  const supportedFactCount = standardEnvelope ? verificationRecords.length : 0;
  return { exported, issues, supportedFactCount, heldFactCount: rawFacts.length - supportedFactCount };
}
