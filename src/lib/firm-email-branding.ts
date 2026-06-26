import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type { FirmBranding } from "@/lib/widget-theme";
import { resolveEmailBranding, type EmailBranding } from "@/lib/email-branding";

/**
 * Load a firm's email correspondence tokens by id. Returns null when the firm
 * is missing or has no configured theme, which tells the caller to keep its
 * existing default email rendering. Best-effort: a query error resolves to
 * null rather than throwing, so an email send never fails on branding lookup.
 *
 * Falls back to the firm row's name when branding.firm_name is absent, so the
 * wordmark is never empty for a themed firm.
 */
export async function loadFirmEmailBranding(
  firmId: string | null | undefined,
): Promise<EmailBranding | null> {
  if (!firmId) return null;
  const { data, error } = await supabase
    .from("intake_firms")
    .select("name, branding")
    .eq("id", firmId)
    .maybeSingle();
  if (error || !data) return null;

  const branding = (data.branding ?? {}) as FirmBranding;
  const merged: FirmBranding = {
    ...branding,
    firm_name: branding.firm_name || (data.name as string | undefined) || "",
  };
  return resolveEmailBranding(merged);
}
