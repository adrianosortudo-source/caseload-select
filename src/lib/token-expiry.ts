/**
 * Per-firm token-expiry monitoring.
 *
 * Each intake_firms row carries up to three secret tokens used to send
 * outbound messages on Meta channels and read voice transcripts from GHL:
 *
 *   • facebook_page_access_token        (Messenger / Instagram Send API)
 *   • whatsapp_cloud_api_access_token   (WhatsApp Cloud API)
 *   • voice_api_token                   (GHL Voice AI Public API)
 *
 * Each can expire silently. When the operator-set `*_token_expires_at`
 * approaches (within EXPIRING_SOON_DAYS), the cron emails a heads-up.
 * When it passes (expired), the cron flags a hard alert.
 *
 * This module is pure logic — no DB or email I/O — so it's trivially
 * unit-testable. The cron route wires it up with Supabase reads and
 * Resend sends.
 */

export interface FirmTokenRow {
  id: string;
  name: string | null;
  facebook_page_token_expires_at: string | null;
  facebook_page_token_alert_sent_at: string | null;
  whatsapp_cloud_token_expires_at: string | null;
  whatsapp_cloud_token_alert_sent_at: string | null;
  voice_api_token_expires_at: string | null;
  voice_api_token_alert_sent_at: string | null;
}

export type TokenKey = "facebook_page" | "whatsapp_cloud" | "voice_api";

export type TokenStatus =
  | "not_tracked"   // expires_at is NULL
  | "valid"         // expires_at > now + EXPIRING_SOON_DAYS
  | "expiring_soon" // 0 < days_until_expiry <= EXPIRING_SOON_DAYS
  | "expired";      // expires_at <= now

export interface TokenStatusEntry {
  key: TokenKey;
  /** Display label, e.g. "Facebook Page token". */
  label: string;
  expiresAt: string | null;
  alertSentAt: string | null;
  status: TokenStatus;
  /**
   * Days from `now` until expiry. Negative when expired. Null when status
   * is `not_tracked` (no expires_at recorded).
   */
  daysUntilExpiry: number | null;
  /**
   * True when the cron should send the operator an alert email for this
   * token right now. Combines status (expiring_soon | expired) with the
   * alert_sent_at de-duplication window.
   */
  shouldAlert: boolean;
}

export interface FirmTokenStatus {
  firmId: string;
  firmName: string | null;
  tokens: TokenStatusEntry[];
}

/** Window before expiry that flips a token to "expiring_soon". */
export const EXPIRING_SOON_DAYS = 14;

/**
 * After we send an alert, suppress repeat alerts for this many days so
 * the operator doesn't get hammered. The next alert fires either after
 * the suppression window OR after the operator rotates the token (which
 * implicitly resets alert_sent_at by updating the row).
 */
export const ALERT_SUPPRESSION_DAYS = 3;

const MS_PER_DAY = 86_400_000;

/**
 * Days until expiry, rounded UP. A token expiring in 6 hours reports
 * "1 day remaining" — operator-friendly. Used for human-readable
 * status strings. Note: this can return 0 only if `future == now`
 * exactly. Codex pushback 2026-05-26: previous code used Math.floor
 * which made any sub-24h remaining read as "0 days" and flipped the
 * status to "expired" even when the token was still valid.
 */
function daysUntilCeil(future: number, now: number): number {
  return Math.ceil((future - now) / MS_PER_DAY);
}

/**
 * Days since a past timestamp, rounded down. Used for the
 * "expired N days ago" phrasing in the alert body.
 */
function daysSinceFloor(past: number, now: number): number {
  return Math.floor((now - past) / MS_PER_DAY);
}

function computeEntry(
  key: TokenKey,
  label: string,
  expiresAtIso: string | null,
  alertSentAtIso: string | null,
  now: Date,
): TokenStatusEntry {
  if (!expiresAtIso) {
    return {
      key,
      label,
      expiresAt: null,
      alertSentAt: alertSentAtIso,
      status: "not_tracked",
      daysUntilExpiry: null,
      shouldAlert: false,
    };
  }

  const expiresAtMs = new Date(expiresAtIso).getTime();
  if (Number.isNaN(expiresAtMs)) {
    // Bad data shouldn't crash the cron — treat as not_tracked.
    return {
      key,
      label,
      expiresAt: expiresAtIso,
      alertSentAt: alertSentAtIso,
      status: "not_tracked",
      daysUntilExpiry: null,
      shouldAlert: false,
    };
  }

  const nowMs = now.getTime();
  const remainingMs = expiresAtMs - nowMs;
  // Codex pushback 2026-05-26: compare timestamps directly, not days,
  // for the expired check. A token expiring in 6 hours is NOT expired
  // even though Math.floor(0.25) = 0.
  const isExpired = remainingMs <= 0;
  // `-0` is a thing in JS, and `0 !== -0` under Object.is (which is
  // what vitest's .toBe() uses). The `|| 0` normalises a freshly-zero
  // result to positive zero.
  const days = isExpired
    ? -daysSinceFloor(expiresAtMs, nowMs) || 0 // negative or zero
    : daysUntilCeil(expiresAtMs, nowMs);        // positive, sub-24h → 1

  const status: TokenStatus = isExpired
    ? "expired"
    : days <= EXPIRING_SOON_DAYS
    ? "expiring_soon"
    : "valid";

  // Alert iff status is actionable AND we haven't recently alerted.
  let shouldAlert = false;
  if (status === "expiring_soon" || status === "expired") {
    if (!alertSentAtIso) {
      shouldAlert = true;
    } else {
      const lastAlertMs = new Date(alertSentAtIso).getTime();
      if (!Number.isNaN(lastAlertMs)) {
        const daysSinceAlert = daysSinceFloor(lastAlertMs, nowMs);
        if (daysSinceAlert >= ALERT_SUPPRESSION_DAYS) shouldAlert = true;
      } else {
        shouldAlert = true;
      }
    }
  }

  return {
    key,
    label,
    expiresAt: expiresAtIso,
    alertSentAt: alertSentAtIso,
    status,
    daysUntilExpiry: days,
    shouldAlert,
  };
}

