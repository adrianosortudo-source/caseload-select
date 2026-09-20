import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  renderToBuffer: vi.fn(),
  send: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  ipFromRequest: vi.fn(() => "203.0.113.9"),
  rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: mocks.renderToBuffer }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));
vi.mock("@/lib/why-your-firm/brief-pdf", () => ({ BriefPdf: vi.fn() }));

import { POST } from "../route";

describe("POST /api/tools/why-your-firm/report", () => {
  it("fails closed before parsing or delivery while no_gate is active", async () => {
    const request = {
      json: vi.fn(() => {
        throw new Error("the disabled route must not parse visitor data");
      }),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Report delivery is not available.",
    });
    expect(request.json).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.renderToBuffer).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
