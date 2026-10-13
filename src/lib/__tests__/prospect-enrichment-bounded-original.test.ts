import { describe, expect, it } from "vitest";
import { createProspectEnrichmentFixtures } from "../__fixtures__/prospect-enrichment-v1";
import { buildProspectEnrichmentClientItems, parseProspectEnrichmentEnvelope, type JsonValue, type ProspectEnrichmentEnvelope } from "../prospect-enrichment-contract";
import { prospectEnrichmentProtocolHash as hash } from "../prospect-enrichment-hash";
import { encodeBoundedProspectEnvelope, readProspectOriginalContent } from "../prospect-enrichment-original-content";
import { encodeOriginalJsonNodes } from "../prospect-enrichment-original-nodes";

const fixture = () => structuredClone(createProspectEnrichmentFixtures()[0].envelope);
function originalOnly(content: JsonValue): ProspectEnrichmentEnvelope {
  const base = fixture();
  return { ...base, observations: [], sources: [], assessment: null, originalResearch: { ...base.originalResearch, content, contentSha256: hash(content) } };
}
describe("versioned bounded original evidence", () => {
  it("preserves deep original hashes and lineage while changing only the explicit transport", () => {
    const original: Record<string, JsonValue> = {}; let child = original;
    for (let i = 0; i < 16; i++) { child.receipt = {}; child = child.receipt as Record<string, JsonValue>; }
    child.criteria = { fitDecision: "pass", unknown: null, contacts: [] };
    const initial = fixture(); const base = { ...initial, originalResearch: { ...initial.originalResearch, content: original, contentSha256: hash(original) } };
    expect(parseProspectEnrichmentEnvelope(base).ok).toBe(false);
    const transport = encodeBoundedProspectEnvelope(base);
    expect(parseProspectEnrichmentEnvelope(transport).ok).toBe(true);
    expect(readProspectOriginalContent(transport)).toEqual(original);
    expect(transport.originalResearch.contentSha256).toBe(base.originalResearch.contentSha256);
    expect(transport.originalResearch.representationSha256).toBe(hash(transport.originalResearch.content));
    expect(hash(transport)).not.toBe(hash(base));
    expect(buildProspectEnrichmentClientItems(transport)).toEqual(buildProspectEnrichmentClientItems(base));
    expect(base.schemaVersion).toBe("prospect-enrichment/v1");
    expect(base.originalResearch.content).toEqual(original);
  });
  it.each(["contentSha256", "representationSha256"] as const)("rejects tampered %s", key => {
    const valid = encodeBoundedProspectEnvelope(fixture());
    const transport = { ...valid, originalResearch: { ...valid.originalResearch, [key]: "0".repeat(64) } };
    expect(parseProspectEnrichmentEnvelope(transport).ok).toBe(false);
    expect(() => readProspectOriginalContent(transport)).toThrow();
  });
  it("requires the v2 representation hash and rejects undeclared v1 extension keys", () => {
    const encoded = encodeBoundedProspectEnvelope(fixture());
    const missing = { ...encoded, originalResearch: { ...encoded.originalResearch } };
    delete missing.originalResearch.representationSha256;
    expect(parseProspectEnrichmentEnvelope(missing).ok).toBe(false);
    expect(parseProspectEnrichmentEnvelope({ ...encoded, schemaVersion: "prospect-enrichment/v1" }).ok).toBe(false);
  });
  it("does not reinterpret an ordinary v1 object that resembles a node document", () => {
    const document = JSON.parse(JSON.stringify(encodeOriginalJsonNodes({ answer: null }))) as JsonValue;
    const base = originalOnly(document);
    expect(parseProspectEnrichmentEnvelope(base).ok).toBe(true);
    expect(readProspectOriginalContent(base)).toEqual(document);
  });
  it("rejects semantic root null for an otherwise empty package", () => {
    expect(parseProspectEnrichmentEnvelope(encodeBoundedProspectEnvelope(originalOnly(null))).ok).toBe(false);
  });
  it.each([false, 0, "", [], {}] as JsonValue[])("retains meaningful original-only value %j", value => {
    const encoded = encodeBoundedProspectEnvelope(originalOnly(value));
    expect(parseProspectEnrichmentEnvelope(encoded).ok).toBe(true);
    expect(readProspectOriginalContent(encoded)).toEqual(value);
  });
  it.each(["\u0000", "\ud800", "\udc00"])("holds unsupported JSONB Unicode without replacing it", value => {
    const encoded = encodeBoundedProspectEnvelope(originalOnly(value));
    const result = parseProspectEnrichmentEnvelope(encoded);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some(issue => issue.message.includes("unsupported by JSONB"))).toBe(true);
  });
  it("retains valid paired Unicode in the database-bound representation", () => {
    expect(parseProspectEnrichmentEnvelope(encodeBoundedProspectEnvelope(originalOnly("🧭"))).ok).toBe(true);
  });
  it("keeps the existing string bound on typed observations", () => {
    const encoded = encodeBoundedProspectEnvelope(fixture());
    const oversized = { ...encoded, sources: [{ ...encoded.sources[0], excerpt: "x".repeat(65_537) }] };
    expect(parseProspectEnrichmentEnvelope(oversized).ok).toBe(false);
  });
});
