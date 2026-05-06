/**
 * I/O wrapper for file-exchange notifications.
 *
 *   uploader = operator -> fan-out to firm_lawyers (role = 'lawyer')
 *   uploader = lawyer   -> notify firm_lawyers (role = 'operator')
 *
 * Recipients are resolved from firm_lawyers; legacy branding.lawyer_email is
 * the lawyer-side fallback when no firm_lawyers row exists. There is no
 * legacy fallback for operator routing — operators only get pinged if they
 * have a firm_lawyers row with role='operator' for the firm.
 *
 * Best-effort: failures are logged and swallowed; the upload itself has
 * already succeeded by the time this fires.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/email";
import { buildFileEmail } from "@/lib/file-notify-pure";
import type { FirmFileRow, ActorContext } from "@/lib/firm-files";
import type { FileCategory } from "@/lib/firm-files-pure";

interface FirmRow {
  id: string;
  name: string | null;
  branding: { lawyer_email?: string; firm_name?: string } | null;
}

interface RecipientRow {
  id: string;
  email: string;
  name: string | null;
}

interface ActorRow {
  id: string;
  email: string;
  name: string | null;
}

export interface NotifyArgs {
  firmId: string;
  file: FirmFileRow;
  actor: ActorContext;
}

export interface NotifyResult {
  attempted: number;
  sent: number;
  skipped: number;
  errors: string[];
}

function resolveAppOrigin(): string {
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  if (appDomain) return `https://app.${appDomain}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function loadFirm(firmId: string): Promise<FirmRow | null> {
  const { data } = await supabase
    .from("intake_firms")
    .select("id, name, branding")
    .eq("id", firmId)
    .maybeSingle()
    .returns<FirmRow>();
  return data ?? null;
}

async function loadRecipients(args: {
  firmId: string;
  uploaderRole: "operator" | "lawyer";
  legacyLawyerEmail: string | undefined;
}): Promise<RecipientRow[]> {
  const targetRole = args.uploaderRole === "operator" ? "lawyer" : "operator";
  const { data } = await supabase
    .from("firm_lawyers")
    .select("id, email, name")
    .eq("firm_id", args.firmId)
    .eq("role", targetRole)
    .returns<RecipientRow[]>();

  const rows = (data ?? []).filter((r) => !!r.email);
  if (rows.length > 0) return rows;

  // Legacy fallback only applies when notifying lawyers (operator uploaded).
  if (targetRole === "lawyer" && args.legacyLawyerEmail) {
    return [{ id: `legacy:${args.firmId}`, email: args.legacyLawyerEmail, name: null }];
  }
  return [];
}

async function loadActorLabel(actor: ActorContext): Promise<string> {
  if (actor.role === "operator" && !actor.lawyer_id) return "Your operator";
  if (actor.role === "lawyer" && !actor.lawyer_id) return "A lawyer";
  if (!actor.lawyer_id) return actor.role === "operator" ? "Your operator" : "A lawyer";

  const { data } = await supabase
    .from("firm_lawyers")
    .select("id, email, name")
    .eq("id", actor.lawyer_id)
    .maybeSingle()
    .returns<ActorRow>();

  if (data?.name && data.name.trim()) return data.name.trim().split(/\s+/)[0];
  if (data?.email) return data.email.split("@")[0];
  return actor.role === "operator" ? "Your operator" : "A lawyer";
}

export async function notifyOnFirmFileUpload(args: NotifyArgs): Promise<NotifyResult> {
  const result: NotifyResult = { attempted: 0, sent: 0, skipped: 0, errors: [] };

  const firm = await loadFirm(args.firmId);
  if (!firm) {
    result.errors.push(`firm ${args.firmId} not found`);
    return result;
  }

  const recipients = await loadRecipients({
    firmId: args.firmId,
    uploaderRole: args.actor.role,
    legacyLawyerEmail: firm.branding?.lawyer_email,
  });

  if (recipients.length === 0) {
    result.skipped = 1;
    return result;
  }

  const firmName = firm.branding?.firm_name ?? firm.name ?? "your firm";
  const filesUrl = `${resolveAppOrigin()}/portal/${args.firmId}/files`;
  const uploaderLabel = await loadActorLabel(args.actor);

  const email = buildFileEmail({
    firmName,
    fileDisplayName: args.file.display_name,
    fileCategory: args.file.category as FileCategory,
    fileSizeBytes: args.file.size_bytes,
    description: args.file.description,
    filesUrl,
    uploaderRole: args.actor.role,
    uploaderLabel,
  });

  for (const recipient of recipients) {
    result.attempted += 1;
    try {
      const dispatch = await sendEmail(recipient.email, email.subject, email.html);
      if (dispatch.skipped) result.skipped += 1;
      else result.sent += 1;
    } catch (err) {
      result.errors.push(
        `${recipient.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
