/**
 * Corrective-release finding 5: an operator's resolved identity must be
 * their own real display name/email whenever their session carries a
 * firm_lawyers.id, not the literal string "Operator" for every person.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const state = {
  session: null as { role: string; firm_id: string; lawyer_id?: string } | null,
  firmLawyerRow: null as { display_name: string | null; email: string | null } | null,
  brandingRow: null as { branding: { lawyer_email?: string; lawyer_name?: string } | null } | null,
};

vi.mock("@/lib/portal-auth", () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (table === "firm_lawyers") return Promise.resolve({ data: state.firmLawyerRow });
            if (table === "intake_firms") return Promise.resolve({ data: state.brandingRow });
            return Promise.resolve({ data: null });
          },
        }),
      }),
    }),
  },
}));

import { resolveDeliverableActor } from "../deliverables-auth";

const FIRM = "f1111111-1111-1111-1111-111111111111";

beforeEach(() => {
  state.session = null;
  state.firmLawyerRow = null;
  state.brandingRow = null;
});

describe("resolveDeliverableActor: operator identity (corrective-release finding 5)", () => {
  it("resolves the operator's real display_name/email from firm_lawyers when session.lawyer_id is set", async () => {
    state.session = { role: "operator", firm_id: FIRM, lawyer_id: "op-row-1" };
    state.firmLawyerRow = { display_name: "Adriano Domingues", email: "adriano@caseloadselect.ca" };
    const resolved = await resolveDeliverableActor(FIRM);
    expect(resolved?.actor).toEqual({
      role: "operator",
      id: "op-row-1",
      name: "Adriano Domingues",
      email: "adriano@caseloadselect.ca",
    });
  });

  it("falls back to the literal 'Operator' only when no firm_lawyers row can be resolved (legacy token)", async () => {
    state.session = { role: "operator", firm_id: FIRM };
    const resolved = await resolveDeliverableActor(FIRM);
    expect(resolved?.actor.name).toBe("Operator");
    expect(resolved?.actor.id).toBeNull();
  });

  it("falls back to 'Operator' when lawyer_id is set but the row lookup returns nothing", async () => {
    state.session = { role: "operator", firm_id: FIRM, lawyer_id: "stale-row" };
    state.firmLawyerRow = null;
    const resolved = await resolveDeliverableActor(FIRM);
    expect(resolved?.actor.name).toBe("Operator");
    expect(resolved?.actor.email).toBeNull();
  });

  it("never records every operator as the same identity -- two different sessions resolve two different names", async () => {
    state.session = { role: "operator", firm_id: FIRM, lawyer_id: "op-row-1" };
    state.firmLawyerRow = { display_name: "Adriano Domingues", email: "adriano@caseloadselect.ca" };
    const first = await resolveDeliverableActor(FIRM);

    state.session = { role: "operator", firm_id: FIRM, lawyer_id: "op-row-2" };
    state.firmLawyerRow = { display_name: "Someone Else", email: "someone@caseloadselect.ca" };
    const second = await resolveDeliverableActor(FIRM);

    expect(first?.actor.name).toBe("Adriano Domingues");
    expect(second?.actor.name).toBe("Someone Else");
    expect(first?.actor.name).not.toBe(second?.actor.name);
  });
});

describe("resolveDeliverableActor: existing gates (regression)", () => {
  it("rejects a client-role session", async () => {
    state.session = { role: "client", firm_id: FIRM };
    const resolved = await resolveDeliverableActor(FIRM);
    expect(resolved).toBeNull();
  });

  it("returns null when there is no session", async () => {
    state.session = null;
    const resolved = await resolveDeliverableActor(FIRM);
    expect(resolved).toBeNull();
  });

  it("rejects a lawyer session for a different firm", async () => {
    state.session = { role: "lawyer", firm_id: "other-firm" };
    const resolved = await resolveDeliverableActor(FIRM);
    expect(resolved).toBeNull();
  });
});
