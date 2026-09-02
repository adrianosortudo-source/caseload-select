import 'server-only';

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

export const CHANNEL_CONVERSATION_LEDGER_ENV =
  'CHANNEL_CONVERSATION_LEDGER_ENABLED';

/**
 * The global switch is intentionally exact. Missing, mixed-case, or any value
 * other than the literal `true` is disabled.
 */
export function isChannelConversationLedgerGloballyEnabled(): boolean {
  return process.env[CHANNEL_CONVERSATION_LEDGER_ENV] === 'true';
}

/**
 * Ledger access requires both the exact-true server switch and the firm's
 * explicit database approval. Query errors, missing rows, and missing columns
 * all fail closed.
 */
export async function isChannelConversationLedgerEnabledForFirm(
  firmId: string,
): Promise<boolean> {
  if (!isChannelConversationLedgerGloballyEnabled()) return false;

  const { data, error } = await supabase
    .from('intake_firms')
    .select('channel_conversation_ledger_enabled')
    .eq('id', firmId)
    .maybeSingle();

  return !error && data?.channel_conversation_ledger_enabled === true;
}

export async function requireChannelConversationLedger(
  firmId: string,
): Promise<void> {
  if (!(await isChannelConversationLedgerEnabledForFirm(firmId))) {
    throw new Error('channel conversation ledger unavailable');
  }
}
