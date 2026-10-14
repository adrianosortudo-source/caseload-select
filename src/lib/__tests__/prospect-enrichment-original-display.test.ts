import { describe, expect, it } from "vitest";
import { createProspectEnrichmentFixtures } from "../__fixtures__/prospect-enrichment-v1";
import { prospectEnrichmentProtocolHash as hash } from "../prospect-enrichment-hash";
import { encodeBoundedProspectEnvelope } from "../prospect-enrichment-original-content";
import { verifyBoundedOriginalForDisplay } from "../prospect-enrichment-original-display";
import type { JsonValue } from "../prospect-enrichment-contract";
function fixture() {
  const base = structuredClone(createProspectEnrichmentFixtures()[0].envelope);
  const content: Record<string, JsonValue> = { "": false, "slash/key~": [], unknown: null, long: "🧭".repeat(20_000), small: 1e-7, large: 1e21 };
  let child = content;
  for (let i = 0; i < 16; i++) { child.nested = {}; child = child.nested as Record<string, JsonValue>; }
  child.answer = "Original research remains data.";
  return encodeBoundedProspectEnvelope({ ...base, originalResearch: { ...base.originalResearch, content, contentSha256: hash(content) } });
}
describe("browser original evidence verification", () => {
  it("reconstructs deep Unicode original evidence and independently checks all three hashes", async () => {
    const envelope = fixture();
    const result = await verifyBoundedOriginalForDisplay(envelope, hash(envelope));
    expect(hash(result.content)).toBe(envelope.originalResearch.contentSha256);
    expect(result.logicalEnvelope.originalResearch).toMatchObject({ content: result.content });
    expect(envelope.originalResearch.content).not.toEqual(result.content);
  });
  it.each(["representationSha256", "contentSha256"])("fails closed on tampered %s", async key => {
    const envelope = fixture();
    await expect(verifyBoundedOriginalForDisplay({ ...envelope, originalResearch: { ...envelope.originalResearch, [key]: "0".repeat(64) } })).rejects.toThrow("verification failed");
  });
  it("fails closed on changed retained envelope content", async () => {
    const envelope = fixture();
    await expect(verifyBoundedOriginalForDisplay({ ...envelope, sourceName: "changed" }, hash(envelope))).rejects.toThrow("verification failed");
  });
  it("never auto-decodes a v1 document that resembles bounded transport", async () => {
    const envelope = fixture();
    await expect(verifyBoundedOriginalForDisplay({ ...envelope, schemaVersion: "prospect-enrichment/v1" })).rejects.toThrow("unsupported");
  });
  it("rejects malformed nodes before attempting canonical hashing", async () => {
    const envelope = fixture(); const deep: Record<string, unknown> = {}; let child = deep;
    for (let i = 0; i < 20_000; i++) { child.next = {}; child = child.next as Record<string, unknown>; }
    await expect(verifyBoundedOriginalForDisplay({ ...envelope, originalResearch: { ...envelope.originalResearch, content: deep } })).rejects.toThrow("original_node_representation_invalid");
  });
  it("bounds other envelope content before canonical hashing", async () => {
    const envelope = fixture(); const cyclic: Record<string, unknown> = {}; cyclic.next = cyclic;
    await expect(verifyBoundedOriginalForDisplay({ ...envelope, extra: cyclic }, hash(envelope))).rejects.toThrow("transport is invalid");
  });
});
