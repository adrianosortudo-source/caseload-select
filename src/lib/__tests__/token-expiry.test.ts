import { describe, it, expect } from "vitest";
import {
  computeFirmTokenStatus,
  buildTokenAlertBody,
  tokensNeedingAlert,
  buildAlertSentAtPatch,
  EXPIRING_SOON_DAYS,
  ALERT_SUPPRESSION_DAYS,
  type FirmTokenRow,
} from "../token-expiry";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-05-26T12:00:00Z");

function fakeRow(overrides: Partial<FirmTokenRow> = {}): FirmTokenRow {
  return {
    id: "firm-test",
    name: "Test Firm LLP",
    facebook_page_token_expires_at: null,
    facebook_page_token_alert_sent_at: null,
    whatsapp_cloud_token_expires_at: null,
    whatsapp_cloud_token_alert_sent_at: null,
    voice_api_token_expires_at: null,
    voice_api_token_alert_sent_at: null,
    ...overrides,
  };
}

function isoFromNow(days: number): string {
  return new Date(NOW.getTime() + days * DAY_MS).toISOString();
}

// Codex pushback 2026-05-26: lock down the sub-day behaviour.
describe("computeFirmTokenStatus — sub-day boundary (Codex fix)", () => {
  it("token expiring in 6 hours is 'expiring_soon', NOT 'expired'", () => {
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const status = computeFirmTokenStatus(
      fakeRow({
        facebook_page_token_expires_at: new Date(NOW.getTime() + sixHoursMs).toISOString(),
      }),
      NOW,
    );
    const fb = status.tokens.find((t) => t.key === "facebook_page")!;
    expect(fb.status).toBe("expiring_soon");
    // daysUntilExpiry uses Math.ceil — 6 hours rounds up to 1 day for
    // the operator-facing string.
    expect(fb.daysUntilExpiry).toBe(1);
  });

  it("token expiring in 1 minute is still 'expiring_soon'", () => {
    const status = computeFirmTokenStatus(
      fakeRow({
        whatsapp_cloud_token_expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
      }),
      NOW,
    );
    const wa = status.tokens.find((t) => t.key === "whatsapp_cloud")!;
    expect(wa.status).toBe("expiring_soon");
    expect(wa.daysUntilExpiry).toBe(1);
  });

  it("token that expired 2 hours ago reports 'expired today' in the body", () => {
    const twoHoursMs = 2 * 60 * 60 * 1000;
    const status = computeFirmTokenStatus(
      fakeRow({
        name: "DRG Law",
        voice_api_token_expires_at: new Date(NOW.getTime() - twoHoursMs).toISOString(),
      }),
      NOW,
    );
    const v = status.tokens.find((t) => t.key === "voice_api")!;
    expect(v.status).toBe("expired");
    expect(v.daysUntilExpiry).toBe(0);
    const body = buildTokenAlertBody(status);
    expect(body).toContain("expired today");
  });

  it("token expiring exactly at now() is 'expired'", () => {
    const status = computeFirmTokenStatus(
      fakeRow({ facebook_page_token_expires_at: NOW.toISOString() }),
      NOW,
    );
    const fb = status.tokens.find((t) => t.key === "facebook_page")!;
    expect(fb.status).toBe("expired");
  });
});

describe("computeFirmTokenStatus", () => {
  it("returns 'not_tracked' for all three tokens when no expires_at is set", () => {
    const status = computeFirmTokenStatus(fakeRow(), NOW);
    expect(status.tokens.every((t) => t.status === "not_tracked")).toBe(true);
    expect(status.tokens.every((t) => !t.shouldAlert)).toBe(true);
  });

  it("returns 'valid' when expiry is far in the future", () => {
    const status = computeFirmTokenStatus(
      fakeRow({ facebook_page_token_expires_at: isoFromNow(60) }),
      NOW,
    );
    const fb = status.tokens.find((t) => t.key === "facebook_page")!;
    expect(fb.status).toBe("valid");
    expect(fb.shouldAlert).toBe(false);
    expect(fb.daysUntilExpiry).toBeGreaterThan(EXPIRING_SOON_DAYS);
  });

  it("flips to 'expiring_soon' inside the 14-day window", () => {
    const status = computeFirmTokenStatus(
      fakeRow({ whatsapp_cloud_token_expires_at: isoFromNow(10) }),
      NOW,
    );
    const wa = status.tokens.find((t) => t.key === "whatsapp_cloud")!;
    expect(wa.status).toBe("expiring_soon");
    expect(wa.shouldAlert).toBe(true);
    expect(wa.daysUntilExpiry).toBe(10);
  });

  it("at the EXPIRING_SOON_DAYS boundary (exactly 14 days) is still 'expiring_soon'", () => {
    const status = computeFirmTokenStatus(
      fakeRow({ voice_api_token_expires_at: isoFromNow(EXPIRING_SOON_DAYS) }),
      NOW,
    );
    const v = status.tokens.find((t) => t.key === "voice_api")!;
    expect(v.status).toBe("expiring_soon");
  });

  it("flips to 'expired' once the expiry passes", () => {
    const status = computeFirmTokenStatus(
      fakeRow({ facebook_page_token_expires_at: isoFromNow(-3) }),
      NOW,
    );
    const fb = status.tokens.find((t) => t.key === "facebook_page")!;
    expect(fb.status).toBe("expired");
    expect(fb.shouldAlert).toBe(true);
    expect(fb.daysUntilExpiry).toBeLessThanOrEqual(0);
  });

  it("treats malformed expires_at as 'not_tracked' (defensive)", () => {
    const status = computeFirmTokenStatus(
      fakeRow({ facebook_page_token_expires_at: "definitely-not-a-date" }),
      NOW,
    );
    const fb = status.tokens.find((t) => t.key === "facebook_page")!;
    expect(fb.status).toBe("not_tracked");
    expect(fb.shouldAlert).toBe(false);
  });

  it("alert_sent_at within suppression window blocks the alert", () => {
    const status = computeFirmTokenStatus(
      fakeRow({
        whatsapp_cloud_token_expires_at: isoFromNow(5),
        whatsapp_cloud_token_alert_sent_at: isoFromNow(-1), // alerted yesterday
      }),
      NOW,
    );
    const wa = status.tokens.find((t) => t.key === "whatsapp_cloud")!;
    expect(wa.status).toBe("expiring_soon");
    expect(wa.shouldAlert).toBe(false);
  });

  it("alert_sent_at outside suppression window allows the next alert", () => {
    const status = computeFirmTokenStatus(
      fakeRow({
        whatsapp_cloud_token_expires_at: isoFromNow(5),
        whatsapp_cloud_token_alert_sent_at: isoFromNow(-(ALERT_SUPPRESSION_DAYS + 1)),
      }),
      NOW,
    );
    const wa = status.tokens.find((t) => t.key === "whatsapp_cloud")!;
    expect(wa.shouldAlert).toBe(true);
  });

  it("each token is independent — only the expiring one flags shouldAlert", () => {
    const status = computeFirmTokenStatus(
      fakeRow({
        facebook_page_token_expires_at: isoFromNow(120), // valid
        whatsapp_cloud_token_expires_at: isoFromNow(2),  // expiring soon
        voice_api_token_expires_at: isoFromNow(-10),     // expired
      }),
      NOW,
    );
    const flags = Object.fromEntries(status.tokens.map((t) => [t.key, t.shouldAlert]));
    expect(flags.facebook_page).toBe(false);
    expect(flags.whatsapp_cloud).toBe(true);
    expect(flags.voice_api).toBe(true);
  });
});

