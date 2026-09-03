import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  host: "admin.caseloadselect.ca",
  cookie: undefined as string | undefined,
  row: { id: "operator-1" } as { id: string } | null,
  error: null as { message: string } | null,
  throwOnRead: false,
  tables: [] as string[],
  filters: [] as Array<[string, unknown]>,
  updates: [] as Array<Record<string, unknown>>,
}));

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((pathname: string) => {
    throw new Error(`redirect:${pathname}`);
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => name.toLowerCase() === "host" ? state.host : null,
  }),
  cookies: async () => ({
    get: (name: string) => name === "portal_session" && state.cookie
      ? { value: state.cookie }
      : undefined,
  }),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      state.tables.push(table);
      const builder = {
        select: () => builder,
        update: (value: Record<string, unknown>) => {
          state.updates.push(value);
          return builder;
        },
        eq: (column: string, value: unknown) => {
          state.filters.push([column, value]);
          return builder;
        },
        maybeSingle: () => {
          if (state.throwOnRead) throw new Error("query threw");
          return Promise.resolve({ data: state.row, error: state.error });
        },
      };
      return builder;
    },
  },
}));

vi.mock("next/navigation", () => ({ redirect: navigation.redirect }));

import {
  createSessionCookie,
  getPortalSession,
  getOperatorSession,
  requirePortalViewer,
  revalidateOperatorMembership,
  type PortalSession,
} from "../portal-auth";

function operatorSession(overrides: Partial<PortalSession> = {}): PortalSession {
  return {
    firm_id: "firm-1",
    role: "operator",
    lawyer_id: "operator-1",
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

function setOperatorCookie(overrides: Partial<PortalSession> = {}) {
  const session = operatorSession(overrides);
  state.cookie = createSessionCookie(session.firm_id, {
    role: session.role,
    lawyer_id: session.lawyer_id,
  }).value;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PORTAL_SECRET", "test-portal-secret");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
  state.host = "admin.caseloadselect.ca";
  state.cookie = undefined;
  state.row = { id: "operator-1" };
  state.error = null;
  state.throwOnRead = false;
  state.tables = [];
  state.filters = [];
  state.updates = [];
});

afterEach(() => vi.unstubAllEnvs());

describe("live operator session authorization", () => {
  it("accepts an admin-host cookie only after exact active membership validation", async () => {
    setOperatorCookie();

    const session = await getOperatorSession();

    expect(session).toMatchObject({
      firm_id: "firm-1",
      role: "operator",
      lawyer_id: "operator-1",
    });
    expect(state.tables).toEqual(["firm_lawyers"]);
    expect(state.filters).toEqual([
      ["id", "operator-1"],
      ["firm_id", "firm-1"],
      ["role", "operator"],
      ["disabled", false],
    ]);
    expect(state.updates).toEqual([]);
  });

  it.each([
    ["removed", null],
    ["disabled", null],
    ["wrong role", null],
    ["wrong firm", null],
  ])("rejects a signed cookie when membership is %s", async (_label, row) => {
    setOperatorCookie();
    state.row = row;
    expect(await getOperatorSession()).toBeNull();
  });

  it("rejects legacy operator cookies without a member id before querying", async () => {
    setOperatorCookie({ lawyer_id: undefined });
    expect(await getOperatorSession()).toBeNull();
    expect(state.tables).toEqual([]);
  });

  it("fails closed when live membership lookup errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    setOperatorCookie();
    state.row = null;
    state.error = { message: "database unavailable" };

    expect(await getOperatorSession()).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("operator membership revalidation failed"),
    );
    consoleError.mockRestore();
  });

  it("fails closed when the membership client throws unexpectedly", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    setOperatorCookie();
    state.throwOnRead = true;

    expect(await getOperatorSession()).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("operator membership revalidation failed: query threw"),
    );
    consoleError.mockRestore();
  });

  it.each([
    "app.caseloadselect.ca",
    "production-alias.vercel.app",
    "admin.caseloadselect.ca.attacker.test",
  ])("rejects an operator cookie on untrusted production host %s", async (host) => {
    state.host = host;
    setOperatorCookie();

    expect(await getOperatorSession()).toBeNull();
    expect(state.tables).toEqual([]);
  });

  it("permits the single-origin exception on a real Vercel preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    state.host = "operator-auth-git-example.vercel.app";
    setOperatorCookie();
    expect(await getOperatorSession()).toMatchObject({ role: "operator" });
  });

  it("uses the same exact membership boundary when consuming a login link", async () => {
    const session = operatorSession();
    const row = await revalidateOperatorMembership(session, { recordSignIn: true });

    expect(row).toEqual({ id: "operator-1" });
    expect(state.filters).toEqual([
      ["id", "operator-1"],
      ["firm_id", "firm-1"],
      ["role", "operator"],
      ["disabled", false],
    ]);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toHaveProperty("last_signed_in_at");
  });

  it.each(["lawyer", "client"] as const)(
    "leaves a signed %s session unchanged on the app host",
    async (role) => {
      state.host = "app.caseloadselect.ca";
      state.cookie = createSessionCookie("firm-1", {
        role,
        matter_id: role === "client" ? "matter-1" : undefined,
      }).value;

      expect(await getPortalSession()).toMatchObject({ role, firm_id: "firm-1" });
      expect(state.tables).toEqual([]);
    },
  );

  it("rejects an app-host legacy operator cookie through requirePortalViewer", async () => {
    state.host = "app.caseloadselect.ca";
    setOperatorCookie();

    await expect(requirePortalViewer("other-firm")).rejects.toThrow(
      "redirect:/portal/login",
    );
    expect(state.tables).toEqual([]);
  });

  it("rejects a disabled operator through requirePortalViewer", async () => {
    setOperatorCookie();
    state.row = null;

    await expect(requirePortalViewer("other-firm")).rejects.toThrow(
      "redirect:/portal/login",
    );
    expect(state.filters).toContainEqual(["disabled", false]);
  });

  it("preserves active cross-firm operator viewing on the admin host", async () => {
    setOperatorCookie();
    const viewer = await requirePortalViewer("other-firm");
    expect(viewer).toMatchObject({ isOperator: true, isLawyer: false, isPreview: false });
  });
});
