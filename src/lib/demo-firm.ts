/**
 * Demo firm helpers.
 *
 * Used by /demo/portal pages to resolve the Hartwell Law PC [DEMO]
 * firm ID without requiring a portal session.
 */

import { supabase } from "@/lib/supabase";

export const DEMO_FIRM_NAME = "Hartwell Law PC [DEMO]";

let _cachedId: string | null = null;

export async function getDemoFirmId(): Promise<string | null> {
  if (_cachedId) return _cachedId;
  const { data } = await supabase
    .from("intake_firms")
    .select("id")
    .eq("name", DEMO_FIRM_NAME)
    .single();
  _cachedId = (data?.id as string) ?? null;
  return _cachedId;
}
