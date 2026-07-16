/**
 * Shared per-firm config loader for the Firm Assist public routes
 * (POST /api/assist/[firmId] and GET /api/assist/[firmId]/config). Kept out
 * of either route file so both stay in lockstep on what "this firm's assist
 * surface" means.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

export interface FirmAssistConfig {
  found: boolean;
  embedOrigins: string[];
  customDomain: string | null;
  firmName: string;
}

export async function loadFirmAssistConfig(firmId: string): Promise<FirmAssistConfig> {
  const { data } = await supabase
    .from('intake_firms')
    .select('id, name, branding, embed_origins, custom_domain')
    .eq('id', firmId)
    .maybeSingle();

  if (!data) {
    return { found: false, embedOrigins: [], customDomain: null, firmName: '' };
  }

  const branding = (data.branding ?? null) as { firm_name?: string } | null;
  return {
    found: true,
    embedOrigins: Array.isArray(data.embed_origins) ? (data.embed_origins as string[]) : [],
    customDomain: (data.custom_domain as string | null) ?? null,
    firmName: branding?.firm_name ?? (data.name as string | null) ?? 'the firm',
  };
}
