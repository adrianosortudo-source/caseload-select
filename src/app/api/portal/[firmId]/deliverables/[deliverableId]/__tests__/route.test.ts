/**
 * Integration tests for the deliverable detail route
 * (GET + PATCH /api/portal/[firmId]/deliverables/[deliverableId]).
 *
 * GET returns the detail (auth + firm scope). PATCH archives, records manual
 * publication state for operators, and rejects unknown actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const FIRM = "11111111-1111-1111-1111-111111111111";
const DELIV = "22222222-2222-2222-2222-222222222222";

type Actor = { role: string; id: string | null; name: string | null; email: string | null } | null;

const state: {
  actor: Actor;
  detail: unknown;
  detailReadError: boolean;
  archived: boolean;
  publishedAt: string | null;
} = {
  actor: null,
  detail: null,
  detailReadError: false,
  archived: false,
  publishedAt: null,
};

vi.mock("@/lib/deliverables-auth", () => ({
  resolveDeliverableActor: () =>
    Promise.resolve(state.actor ? { session: {}, actor: state.actor } : null),
}));

vi.mock("@/lib/deliverables", () => ({
  getDeliverableDetail: () =>
    Promise.resolve(
      state.detailReadError
        ? { ok: false, error: "mock read error" }
        : state.detail === null
          ? { ok: true, found: false }
          : { ok: true, found: true, detail: state.detail },
    ),
  archiveDeliverable: () => {
    state.archived = true;
    return Promise.resolve({ ok: true });
  },
  setDeliverablePublishedAt: (input: { publishedAt: string | null }) => {
    state.publishedAt = input.publishedAt;
    return Promise.resolve({ ok: true, publishedAt: input.publishedAt });
  },
  setDeliverablePlacement: () => Promise.resolve({ ok: true }),
}));

import { GET, PATCH } from "../route";

const LAWYER: Actor = { role: "lawyer", id: "law1", name: "Damaris", email: "d@firm.ca" };
const OPERATOR: Actor = { role: "operator", id: "op1", name: "CaseLoad", email: "op@example.ca" };

function makeDetail(firmId = FIRM) {
  return {
    deliverable: { id: DELIV, firm_id: firmId, title: "T", status: "in_review" },
    versions: [],
    comments: [],
    approvals: [],
  };
}

function req(body?: unknown) {
  return {
    json: async () => body,
    headers: { get: () => null },
    url: "https://app.caseloadselect.ca/x",
  } as never;
}

const params = () => ({ params: Promise.resolve({ firmId: FIRM, deliverableId: DELIV }) }) as never;

beforeEach(() => {
  state.actor = LAWYER;
  state.detail = makeDetail();
  state.detailReadError = false;
  state.archived = false;
  state.publishedAt = null;
});

describe("GET deliverable detail", () => {
  it("401 when unauthenticated", async () => {
    state.actor = null;
    const res = await GET(req(), params());
    expect(res.status).toBe(401);
  });

  it("404 when the deliverable is another firm's", async () => {
    state.detail = makeDetail("99999999-9999-9999-9999-999999999999");
    const res = await GET(req(), params());
    expect(res.status).toBe(404);
  });

  it("200 returns the detail payload", async () => {
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deliverable.id).toBe(DELIV);
  });

  it("503 (not 404) when the detail read itself errors", async () => {
    state.detailReadError = true;
    const res = await GET(req(), params());
    expect(res.status).toBe(503);
  });
});

describe("PATCH deliverable detail", () => {
  it("archives on { action: 'archive' }", async () => {
    const res = await PATCH(req({ action: "archive" }), params());
    expect(res.status).toBe(200);
    expect(state.archived).toBe(true);
  });

  it("lets an operator record the actual publication date", async () => {
    state.actor = OPERATOR;
    const res = await PATCH(
      req({ action: "set_publication_record", published: true, published_at: "2026-08-18" }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.publishedAt).toBe("2026-08-18");
    expect(await res.json()).toMatchObject({ ok: true, published_at: "2026-08-18" });
  });

  it("lets an operator clear the manual publication record", async () => {
    state.actor = OPERATOR;
    state.publishedAt = "2026-08-18";
    const res = await PATCH(
      req({ action: "set_publication_record", published: false }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(state.publishedAt).toBeNull();
  });

  it("rejects publication-state changes from a lawyer session", async () => {
    const res = await PATCH(
      req({ action: "set_publication_record", published: true, published_at: "2026-08-18" }),
      params(),
    );
    expect(res.status).toBe(403);
    expect(state.publishedAt).toBeNull();
  });

  it("rejects invalid publication dates", async () => {
    state.actor = OPERATOR;
    const res = await PATCH(
      req({ action: "set_publication_record", published: true, published_at: "2026-02-30" }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(state.publishedAt).toBeNull();
  });

  it("400 on an unknown action", async () => {
    const res = await PATCH(req({ action: "delete-everything" }), params());
    expect(res.status).toBe(400);
    expect(state.archived).toBe(false);
  });

  it("404 when the deliverable is another firm's", async () => {
    state.detail = makeDetail("99999999-9999-9999-9999-999999999999");
    const res = await PATCH(req({ action: "archive" }), params());
    expect(res.status).toBe(404);
  });
});
