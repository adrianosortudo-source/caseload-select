import { describe, expect, it, vi } from "vitest";
import { listCandidateResearch } from "../prospect-enrichment-candidate-reader";
describe("local research cutover", () => {
  it("returns an explicit relocation without querying the archived database", async () => {
    const client = { rpc: vi.fn() };
    await expect(listCandidateResearch({ filters: {} }, client)).rejects.toMatchObject({ status: 410 });
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
