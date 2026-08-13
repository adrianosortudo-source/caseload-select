import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  actor: null as { role: string; id: string | null } | null,
  detail: null as Record<string, unknown> | null,
  detailReadError: false,
  existing: null as { id: string } | null,
  rpcError: null as { message: string } | null,
  rpcArgs: null as Record<string, unknown> | null,
  removedPaths: [] as string[],
  candidates: [] as Array<Record<string, unknown>>,
  resolvedCandidate: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () => Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));
vi.mock("@/lib/preview-guard", () => ({ denyWriteIfPreview: () => Promise.resolve(null) }));
vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () =>
    Promise.resolve(
      state.detailReadError
        ? { ok: false, error: "mock read error" }
        : state.detail === null
          ? { ok: true, found: false }
          : { ok: true, found: true, detail: state.detail },
    ),
  uploadDeliverableAsset: () => Promise.resolve({ ok: true, storagePath: "deliverables/pdf/new.pdf" }),
}));
vi.mock("@/lib/checklist-pdf-candidates", () => ({
  listPdfCandidates: () => Promise.resolve(state.candidates),
  resolvePdfCandidate: () => Promise.resolve(state.resolvedCandidate),
  downloadPdf: () => Promise.resolve(Buffer.from("%PDF-1.7 candidate bytes")),
}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        maybeSingle: async () => ({ data: state.existing, error: null }),
      };
      return builder;
    },
    rpc: async (_name: string, args: Record<string, unknown>) => {
      state.rpcArgs = args;
      return { data: "artifact-new", error: state.rpcError };
    },
    storage: { from: () => ({ remove: async (paths: string[]) => { state.removedPaths.push(...paths); } }) },
  },
}));

import { GET, POST } from "../route";

const FIRM = "11111111-1111-1111-1111-111111111111";
const DELIV = "22222222-2222-2222-2222-222222222222";
const VERSION = "33333333-3333-3333-3333-333333333333";
const ARTIFACT = "44444444-4444-4444-4444-444444444444";

function makeDetail() {
  return {
    deliverable: {
      id: DELIV, firm_id: FIRM, title: "Business-sale checklist", deliverable_role: "lead_magnet_pdf", content_kind: "text",
      current_version_id: VERSION, locale: "en-CA", publication_destination: "firm_website",
    },
    versions: [{ id: VERSION }], comments: [], approvals: [],
  };
}
function request(fields: Record<string, string> = {}, file?: File) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  if (file) form.append("file", file);
  return { formData: async () => form } as never;
}
const params = () => ({ params: Promise.resolve({ firmId: FIRM, deliverableId: DELIV }) }) as never;

beforeEach(() => {
  state.actor = { role: "operator", id: null };
  state.detail = makeDetail(); state.detailReadError = false;
  state.existing = null; state.rpcError = null; state.rpcArgs = null;
  state.removedPaths = []; state.candidates = []; state.resolvedCandidate = null;
});

describe("checklist PDF artifact route", () => {
  it("requires authentication and operator access", async () => {
    state.actor = null; expect((await POST(request(), params())).status).toBe(401);
    state.actor = { role: "lawyer", id: null }; expect((await POST(request(), params())).status).toBe(403);
  });

  it("503 (not 404) when the detail read itself errors; the RPC is never called", async () => {
    state.detailReadError = true;
    expect((await GET({} as never, params())).status).toBe(503);
    const file = new File(["%PDF-1.7 approved bytes"], "checklist-en.pdf", { type: "application/pdf" });
    expect((await POST(request({}, file), params())).status).toBe(503);
    expect(state.rpcArgs).toBeNull();
  });

  it("503 when the versions read failed, so the current version cannot be verified; the RPC is never called", async () => {
    state.detail = { ...makeDetail(), versionsError: true };
    const file = new File(["%PDF-1.7 approved bytes"], "checklist-en.pdf", { type: "application/pdf" });
    expect((await POST(request({}, file), params())).status).toBe(503);
    expect(state.rpcArgs).toBeNull();
  });

  it("rejects wrong MIME type and fake PDF bytes", async () => {
    expect((await POST(request({}, new File(["not pdf"], "checklist.pdf", { type: "text/plain" })), params())).status).toBe(415);
    expect((await POST(request({}, new File(["not pdf"], "checklist.pdf", { type: "application/pdf" })), params())).status).toBe(415);
  });

  it("registers a valid initial PDF against the current version through the atomic RPC", async () => {
    const file = new File(["%PDF-1.7 approved bytes"], "checklist-en.pdf", { type: "application/pdf" });
    expect((await POST(request({}, file), params())).status).toBe(200);
    expect(state.rpcArgs).toMatchObject({ p_firm_id: FIRM, p_deliverable_id: DELIV, p_version_id: VERSION, p_prior_artifact_id: null, p_mime_type: "application/pdf", p_actor_role: "operator" });
    expect(state.rpcArgs?.p_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("replaces the active PDF without changing the deliverable version", async () => {
    state.existing = { id: ARTIFACT };
    state.resolvedCandidate = { sourceKind: "approval", sourceId: "approval-1", storagePath: "reviews/correct.pdf" };
    const response = await POST(request({ prior_artifact_id: ARTIFACT, candidate_storage_path: "reviews/correct.pdf", candidate_source_kind: "approval", candidate_source_id: "approval-1", reason: "Wrong document uploaded" }), params());
    expect(response.status).toBe(200);
    expect(state.rpcArgs).toMatchObject({ p_prior_artifact_id: ARTIFACT, p_version_id: VERSION, p_storage_path: "reviews/correct.pdf", p_reason: "Wrong document uploaded" });
    expect(state.removedPaths).toEqual([]);
  });

  it("rejects a stale replacement and does not mutate storage", async () => {
    state.existing = { id: ARTIFACT };
    const response = await POST(request({ prior_artifact_id: "stale-artifact", reason: "Wrong document uploaded" }, new File(["%PDF-1.7"], "new.pdf", { type: "application/pdf" })), params());
    expect(response.status).toBe(409);
    expect(state.removedPaths).toEqual([]);
  });

  it("cleans only a newly uploaded object when atomic registration fails", async () => {
    state.rpcError = { message: "registration failed" };
    const response = await POST(request({}, new File(["%PDF-1.7 approved bytes"], "checklist-en.pdf", { type: "application/pdf" })), params());
    expect(response.status).toBe(500);
    expect(state.removedPaths).toEqual(["deliverables/pdf/new.pdf"]);
  });

  it("returns stored PDF candidates for the operator replacement flow", async () => {
    state.candidates = [{ sourceKind: "approval", sourceId: "approval-1", name: "correct.pdf" }];
    // GET ignores the request entirely (`_req: NextRequest`), so a plain
    // Request is enough at runtime. Cast to match this file's existing
    // convention for the request() and params() helpers.
    const response = await GET(new Request("http://localhost") as never, params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ candidates: state.candidates });
  });
});
