/**
 * Tests for the lead-notify I/O wrapper, focused on the DR-046 outcome
 * persistence added by launch audit fix H4 (2026-06-09):
 *
 *   - success stamps notification_sent_at + clears the error
 *   - a Resend failure records the error text, no sent_at
 *   - the RESEND_API_KEY-missing skip records an explicit error instead
 *     of silently no-opping
 *   - a partial fan-out (one delivered, one failed) counts as sent but
 *     keeps the per-recipient failure on the row
 *   - persistence failure never throws into the intake path (best-effort,
 *     console.error with the lead id)
 *   - replay: true prefixes the subject with [REPLAY]
 *
 * We mock supabase-admin and email so the wrapper runs in isolation. The
 * pure builder (lead-notify-pure) runs for real; its own coverage lives in
 * lead-notify-pure.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

interface RecordedUpdate {
  patch: Record<string, unknown>;
  field: string;
  value: unknown;
}

interface MockState {
  firm: { id: string; name: string | null; branding: Record<string, unknown> | null } | null;
  lawyers: Array<{ id: string; email: string }> | null;
  attemptsRow: { notification_attempts: number | null } | null;
  attemptsReadError: { message: string } | null;
  updateError: { message: string } | null;
  updates: RecordedUpdate[];
}

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const LEAD_ID = "L-2026-06-09-NTF";

const state: MockState = {
  firm: null,
  lawyers: null,
  attemptsRow: null,
  attemptsReadError: null,
  updateError: null,
  updates: [],
};

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "intake_firms") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => ({
                returns: () => Promise.resolve({ data: state.firm, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "firm_lawyers") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                returns: () => Promise.resolve({ data: state.lawyers, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "screened_leads") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: state.attemptsRow,
                  error: state.attemptsReadError,
                }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (field: string, value: unknown) => {
              state.updates.push({ patch, field, value });
              return Promise.resolve({ error: state.updateError });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

const sendEmailMock = vi.fn<
  (to: string, subject: string, html: string) => Promise<{ skipped: boolean; id?: string }>
>();

vi.mock("@/lib/email", () => ({
  sendEmail: (to: string, subject: string, html: string) => sendEmailMock(to, subject, html),
}));

import { notifyLawyersOfNewLead, type NotifyArgs } from "@/lib/lead-notify";

function makeArgs(overrides: Partial<NotifyArgs> = {}): NotifyArgs {
  return {
    firmId: FIRM_ID,
    leadId: LEAD_ID,
    contactName: "Sarah Example",
    matterType: "wrongful_dismissal",
    practiceArea: "employment",
    band: "B",
    decisionDeadlineIso: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    whaleNurture: false,
    ...overrides,
  };
}

function firmFixture() {
  return { id: FIRM_ID, name: "Example Law", branding: { firm_name: "Example Law LLP" } };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.firm = firmFixture();
  state.lawyers = [{ id: "lawyer-1", email: "lawyer@example.com" }];
  state.attemptsRow = { notification_attempts: 0 };
  state.attemptsReadError = null;
  state.updateError = null;
  state.updates = [];
  sendEmailMock.mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("notifyLawyersOfNewLead outcome persistence (DR-046)", () => {
  it("success: stamps notification_sent_at, clears error, increments attempts", async () => {
    sendEmailMock.mockResolvedValue({ skipped: false, id: "msg-1" });
    state.attemptsRow = { notification_attempts: 2 };

    const result = await notifyLawyersOfNewLead(makeArgs());

    expect(result.sent).toBe(1);
    expect(result.errors).toEqual([]);
    expect(state.updates).toHaveLength(1);
    const { patch, field, value } = state.updates[0];
    expect(field).toBe("lead_id");
    expect(value).toBe(LEAD_ID);
    expect(patch.notification_sent_at).toBeTruthy();
    expect(patch.notification_error).toBeNull();
    expect(patch.notification_attempts).toBe(3);
    expect(patch.notification_last_attempt_at).toBeTruthy();
  });

  it("failure: records the error text, no sent_at, increments attempts", async () => {
    sendEmailMock.mockRejectedValue(new Error("smtp boom"));

    const result = await notifyLawyersOfNewLead(makeArgs());

    expect(result.sent).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(state.updates).toHaveLength(1);
    const { patch } = state.updates[0];
    expect(patch.notification_sent_at).toBeUndefined();
    expect(patch.notification_error).toContain("smtp boom");
    expect(patch.notification_error).toContain("lawyer@example.com");
    expect(patch.notification_attempts).toBe(1);
    expect(patch.notification_last_attempt_at).toBeTruthy();
  });

  it("missing RESEND_API_KEY: records the explicit config error instead of silently no-opping", async () => {
    sendEmailMock.mockResolvedValue({ skipped: true });

    const result = await notifyLawyersOfNewLead(makeArgs());

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toContain("RESEND_API_KEY not configured");
    expect(state.updates).toHaveLength(1);
    const { patch } = state.updates[0];
    expect(patch.notification_sent_at).toBeUndefined();
    expect(patch.notification_error).toBe("RESEND_API_KEY not configured");
  });

  it("missing key with multiple recipients records the config error once", async () => {
    sendEmailMock.mockResolvedValue({ skipped: true });
    state.lawyers = [
      { id: "lawyer-1", email: "a@example.com" },
      { id: "lawyer-2", email: "b@example.com" },
    ];

    const result = await notifyLawyersOfNewLead(makeArgs());

    expect(result.skipped).toBe(2);
    expect(result.errors).toEqual(["RESEND_API_KEY not configured"]);
  });

  it("partial fan-out: any delivered recipient counts as sent, failures stay on the row", async () => {
    state.lawyers = [
      { id: "lawyer-1", email: "ok@example.com" },
      { id: "lawyer-2", email: "down@example.com" },
    ];
    sendEmailMock.mockImplementation((to: string) =>
      to === "ok@example.com"
        ? Promise.resolve({ skipped: false, id: "msg-1" })
        : Promise.reject(new Error("mailbox full")),
    );

    const result = await notifyLawyersOfNewLead(makeArgs());

    expect(result.sent).toBe(1);
    expect(result.errors).toHaveLength(1);
    const { patch } = state.updates[0];
    expect(patch.notification_sent_at).toBeTruthy();
    expect(patch.notification_error).toContain("down@example.com");
    expect(patch.notification_error).toContain("mailbox full");
  });

  it("firm not found: persists the failure keyed by the lead id", async () => {
    state.firm = null;

    const result = await notifyLawyersOfNewLead(makeArgs());

    expect(result.errors).toEqual([`firm ${FIRM_ID} not found`]);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(1);
    const { patch, value } = state.updates[0];
    expect(value).toBe(LEAD_ID);
    expect(patch.notification_sent_at).toBeUndefined();
    expect(patch.notification_error).toContain("not found");
  });

  it("no recipients configured: persists an explicit error so the chip reads Failed", async () => {
    state.lawyers = [];
    state.firm = { id: FIRM_ID, name: "Example Law", branding: {} };

    const result = await notifyLawyersOfNewLead(makeArgs());

    expect(result.skipped).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(1);
    const { patch } = state.updates[0];
    expect(patch.notification_error).toContain("no notification recipients configured");
  });

  it("persistence failure does not throw; console.errors with the lead id", async () => {
    sendEmailMock.mockResolvedValue({ skipped: false, id: "msg-1" });
    state.updateError = { message: "db down" };

    const result = await notifyLawyersOfNewLead(makeArgs());

    expect(result.sent).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    const logged = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain(LEAD_ID);
    expect(logged).toContain("db down");
  });

  it("attempts-read failure also stays best-effort (no throw, logged with lead id)", async () => {
    sendEmailMock.mockResolvedValue({ skipped: false, id: "msg-1" });
    state.attemptsReadError = { message: "read refused" };

    const result = await notifyLawyersOfNewLead(makeArgs());

    expect(result.sent).toBe(1);
    expect(state.updates).toHaveLength(0);
    const logged = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain(LEAD_ID);
    expect(logged).toContain("read refused");
  });

  it("replay: true prefixes the subject with [REPLAY]", async () => {
    sendEmailMock.mockResolvedValue({ skipped: false, id: "msg-1" });

    await notifyLawyersOfNewLead(makeArgs({ replay: true }));

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const subject = sendEmailMock.mock.calls[0][1];
    expect(subject.startsWith("[REPLAY] ")).toBe(true);
  });

  it("default (no replay) leaves the subject unprefixed", async () => {
    sendEmailMock.mockResolvedValue({ skipped: false, id: "msg-1" });

    await notifyLawyersOfNewLead(makeArgs());

    const subject = sendEmailMock.mock.calls[0][1];
    expect(subject.startsWith("[REPLAY]")).toBe(false);
  });
});
