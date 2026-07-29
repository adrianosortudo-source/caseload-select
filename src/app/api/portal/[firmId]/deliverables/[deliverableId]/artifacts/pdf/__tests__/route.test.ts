import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  actor: null as { role: string; id: string | null } | null,
  detail: null as Record<string, unknown> | null,
  existing: null as { id: string } | null,
  insertError: null as { code?: string; message: string } | null,
  insertedRow: null as Record<string, unknown> | null,
  removedPaths: [] as string[],
}));

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () => Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/preview-guard", () => ({
  denyWriteIfPreview: () => Promise.resolve(null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () => Promise.resolve(state.detail),
  uploadDeliverableAsset: () => Promise.resolve({ ok: true, storagePath: "deliverables/pdf/test.pdf" }),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => {
      let mode: "read" | "insert" = "read";
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        maybeSingle: async () => ({ data: state.existing, error: null }),
        insert: (row: Record<string, unknown>) => {
          mode = "insert";
          state.insertedRow = row;
          return builder;
        },
        single: async () => ({ data: { id: "artifact-new" }, error: mode === "insert" ? state.insertError : null }),
      };
      return builder;
    },
    storage: { from: () => ({ remove: async (paths: string[]) => { state.removedPaths.push(...paths); } }) },
  },
}));

import { POST } from "../route";

const FIRM = "11111111-1111-1111-1111-111111111111";
const DELIV = "22222222-2222-2222-2222-222222222222";
const VERSION = "33333333-3333-3333-3333-333333333333";

function makeDetail(over: Record<string, unknown> = {}) {
  return {
    deliverable: {
      id: DELIV,
      firm_id: FIRM,
      title: "Business-sale checklist",
      deliverable_role: "lead_magnet_pdf",
      content_kind: "text",
      current_version_id: VERSION,
      locale: "en-CA",
      publication_destination: "firm_website",
      ...over,
    },
    versions: [{ id: VERSION }],
    comments: [],
    approvals: [],
  };
}

function request(file?: File) {
  const form = new FormData();
  if (file) form.append("file", file);
  return {
    formData: async () => form,
  } as never;
}

const params = () => ({ params: Promise.resolve({ firmId: FIRM, deliverableId: DELIV }) }) as never;

beforeEach(() => {
  state.actor = { role: "operator", id: null };
  state.detail = makeDetail();
  state.existing = null;
  state.insertError = null;
  state.insertedRow = null;
  state.removedPaths = [];
});

describe("POST checklist PDF artifact", () => {
  it("requires authentication and operator access", async () => {
    state.actor = null;
    expect((await POST(request(), params())).status).toBe(401);
    state.actor = { role: "lawyer", id: null };
    expect((await POST(request(), params())).status).toBe(403);
  });

  it("rejects the wrong MIME type and fake PDF bytes", async () => {
    const wrongMime = new File(["not pdf"], "checklist.pdf", { type: "text/plain" });
    expect((await POST(request(wrongMime), params())).status).toBe(415);
    const fakePdf = new File(["not pdf"], "checklist.pdf", { type: "application/pdf" });
    expect((await POST(request(fakePdf), params())).status).toBe(415);
  });

  it("does not upload when the current version already has a PDF", async () => {
    state.existing = { id: "artifact-existing" };
    const file = new File(["%PDF-1.7"], "checklist.pdf", { type: "application/pdf" });
    expect((await POST(request(file), params())).status).toBe(409);
  });

  it("registers a valid PDF against the exact current version", async () => {
    const file = new File(["%PDF-1.7 approved bytes"], "checklist-en.pdf", { type: "application/pdf" });
    const response = await POST(request(file), params());
    expect(response.status).toBe(200);
    expect(state.insertedRow).toMatchObject({
      firm_id: FIRM,
      deliverable_id: DELIV,
      version_id: VERSION,
      artifact_type: "pdf",
      locale: "en-CA",
      destination: "firm_website",
      storage_bucket: "firm-files",
      storage_path: "deliverables/pdf/test.pdf",
      mime_type: "application/pdf",
      size_bytes: file.size,
      created_by_role: "operator",
    });
    expect(state.insertedRow?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(state.removedPaths).toEqual([]);
  });

  it("removes only the new object if registration fails", async () => {
    state.insertError = { code: "XX000", message: "insert failed" };
    const file = new File(["%PDF-1.7 approved bytes"], "checklist-en.pdf", { type: "application/pdf" });
    expect((await POST(request(file), params())).status).toBe(500);
    expect(state.removedPaths).toEqual(["deliverables/pdf/test.pdf"]);
  });
});
