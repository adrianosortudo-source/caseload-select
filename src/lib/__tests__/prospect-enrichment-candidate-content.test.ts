import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { candidateHistory, candidateSummaries } from "../../../tests/prospect-enrichment/candidate-fixtures";
import { candidateFieldReference, loadCandidateRevision, parseCandidateRevisionChunk } from "../prospect-enrichment-candidate-content";
const item = candidateHistory(candidateSummaries[0].id).items[0];
function transport(value: unknown) {
  const content = JSON.stringify(value), chars = Array.from(content), contentSha256 = createHash("sha256").update(content).digest("hex");
  return vi.fn(async (url: Parameters<typeof fetch>[0]) => {
    const offset = Number(new URL(String(url), "https://local.test").searchParams.get("offset")), chunk = chars.slice(offset, offset + 65536).join("");
    const body = { candidateId: item.candidateId, revisionId: item.id, coverageRevision: 42, offset, nextOffset: offset + 65536 < chars.length ? offset + 65536 : null, chunk, totalCharacters: chars.length, contentSha256 };
    return Response.json(body, { headers: { "x-test-response-bytes": String(new TextEncoder().encode(JSON.stringify(body)).length) } });
  });
}
describe("bounded immutable revision content", () => {
  it("uses a short immutable field reference for unbounded original pointers", async () => {
    const pointer = "/" + "long-🧭-key".repeat(1000), query = await candidateFieldReference(item.id, pointer);
    expect(query.get("cr_fieldRefRevision")).toBe(item.id); expect(query.get("cr_fieldRefPointerSha256")).toBe(createHash("sha256").update(pointer).digest("hex")); expect(query.toString().length).toBeLessThan(200);
  });
  it("reassembles and verifies multi-megabyte Unicode evidence using small authenticated chunks", async () => {
    const large = { ...item, originalJson: { longEvidence: "Evidence 🧭 ".repeat(160_000), preservedNull: null } }, request = transport(large);
    expect(await loadCandidateRevision(item.candidateId, item.id, 42, request as typeof fetch)).toEqual(large);
    expect(request.mock.calls.length).toBeGreaterThan(20);
    for (const result of request.mock.results) expect(Number((await result.value).headers.get("x-test-response-bytes"))).toBeLessThan(1_000_000);
  });
  it("rejects modified content even with otherwise consistent chunk metadata", async () => {
    const source = transport(item), request = vi.fn(async (url: Parameters<typeof fetch>[0]) => { const body = await (await source(url)).json(); return Response.json({ ...body, chunk: body.chunk.replace("needs_evidence", "needs_evidencf") }); });
    await expect(loadCandidateRevision(item.candidateId, item.id, 42, request as typeof fetch)).rejects.toThrow("checksum");
  });
  it("rejects cross-candidate, cross-snapshot and invalid chunk offsets", async () => {
    const source = transport(item), request = vi.fn(async (url: Parameters<typeof fetch>[0]) => { const body = await (await source(url)).json(); return Response.json({ ...body, coverageRevision: 43 }); });
    await expect(loadCandidateRevision(item.candidateId, item.id, 42, request as typeof fetch)).rejects.toThrow("unrelated");
    const body = await (await source("?offset=0")).json(); expect(() => parseCandidateRevisionChunk({ ...body, nextOffset: 1 })).toThrow();
  });
  it("never returns partial evidence when a chunk fails", async () => {
    const request = vi.fn(async () => Response.json({ error: "failed" }, { status: 503 }));
    await expect(loadCandidateRevision(item.candidateId, item.id, 42, request as typeof fetch)).rejects.toThrow("completely");
  });
});
