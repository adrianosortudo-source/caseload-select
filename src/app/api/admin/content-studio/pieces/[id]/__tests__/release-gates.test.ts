/**
 * Route tests for the Content Studio release gates (Codex audit remediation,
 * 2026-07-07). The pure decision logic is covered by content-studio-review.test
 * and content-validators.test; these assert the ROUTES enforce it:
 *   - PATCH cannot set status:"published" (F2)
 *   - export / publish-record block a stale approval (F1/F3)
 *   - send-to-review requires a zero-fail PT validation when PT exists (F3/F5)
 *   - draft review_response requires an explicit rating/sentiment (F6)
 *   - draft Markdown rejects a max_tokens-truncated response without saving (F10)
 *
 * @/lib/content-studio (server-only I/O) and @/lib/deliverables are mocked; the
 * pure gate/render/prompt helpers run for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  const state = {
    piece: null as Record<string, unknown> | null,
    enVersion: null as Record<string, unknown> | null,
    ptVersion: null as Record<string, unknown> | null,
    publishGate: { deliverableStatus: "approved" as string | null, delegation: null as unknown },
    identity: { ok: true } as { ok: true } | { ok: false; reason: string; code: string },
    strategy: {
      id: "s1",
      firm_id: "firm-1",
      name: "S",
      version: 1,
      status: "active",
      default_locale: "en",
      bilingual_enabled: false,
      jurisdiction: "Ontario",
      strategy_json: {},
      format_specs: {},
      voice_rules: {},
    } as Record<string, unknown>,
    // validate_deterministic validator rows keyed by piece_version_id.
    validationByVersion: new Map<string, { status: string }[]>(),
  };

  const fns = {
    getPiece: vi.fn(() => Promise.resolve({ data: state.piece, error: null })),
    updatePiece: vi.fn((_id: string, updates: Record<string, unknown>) =>
      Promise.resolve({ data: { ...(state.piece ?? {}), ...updates }, error: null }),
    ),
    getCurrentVersion: vi.fn((_id: string, lang = "en") =>
      Promise.resolve(lang === "pt" ? state.ptVersion : state.enVersion),
    ),
    resolvePublishGateStatus: vi.fn(() => Promise.resolve(state.publishGate)),
    checkApprovalIdentity: vi.fn(() => Promise.resolve(state.identity)),
    getActiveStrategy: vi.fn(() => Promise.resolve(state.strategy)),
    getNextVersionNumber: vi.fn(() => Promise.resolve(2)),
    createPieceVersion: vi.fn(() =>
      Promise.resolve({ data: { id: "v-new", version_number: 2 }, error: null }),
    ),
    recordAiRun: vi.fn(() => Promise.resolve({ data: { id: "run-1", model: "m", usage: {} }, error: null })),
    runAndRecordValidation: vi.fn(() =>
      Promise.resolve({ ok: true, outcome: { results: [], summary: { total: 0, pass: 0, fail: 0, warn: 0, verdict: "pass" } } }),
    ),
  };

  const deliverableFns = {
    createDeliverable: vi.fn(() => Promise.resolve({ ok: true, deliverable: { id: "deliv-1" } })),
    addVersion: vi.fn(() => Promise.resolve({ ok: true, version: { id: "dv-1", version_number: 1 } })),
  };

  // Minimal supabaseAdmin: only content_ai_runs (validation lookup) and
  // content_piece_versions / storage are ever touched by the paths under test,
  // and the paths under test block before reaching the writes.
  function contentAiRunsBuilder() {
    let versionId = "";
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: (k: string, v: string) => {
        if (k === "piece_version_id") versionId = v;
        return b;
      },
      order: () => b,
      limit: () => b,
      maybeSingle: () =>
        Promise.resolve({
          data: state.validationByVersion.has(versionId)
            ? { result: { validators: state.validationByVersion.get(versionId) } }
            : null,
        }),
    });
    return b;
  }
  const supabaseAdmin = {
    from: (table: string) => {
      if (table === "content_ai_runs") return contentAiRunsBuilder();
      throw new Error(`unexpected table in test: ${table}`);
    },
  };

  return { state, fns, deliverableFns, supabaseAdmin };
});

vi.mock("@/lib/admin-auth", () => ({
  requireOperator: () => Promise.resolve(null),
}));
vi.mock("@/lib/content-studio", () => h.fns);
vi.mock("@/lib/deliverables", () => h.deliverableFns);
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: h.supabaseAdmin }));

import { PATCH } from "../route";
import { POST as exportPOST } from "../export/route";
import { POST as publishRecordPOST } from "../publish-record/route";
import { POST as sendToReviewPOST } from "../send-to-review/route";
import { POST as draftPOST } from "../draft/route";

const ID = "11111111-1111-1111-1111-111111111111";
const BASE = `https://app.caseloadselect.ca/api/admin/content-studio/pieces/${ID}`;

function req(method: string, path = "", body?: unknown): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}
function params() {
  return { params: Promise.resolve({ id: ID }) };
}

beforeEach(() => {
  h.state.piece = {
    id: ID,
    firm_id: "firm-1",
    format: "counsel_note",
    language_mode: "en",
    workflow_gate: "draft",
    deliverable_id: "deliv-1",
    title_working: "A piece",
    source_brief: { primary_query: "x" },
  };
  h.state.enVersion = { id: "en-1", body_markdown: "# Body", body_structured: null, seo_metadata: {} };
  h.state.ptVersion = null;
  h.state.publishGate = { deliverableStatus: "approved", delegation: null };
  h.state.identity = { ok: true };
  h.state.validationByVersion = new Map();
  for (const f of Object.values(h.fns)) (f as ReturnType<typeof vi.fn>).mockClear();
  for (const f of Object.values(h.deliverableFns)) (f as ReturnType<typeof vi.fn>).mockClear();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("PATCH cannot set status (F2)", () => {
  it("rejects a status-only PATCH with 400 (status is not an allowed field)", async () => {
    const res = await PATCH(req("PATCH", "", { status: "published" }), params());
    expect(res.status).toBe(400);
    expect(h.fns.updatePiece).not.toHaveBeenCalled();
  });

  it("ignores status when other fields are present; updatePiece never receives status", async () => {
    const res = await PATCH(req("PATCH", "", { status: "published", title_working: "New title" }), params());
    expect(res.status).toBe(200);
    expect(h.fns.updatePiece).toHaveBeenCalledTimes(1);
    const updates = h.fns.updatePiece.mock.calls[0][1] as Record<string, unknown>;
    expect(updates).toHaveProperty("title_working", "New title");
    expect(updates).not.toHaveProperty("status");
  });
});

describe("export blocks a stale approval (F1/F3)", () => {
  it("returns 422 approval_stale when the current content drifted from the approved version", async () => {
    h.state.identity = { ok: false, reason: "drifted", code: "approval_stale" };
    const res = await exportPOST(req("POST", "", {}), params());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("approval_stale");
    expect(h.fns.checkApprovalIdentity).toHaveBeenCalledTimes(1);
  });
});

describe("publish-record blocks a stale approval (F1/F3)", () => {
  it("returns 422 when identity fails, and never writes the publish record", async () => {
    h.state.identity = { ok: false, reason: "drifted", code: "approval_stale" };
    const res = await publishRecordPOST(
      req("POST", "", { published_url: "https://drglaw.ca/x" }),
      params(),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("approval_stale");
    expect(h.fns.updatePiece).not.toHaveBeenCalled();
  });
});

describe("send-to-review requires PT validation when a PT version exists (F3/F5)", () => {
  it("returns 422 when the current PT version has a failing validation run", async () => {
    h.state.piece = { ...(h.state.piece as Record<string, unknown>), language_mode: "bilingual" };
    h.state.ptVersion = { id: "pt-1", body_markdown: "# PT", body_structured: null, seo_metadata: {} };
    h.state.validationByVersion.set("en-1", [{ status: "pass" }]);
    h.state.validationByVersion.set("pt-1", [{ status: "fail" }]);

    const res = await sendToReviewPOST(req("POST"), params());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("send_to_review_pt_blocked");
    expect(h.deliverableFns.addVersion).not.toHaveBeenCalled();
  });

  it("posts to review when EN and PT both have zero-fail runs", async () => {
    h.state.piece = { ...(h.state.piece as Record<string, unknown>), language_mode: "bilingual" };
    h.state.ptVersion = { id: "pt-1", body_markdown: "# PT", body_structured: null, seo_metadata: {} };
    h.state.validationByVersion.set("en-1", [{ status: "pass" }]);
    h.state.validationByVersion.set("pt-1", [{ status: "pass" }, { status: "warn" }]);

    const res = await sendToReviewPOST(req("POST"), params());
    expect(res.status).toBe(200);
    expect(h.deliverableFns.addVersion).toHaveBeenCalledTimes(1);
  });
});

describe("draft review_response requires an explicit rating/sentiment (F6)", () => {
  it("returns 422 review_sentiment_required when review_text is present but rating/sentiment is not", async () => {
    h.state.piece = {
      ...(h.state.piece as Record<string, unknown>),
      format: "review_response",
      source_brief: { review_context: { review_text: "The firm ignored me for weeks." } },
    };
    const res = await draftPOST(req("POST", "", {}), params());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("review_sentiment_required");
    expect(h.fns.createPieceVersion).not.toHaveBeenCalled();
  });

  it("does NOT block when an explicit rating is supplied (proceeds past the sentiment gate)", async () => {
    h.state.piece = {
      ...(h.state.piece as Record<string, unknown>),
      format: "review_response",
      source_brief: { review_context: { review_text: "Bad.", rating: 2 } },
    };
    // Stub the model call so the route can proceed; we only assert it does NOT
    // 422 on the sentiment gate.
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          id: "m",
          content: [{ type: "text", text: "A compliant response mentioning DRG Law and Ontario." }],
          model: "m",
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await draftPOST(req("POST", "", {}), params());
    expect(res.status).not.toBe(422);
    vi.unstubAllGlobals();
  });
});

describe("draft Markdown rejects a truncated (max_tokens) response (F10)", () => {
  it("returns 502 generation_truncated and never saves a version", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          id: "m",
          content: [{ type: "text", text: "partial output that got cut off" }],
          model: "m",
          stop_reason: "max_tokens",
          usage: { input_tokens: 1, output_tokens: 4096 },
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await draftPOST(req("POST", "", {}), params());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("generation_truncated");
    expect(h.fns.createPieceVersion).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
