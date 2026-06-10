/**
 * I/O wrapper for the new-lead notification email.
 *
 * Resolves recipients from firm_lawyers (role='lawyer'), composes the email
 * via lead-notify-pure, and dispatches via Resend. Best-effort:
 *
 *   - Failure does NOT block /api/intake-v2 from returning success.
 *   - If no firm_lawyers row exists for the firm, falls back to the legacy
 *     intake_firms.branding.lawyer_email field.
 *   - If RESEND_API_KEY is missing, sendEmail no-ops (returns skipped:true);
 *     the lead still lands and the skip is recorded as an explicit error.
 *
 * DR-046 (launch audit fix H4, 2026-06-09): every attempt persists its
 * outcome onto the screened_leads row keyed by lead_id, so a failed send
 * is visible and recoverable instead of vanishing into a discarded
 * NotifyResult:
 *
 *   notification_sent_at         (set on success, any recipient delivered)
 *   notification_error           (set on failure, including the
 *                                 RESEND_API_KEY-missing skip; partial
 *                                 fan-out failures are kept on success too)
 *   notification_attempts        (incremented every attempt)
 *   notification_last_attempt_at (every attempt)
 *
 * Persistence is best-effort: its own failure never throws into the intake
 * path, only console.errors with the lead id. The operator-only retry
 * endpoint /api/admin/screened-leads/[id]/retry-notification replays a
 * failed or pending notification on demand (replay: true adds a [REPLAY]
 * subject prefix).
 *
 * The ENTRY point used by /api/intake-v2 is `notifyLawyersOfNewLead`. It
 * intentionally accepts the same shape that the route already has on hand
 * (no DB re-reads) plus the firmId for recipient lookup.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/email";
import {
  buildNewLeadEmail,
  deriveFirstName,
  type NewLeadEmailInput,
  type LifecycleStatus,
} from "@/lib/lead-notify-pure";

interface FirmLawyerRecipient {
  id: string;
  email: string;
}

interface FirmRow {
  id: string;
  name: string | null;
  branding: { lawyer_email?: string; firm_name?: string } | null;
}

export interface NotifyArgs {
  firmId: string;
  leadId: string;
  contactName: string | null;
  matterType: string;
  practiceArea: string;
  band: "A" | "B" | "C" | "D" | null;
  decisionDeadlineIso: string;
  whaleNurture: boolean;
  intakeLanguage?: string | null;
  /** Inbound channel code. Omit or null for web (default). */
  channel?: string | null;
  /**
   * Drives the email's visual treatment and subject prefix. Defaults to
   * 'triaging' for backward compat with legacy callers; new call sites must
   * pass 'triaging' or 'declined' explicitly so the doctrine fix (2026-05-14)
   * surfaces declined leads to lawyers too.
   */
  lifecycleStatus?: LifecycleStatus;
  /**
   * Set by the operator retry endpoint. Prefixes the subject with [REPLAY]
   * so the lawyer can tell a re-send from a fresh notification at a glance.
   */
  replay?: boolean;
}

export interface NotifyResult {
  attempted: number;
  sent: number;
  skipped: number;
  errors: string[];
}

/**
 * Persists the delivery outcome onto the screened_leads row (DR-046
 * invariant 1). Best-effort: an update failure is logged with the lead id
 * and swallowed so the intake path never breaks on bookkeeping. Rows that
 * do not exist in screened_leads (e.g. legacy /api/screen leads) update
 * zero rows, which is fine.
 */
async function persistNotificationOutcome(
  leadId: string,
  success: boolean,
  errorText: string | null,
): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    const { data: row, error: readErr } = await supabase
      .from("screened_leads")
      .select("notification_attempts")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);

    const attempts =
      ((row as { notification_attempts?: number | null } | null)
        ?.notification_attempts ?? 0) + 1;
    const update = success
      ? {
          notification_sent_at: nowIso,
          // Keep per-recipient failures visible on a partial fan-out;
          // a fully clean send clears the field.
          notification_error: errorText,
          notification_attempts: attempts,
          notification_last_attempt_at: nowIso,
        }
      : {
          notification_error: errorText,
          notification_attempts: attempts,
          notification_last_attempt_at: nowIso,
        };

    const { error: updateErr } = await supabase
      .from("screened_leads")
      .update(update)
      .eq("lead_id", leadId);
    if (updateErr) throw new Error(updateErr.message);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[lead-notify] notification state update failed lead_id=${leadId}: ${msg}`,
    );
  }
}

/**
 * Resolve the production app origin used in email links. Mirrors the logic
 * in /api/portal/request-link so all outbound links land on the same host.
 */
function resolveAppOrigin(): string {
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  if (appDomain) return `https://app.${appDomain}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Load firm row + lawyer recipients in two cheap queries. Returns null when
 * the firm cannot be resolved (orphan firmId, deleted firm, etc.); caller
 * skips notification in that case.
 */
