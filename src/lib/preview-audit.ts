import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type { PreviewTarget } from "@/lib/preview-mode";

/**
 * Append one row to operator_preview_log each time an operator opens a preview
 * (DR-084). Best-effort: a failed insert is logged and swallowed so it never
 * blocks the operator entering preview. The client-matter preview surfaces real
 * client PII inside the client shell, so opening it is recorded here.
 */
export async function logPreviewOpen(input: {
  operatorId: string | null;
  operatorEmail: string | null;
  firmId: string;
  matterId?: string | null;
  target: PreviewTarget;
}): Promise<void> {
  try {
    await supabase.from("operator_preview_log").insert({
      operator_id: input.operatorId,
      operator_email: input.operatorEmail,
      firm_id: input.firmId,
      matter_id: input.matterId ?? null,
      target: input.target,
    });
  } catch (e) {
    console.warn("[preview-audit] insert failed:", e);
  }
}
