import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const OTHER_FIRM = "11111111-1111-1111-1111-111111111111";

const state = {
  intent: null as { operator_id: string; firm_id: string; target: "lawyer" | "client" } | null,
};

vi.mock("../preview-mode", async () => {
  const actual = await vi.importActual<typeof import("../preview-mode")>("../preview-mode");
  return {
    ...actual,
    getPreviewIntent: () => Promise.resolve(state.intent),
  };
});

import { denyWriteIfPreview } from "../preview-guard";

beforeEach(() => {
  state.intent = null;
});

describe("denyWriteIfPreview: exact contract", () => {
  it("returns null (write proceeds) when there is no active preview", async () => {
    state.intent = null;
    const result = await denyWriteIfPreview(FIRM);
    expect(result).toBeNull();
  });

  it("returns 403 with the exact reason code and message when previewing this firm", async () => {
    state.intent = { operator_id: "op-1", firm_id: FIRM, target: "lawyer" };
    const result = await denyWriteIfPreview(FIRM);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    const body = await result!.json();
    expect(body.code).toBe("support_preview_read_only");
    expect(body.error).toBe(
      "Support preview is read-only. Complete this action from the firm’s own authorized session.",
    );
  });

  it("returns null when the active preview is for a different firm (preview never follows the operator cross-firm on the write path)", async () => {
    state.intent = { operator_id: "op-1", firm_id: OTHER_FIRM, target: "lawyer" };
    const result = await denyWriteIfPreview(FIRM);
    expect(result).toBeNull();
  });

  it("denies writes under a Client viewer preview the same as a Lawyer decision-maker preview", async () => {
    state.intent = { operator_id: "op-1", firm_id: FIRM, target: "client" };
    const result = await denyWriteIfPreview(FIRM);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});
