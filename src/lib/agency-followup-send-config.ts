/**
 * Fail-closed configuration and per-message authorization for Agency follow-up.
 * No credentials are returned from this module; callers may safely expose the
 * mode and readiness booleans to an authenticated operator surface.
 */

export type AgencyFollowupSendMode = "off" | "test" | "live";

export interface AgencyFollowupSendTarget {
  enrollmentId: string;
  messageId: string;
  recipientEmail: string;
}

export interface AgencyFollowupSendConfig {
  mode: AgencyFollowupSendMode;
  configuredFrom: string | null;
  configuredReplyTo: string | null;
  apiKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  unsubscribeSecretConfigured: boolean;
  /** One message maximum is enforced in every enabled mode. */
  maxBatchSize: 1;
  /** Exact message/enrollment/recipient targets that test-mode SQL may touch. */
  testClaimTargets: readonly AgencyFollowupSendTarget[];
  /** Enrollment UUIDs that live-mode SQL may claim messages for. */
  liveClaimEnrollmentIds: readonly string[];
  ready: boolean;
  blockers: readonly string[];
  /** Authorization compares the persisted recipient exactly after trimming. */
  authorize(target: AgencyFollowupSendTarget): readonly string[];
}

type Environment = Record<string, string | undefined>;

interface TestAllowlistEntry {
  enrollmentId: string;
  messageId: string;
  recipientEmail: string;
}

const VERIFIED_SENDER_DOMAIN = "caseloadselect.ca";
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseMode(value: string | undefined): AgencyFollowupSendMode {
  switch (value?.trim().toLowerCase()) {
    case "test": return "test";
    case "live": return "live";
    case "off":
    default: return "off";
  }
}

function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean))];
}

function parseTestAllowlist(value: string | undefined): TestAllowlistEntry[] {
  if (!value?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): TestAllowlistEntry[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      if (typeof row.enrollmentId !== "string" || typeof row.messageId !== "string" ||
          typeof row.recipientEmail !== "string") return [];
      const enrollmentId = row.enrollmentId.trim();
      const messageId = row.messageId.trim();
      const recipientEmail = row.recipientEmail.trim();
      if (!enrollmentId || !messageId || !EMAIL_RE.test(recipientEmail)) return [];
      return [{ enrollmentId, messageId, recipientEmail }];
    });
  } catch {
    return [];
  }
}

function emailAddress(value: string | undefined): string | null {
  const candidate = value?.trim() ?? "";
  if (!candidate || /[\r\n]/.test(candidate)) return null;
  const angleMatch = candidate.match(/^(?:[^<>\r\n]+\s)?<([^<>\s]+)>$/);
  const address = angleMatch?.[1] ?? candidate;
  if (!EMAIL_RE.test(address)) return null;
  const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
  return domain === VERIFIED_SENDER_DOMAIN ? address : null;
}

