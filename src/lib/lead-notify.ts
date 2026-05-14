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
 *     the lead still lands, just no email.
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
  band: "A" | "B" | "C" | null;
  decisionDeadlineIso: string;
  whaleNurture: boolean;
  intakeLanguage?: string | null;
  /**
   * Drives the email's visual treatment and subject prefix. Defaults to
   * 'triaging' for backward compat with legacy callers; new call sites must
   * pass 'triaging' or 'declined' explicitly so the doctrine fix (2026-05-14)
   * surfaces declined leads to lawyers too.
   */
  lifecycleStatus?: LifecycleStatus;
}

export interface NotifyResult {
  attempted: number;
  sent: number;
  skipped: number;
  errors: string[];
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
 * the firm cannot be resolved (orphan firmId, deleted firm, etc.) — caller
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

  // Legacy fallback — branding.lawyer_email when firm_lawyers is empty.
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
    return result;
  }

  const { firm, recipients } = resolved;
  if (recipients.length === 0) {
    // No lawyers and no legacy email. Operator should add a firm_lawyers
    // row. Not an error per se — just no notification target.
    result.skipped = 1;
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
    lifecycleStatus: args.lifecycleStatus ?? "triaging",
  };

  const email = buildNewLeadEmail(emailInput);

  for (const recipient of recipients) {
    result.attempted += 1;
    try {
      const dispatch = await sendEmail(recipient.email, email.subject, email.html);
      if (dispatch.skipped) {
        result.skipped += 1;
      } else {
        result.sent += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${recipient.email}: ${msg}`);
    }
  }

  return result;
}