describe("tokensNeedingAlert", () => {
  it("returns only the shouldAlert subset", () => {
    const status = computeFirmTokenStatus(
      fakeRow({
        facebook_page_token_expires_at: isoFromNow(60),
        whatsapp_cloud_token_expires_at: isoFromNow(3),
        voice_api_token_expires_at: isoFromNow(-5),
      }),
      NOW,
    );
    const alerted = tokensNeedingAlert(status);
    expect(alerted.map((t) => t.key).sort()).toEqual(["voice_api", "whatsapp_cloud"]);
  });

  it("empty when nothing is actionable", () => {
    const status = computeFirmTokenStatus(fakeRow(), NOW);
    expect(tokensNeedingAlert(status)).toEqual([]);
  });
});

describe("buildTokenAlertBody", () => {
  it("includes the firm name and the affected token labels", () => {
    const status = computeFirmTokenStatus(
      fakeRow({
        name: "DRG Law",
        whatsapp_cloud_token_expires_at: isoFromNow(3),
      }),
      NOW,
    );
    const body = buildTokenAlertBody(status);
    expect(body).toContain("DRG Law");
    expect(body).toContain("WhatsApp Cloud API token");
    expect(body).toMatch(/3 days remaining/);
  });

  it("uses 'EXPIRED' label and 'days ago' phrasing for past-due tokens", () => {
    const status = computeFirmTokenStatus(
      fakeRow({
        name: "DRG Law",
        facebook_page_token_expires_at: isoFromNow(-7),
      }),
      NOW,
    );
    const body = buildTokenAlertBody(status);
    expect(body).toContain("EXPIRED");
    expect(body).toMatch(/7 days ago/);
  });

  it("singular phrasing for 1-day cases", () => {
    const fewer = computeFirmTokenStatus(
      fakeRow({ name: "DRG Law", voice_api_token_expires_at: isoFromNow(1) }),
      NOW,
    );
    const body = buildTokenAlertBody(fewer);
    expect(body).toMatch(/1 day remaining/);
    expect(body).not.toMatch(/1 days remaining/);
  });

  it("falls back to 'Firm <uuid>' when name is null", () => {
    const status = computeFirmTokenStatus(
      fakeRow({ id: "abc-123", name: null, voice_api_token_expires_at: isoFromNow(2) }),
      NOW,
    );
    const body = buildTokenAlertBody(status);
    expect(body).toContain("Firm abc-123");
  });
});

describe("buildAlertSentAtPatch", () => {
  it("produces a patch keyed by the alert_sent_at column per token", () => {
    const status = computeFirmTokenStatus(
      fakeRow({
        whatsapp_cloud_token_expires_at: isoFromNow(2),
        voice_api_token_expires_at: isoFromNow(-1),
      }),
      NOW,
    );
    const alerted = tokensNeedingAlert(status);
    const patch = buildAlertSentAtPatch(alerted, NOW);
    expect(patch.whatsapp_cloud_token_alert_sent_at).toBe(NOW.toISOString());
    expect(patch.voice_api_token_alert_sent_at).toBe(NOW.toISOString());
    expect(patch.facebook_page_token_alert_sent_at).toBeUndefined();
  });

  it("returns empty patch when no tokens were alerted", () => {
    const patch = buildAlertSentAtPatch([], NOW);
    expect(patch).toEqual({});
  });
});