export function resolveAgencyFollowupSendConfig(env: Environment = process.env): AgencyFollowupSendConfig {
  const mode = parseMode(env.AGENCY_FOLLOWUP_SEND_MODE);
  const configuredFrom = env.AGENCY_FOLLOWUP_FROM?.trim() || null;
  const configuredReplyTo = env.AGENCY_FOLLOWUP_REPLY_TO?.trim() || null;
  const apiKeyConfigured = Boolean(env.RESEND_API_KEY?.trim());
  const webhookSecretConfigured = Boolean(env.AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET?.trim());
  const unsubscribeSecretConfigured = Boolean(env.AGENCY_FOLLOWUP_UNSUBSCRIBE_SECRET?.trim()) &&
    Buffer.byteLength(env.AGENCY_FOLLOWUP_UNSUBSCRIBE_SECRET?.trim() ?? "", "utf8") >= 32;
  const testRecipients = parseEmailList(env.AGENCY_FOLLOWUP_TEST_RECIPIENT_ALLOWLIST);
  const testTargets = parseTestAllowlist(env.AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST);
  const liveEnrollments = parseEmailList(env.AGENCY_FOLLOWUP_LIVE_ENROLLMENT_ALLOWLIST);
  const liveEnrollmentIds = [...new Set(liveEnrollments.map((id) => id.trim().toLowerCase()))];

  const blockers: string[] = [];
  if (mode !== "off") {
    if (!apiKeyConfigured) blockers.push("resend_api_key_missing");
    if (!webhookSecretConfigured) blockers.push("resend_webhook_secret_missing");
    if (!unsubscribeSecretConfigured) blockers.push("unsubscribe_secret_missing_or_weak");
    if (!configuredFrom || !emailAddress(configuredFrom)) blockers.push("followup_sender_missing_or_unverified");
    if (!configuredReplyTo || !emailAddress(configuredReplyTo)) blockers.push("followup_reply_to_missing_or_unverified");
    if (mode === "test") {
      if (testRecipients.length === 0) blockers.push("test_recipient_allowlist_empty");
      if (testTargets.length === 0) blockers.push("test_record_allowlist_empty_or_invalid");
      if (testTargets.length > 100) blockers.push("test_record_allowlist_too_large");
    }
    if (mode === "live") {
      if (liveEnrollmentIds.length === 0) blockers.push("live_enrollment_allowlist_empty");
      if (liveEnrollmentIds.some((id) => !UUID_RE.test(id))) blockers.push("live_enrollment_allowlist_invalid");
      if (liveEnrollmentIds.length > 100) blockers.push("live_enrollment_allowlist_too_large");
    }
  }

  const config: AgencyFollowupSendConfig = {
    mode,
    configuredFrom,
    configuredReplyTo,
    apiKeyConfigured,
    webhookSecretConfigured,
    unsubscribeSecretConfigured,
    maxBatchSize: 1,
    testClaimTargets: mode === "test"
      ? testTargets.map(({ enrollmentId, messageId, recipientEmail }) => ({ enrollmentId, messageId, recipientEmail }))
      : [],
    liveClaimEnrollmentIds: mode === "live" && blockers.length === 0 ? liveEnrollmentIds : [],
    ready: mode !== "off" && blockers.length === 0,
    blockers,
    authorize(target) {
      if (mode === "off") return ["send_mode_off"];
      if (blockers.length > 0) return blockers;
      const recipientEmail = target.recipientEmail;
      if (target.enrollmentId !== target.enrollmentId.trim() ||
          target.messageId !== target.messageId.trim() ||
          recipientEmail !== recipientEmail.trim() ||
          !target.enrollmentId || !target.messageId || !EMAIL_RE.test(recipientEmail)) {
        return ["send_target_invalid"];
      }
      if (mode === "test") {
        const allowedRecipient = testRecipients.some((allowed) => allowed === recipientEmail);
        const allowedRecord = testTargets.some((allowed) =>
          allowed.enrollmentId === target.enrollmentId &&
          allowed.messageId === target.messageId &&
          allowed.recipientEmail === recipientEmail);
        const reasons: string[] = [];
        if (!allowedRecipient) reasons.push("test_recipient_not_allowlisted");
        if (!allowedRecord) reasons.push("test_enrollment_message_recipient_not_allowlisted");
        return reasons;
      }
      return liveEnrollmentIds.includes(target.enrollmentId) ? [] : ["live_enrollment_not_allowlisted"];
    },
  };
  return config;
}

/**
 * Parse only the immutable logical identity already assigned by the outbox.
 * This prevents an adapter call without the exact enrollment/message gate.
 */
export function parseAgencyFollowupLogicalKey(key: string): { enrollmentId: string; messageId: string } | null {
  if (key.length < 1 || key.length > 256) return null;
  const match = /^agency-followup:([^:]+):([^:]+)$/.exec(key);
  if (!match) return null;
  return { enrollmentId: match[1], messageId: match[2] };
}