const TOKEN_LABELS: Record<TokenKey, string> = {
  facebook_page: "Facebook Page token",
  whatsapp_cloud: "WhatsApp Cloud API token",
  voice_api: "GHL Voice AI token",
};

/**
 * Compute the token status for one firm. Pure — takes a firm row, an
 * `at` Date, returns a structured status. The cron consumer filters on
 * `tokens.some(t => t.shouldAlert)` to decide whether to email this firm.
 */
export function computeFirmTokenStatus(firm: FirmTokenRow, now: Date = new Date()): FirmTokenStatus {
  return {
    firmId: firm.id,
    firmName: firm.name,
    tokens: [
      computeEntry(
        "facebook_page",
        TOKEN_LABELS.facebook_page,
        firm.facebook_page_token_expires_at,
        firm.facebook_page_token_alert_sent_at,
        now,
      ),
      computeEntry(
        "whatsapp_cloud",
        TOKEN_LABELS.whatsapp_cloud,
        firm.whatsapp_cloud_token_expires_at,
        firm.whatsapp_cloud_token_alert_sent_at,
        now,
      ),
      computeEntry(
        "voice_api",
        TOKEN_LABELS.voice_api,
        firm.voice_api_token_expires_at,
        firm.voice_api_token_alert_sent_at,
        now,
      ),
    ],
  };
}

/**
 * Build the operator alert email body for a firm. Lists every token that
 * needs attention with status + days_until_expiry. Plain text — the
 * Resend email helper wraps with the standard header.
 */
export function buildTokenAlertBody(status: FirmTokenStatus): string {
  const lines: string[] = [];
  const firmLabel = status.firmName ?? `Firm ${status.firmId}`;
  lines.push(`Token health alert for ${firmLabel}:`);
  lines.push("");

  for (const t of status.tokens) {
    if (!t.shouldAlert) continue;
    let daysPart = "";
    if (t.daysUntilExpiry !== null) {
      if (t.status === "expired") {
        const ago = Math.abs(t.daysUntilExpiry);
        // Codex pushback: handle sub-24h expiry. A token that expired
        // 2 hours ago should not read "expired 0 days ago" — say
        // "expired today" instead.
        daysPart =
          ago === 0
            ? " (expired today)"
            : ` (expired ${ago} day${ago === 1 ? "" : "s"} ago)`;
      } else {
        daysPart = ` (${t.daysUntilExpiry} day${t.daysUntilExpiry === 1 ? "" : "s"} remaining)`;
      }
    }
    const statusLabel = t.status === "expired" ? "EXPIRED" : "Expiring soon";
    lines.push(`  - ${t.label}: ${statusLabel}${daysPart}`);
    if (t.expiresAt) lines.push(`    expires_at: ${t.expiresAt}`);
  }

  lines.push("");
  lines.push("Rotate the affected token(s) and update the corresponding intake_firms");
  lines.push("column. Setting a new expires_at clears the suppression window so the");
  lines.push("next cron run will not re-alert unless another token is approaching.");
  return lines.join("\n");
}

/** Returns the subset of tokens that should be alerted on. */
export function tokensNeedingAlert(status: FirmTokenStatus): TokenStatusEntry[] {
  return status.tokens.filter((t) => t.shouldAlert);
}

/**
 * Build the `alert_sent_at` column updates the cron should write after a
 * successful email send. Returns a partial intake_firms row keyed by the
 * canonical column names.
 */
export function buildAlertSentAtPatch(
  alerted: TokenStatusEntry[],
  now: Date = new Date(),
): Partial<FirmTokenRow> {
  const stamp = now.toISOString();
  const patch: Partial<FirmTokenRow> = {};
  for (const t of alerted) {
    if (t.key === "facebook_page") patch.facebook_page_token_alert_sent_at = stamp;
    if (t.key === "whatsapp_cloud") patch.whatsapp_cloud_token_alert_sent_at = stamp;
    if (t.key === "voice_api") patch.voice_api_token_alert_sent_at = stamp;
  }
  return patch;
}