async function loadFirmAndRecipients(
  firmId: string,
): Promise<{ firm: FirmRow; recipients: FirmLawyerRecipient[] } | null> {
  const { data: firm } = await supabase
    .from("intake_firms")
    .select("id, name, branding")
    .eq("id", firmId)
    .maybeSingle()
    .returns<FirmRow>();

  if (!firm) return null;

  // Multi-lawyer recipients via firm_lawyers (canonical).
  const { data: lawyers } = await supabase
    .from("firm_lawyers")
    .select("id, email")
    .eq("firm_id", firmId)
    .eq("role", "lawyer")
    .returns<FirmLawyerRecipient[]>();

  let recipients = (lawyers ?? []).filter((l) => !!l.email);

  // Legacy fallback: branding.lawyer_email when firm_lawyers is empty.
  if (recipients.length === 0) {
    const legacyEmail = firm.branding?.lawyer_email;
    if (legacyEmail) {
      recipients = [{ id: `legacy:${firmId}`, email: legacyEmail }];
    }
  }

  return { firm, recipients };
}

export async function notifyLawyersOfNewLead(args: NotifyArgs): Promise<NotifyResult> {
  const result: NotifyResult = { attempted: 0, sent: 0, skipped: 0, errors: [] };

  const resolved = await loadFirmAndRecipients(args.firmId);
  if (!resolved) {
    result.errors.push(`firm ${args.firmId} not found`);
    await persistNotificationOutcome(args.leadId, false, result.errors.join("; "));
    return result;
  }

  const { firm, recipients } = resolved;
  if (recipients.length === 0) {
    // No lawyers and no legacy email. The operator should add a firm_lawyers
    // row. Recorded as an error so the queue chip reads Failed instead of
    // Pending forever.
    result.skipped = 1;
    result.errors.push(
      `no notification recipients configured for firm ${args.firmId}`,
    );
    await persistNotificationOutcome(args.leadId, false, result.errors.join("; "));
    return result;
  }

  const firmName = firm.branding?.firm_name ?? firm.name ?? "your firm";
  const briefUrl = `${resolveAppOrigin()}/portal/${args.firmId}/triage/${encodeURIComponent(args.leadId)}`;

  const emailInput: NewLeadEmailInput = {
    firmName,
    firstName: deriveFirstName(args.contactName),
    matterType: args.matterType,
    practiceArea: args.practiceArea,
    band: args.band,
    decisionDeadlineIso: args.decisionDeadlineIso,
    whaleNurture: args.whaleNurture,
    briefUrl,
    intakeLanguage: args.intakeLanguage ?? null,
    channel: args.channel ?? null,
    lifecycleStatus: args.lifecycleStatus ?? "triaging",
  };

  const email = buildNewLeadEmail(emailInput);
  const subject = args.replay ? `[REPLAY] ${email.subject}` : email.subject;

  for (const recipient of recipients) {
    result.attempted += 1;
    try {
      const dispatch = await sendEmail(recipient.email, subject, email.html);
      if (dispatch.skipped) {
        result.skipped += 1;
        // sendEmail no-ops without the key. Record an explicit error once
        // (every recipient skips for the same reason) so the outcome is a
        // visible Failed state, not a silent no-op.
        if (!result.errors.includes("RESEND_API_KEY not configured")) {
          result.errors.push("RESEND_API_KEY not configured");
        }
      } else {
        result.sent += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${recipient.email}: ${msg}`);
    }
  }

  await persistNotificationOutcome(
    args.leadId,
    result.sent > 0,
    result.errors.length > 0 ? result.errors.join("; ") : null,
  );

  return result;
}
