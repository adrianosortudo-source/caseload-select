import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ extract: vi.fn(), map: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), ipFromRequest: () => "test", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/screen-llm-server", () => ({ llmExtractServer: mocks.extract }));
vi.mock("@/lib/llm-option-map", () => ({ llmMapOptionReply: mocks.map }));
import { POST } from "../route";
import { llmExtract } from "@/lib/screen-engine/llm/extractor";
import { initialiseState } from "@/lib/screen-engine/extractor";
const request = (body: object) => new Request("https://example.com/api/extract", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.extract.mockResolvedValue({ mode: "live", extracted: { family_timing: "December 12, 2026" } }); mocks.map.mockResolvedValue({ mode: "live", value: "Within the next 30 days" }); });
describe("focused follow-up mapping", () => {
  it("maps a valid readiness reply while retaining separately extracted facts", async () => {
    const res = await POST(request({ description: "Family issue", matter_type: "family_general", pending_slot_id: "hiring_timeline", reply: "I need a lawyer next week" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "live", mapping_mode: "live", mapped_answer: { slotId: "hiring_timeline", value: "Within the next 30 days" }, extracted: { family_timing: "December 12, 2026" } });
    expect(mocks.map).toHaveBeenCalledOnce();
  });
  it("rejects contact, wrong-matter, and oversized replies without calling providers", async () => {
    for (const [slot, reply] of [["contact_name", "Alex"], ["family_children", "Yes"], ["hiring_timeline", "x".repeat(4001)]]) {
      const res = await POST(request({ description: "Invoice issue", matter_type: "unpaid_invoice", pending_slot_id: slot, reply }));
      expect(res.status).toBe(400);
    }
    expect(mocks.map).not.toHaveBeenCalled(); expect(mocks.extract).not.toHaveBeenCalled();
  });
  it("does not expose a value outside the option set and reports mapper status separately", async () => {
    mocks.extract.mockResolvedValue({ mode: "error", extracted: {} }); mocks.map.mockResolvedValue({ mode: "live", value: "invented" });
    const data = await (await POST(request({ description: "Family issue", matter_type: "family_general", pending_slot_id: "hiring_timeline", reply: "next week" }))).json();
    expect(data).toMatchObject({ mode: "error", mapping_mode: "live" }); expect(data.mapped_answer).toBeUndefined();
  });
  it("does not map absence of a court order to absence of both order and agreement", async () => {
    mocks.map.mockResolvedValue({ mode: "live", value: "Neither" });
    const body = { description: "Family parenting issue", matter_type: "family_general", pending_slot_id: "family_existing_order" };
    const partial = await (await POST(request({ ...body, reply: "There is no court order that I know of." }))).json();
    expect(partial.mapped_answer).toBeUndefined();
    for (const reply of ["Neither", "There is no agreement or court order.", "There is no court order or written parenting agreement.", "There is no parenting order or separation agreement."]) {
      const data = await (await POST(request({ ...body, reply }))).json();
      expect(data.mapped_answer).toEqual({ slotId: "family_existing_order", value: "Neither" });
    }
  });
  it("passes the focused context and result through the client wrapper", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: "live", extracted: {}, mapping_mode: "live", mapped_answer: { slotId: "hiring_timeline", value: "Within the next 30 days" } }) });
    vi.stubGlobal("fetch", fetchMock);
    try { const result = await llmExtract("Family issue", initialiseState("Family issue"), { pendingSlotId: "hiring_timeline", reply: "next week" });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ pending_slot_id: "hiring_timeline", reply: "next week" }); expect(result.mapped_answer?.slotId).toBe("hiring_timeline");
    } finally { vi.unstubAllGlobals(); }
  });
});
