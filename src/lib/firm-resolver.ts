/**
 * Firm resolution by Meta-side asset ID.
 *
 * Every inbound channel webhook (Messenger, Instagram, WhatsApp Cloud API)
 * arrives with an asset ID that identifies WHICH inbound surface the message
 * was sent to. The receiver needs to map that asset ID to one firm so the
 * screen engine runs with the right firm config (practice areas, decline
 * templates, etc.).
 *
 * The mapping columns live on `intake_firms`:
 *
 *   facebook_page_id              — Messenger webhook: entry[].id
 *   instagram_business_account_id — Instagram DM webhook: entry[].id (the IG
 *                                   account the message was sent TO; the
 *                                   sender's IG ID lives on event.sender.id)
 *   whatsapp_phone_number_id      — WhatsApp Cloud API webhook:
 *                                   entry[].changes[].value.metadata.phone_number_id
 *
 * Each column has a partial unique index so one asset maps to exactly one
 * firm. The receivers return 200 even on no-match (Meta requires a fast 200
 * or it disables the subscription) and log a structured warning so the
 * operator can spot misrouted inbound traffic.
 *
 * Service-role only. Receivers run server-side with supabaseAdmin; there is
 * no anon path that needs firm metadata by Meta asset ID.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

export type MetaChannel = 'facebook_messenger' | 'instagram_dm' | 'whatsapp';

export interface FirmContext {
  /** intake_firms.id (uuid) — primary firm identifier across the codebase. */
  firmId: string;
  /** Human-readable firm name (intake_firms.name) — for logs and notifications. */
  firmName: string;
}

/**
 * Resolve a Messenger Page ID to a firm context.
 *
 * The Messenger webhook payload's `entry[].id` is the Page ID — this is the
 * asset ID we matched against `intake_firms.facebook_page_id`.
 *
 * Returns null if no firm claims that Page ID. The receiver should ACK 200
 * and log; this is the expected behaviour for unknown inbound (Meta may
 * deliver echoes or events for Pages we no longer route).
 */
export async function resolveFirmByFacebookPageId(
  pageId: string,
): Promise<FirmContext | null> {
  if (!pageId) return null;
  const { data, error } = await supabaseAdmin
    .from('intake_firms')
    .select('id, name')
    .eq('facebook_page_id', pageId)
    .maybeSingle();
  if (error) {
    console.error(`[firm-resolver] facebook lookup failed pageId=${pageId}:`, error);
    return null;
  }
  if (!data) return null;
  return { firmId: data.id as string, firmName: (data.name as string) ?? 'Unknown firm' };
}

/**
 * Resolve an Instagram Business Account ID to a firm context.
 *
 * The Instagram DM webhook payload's `entry[].id` is the IG Business Account
 * ID — NOT the @username. The numeric ID is what Graph API + webhooks use.
 *
 * Returns null if no firm claims that account ID.
 */
export async function resolveFirmByInstagramBusinessAccountId(
  igBusinessAccountId: string,
): Promise<FirmContext | null> {
  if (!igBusinessAccountId) return null;
  const { data, error } = await supabaseAdmin
    .from('intake_firms')
    .select('id, name')
    .eq('instagram_business_account_id', igBusinessAccountId)
    .maybeSingle();
  if (error) {
    console.error(
      `[firm-resolver] instagram lookup failed igBusinessAccountId=${igBusinessAccountId}:`,
      error,
    );
    return null;
  }
  if (!data) return null;
  return { firmId: data.id as string, firmName: (data.name as string) ?? 'Unknown firm' };
}

/**
 * Resolve a WhatsApp Cloud API Phone Number ID to a firm context.
 *
 * The WhatsApp Cloud API webhook payload's
 * `entry[].changes[].value.metadata.phone_number_id` is the asset ID — NOT
 * the display phone number (`+1 555 …`). Meta uses the numeric ID
 * internally; the display number is for humans.
 *
 * Returns null if no firm claims that phone number ID.
 */
export async function resolveFirmByWhatsappPhoneNumberId(
  phoneNumberId: string,
): Promise<FirmContext | null> {
  if (!phoneNumberId) return null;
  const { data, error } = await supabaseAdmin
    .from('intake_firms')
    .select('id, name')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .maybeSingle();
  if (error) {
    console.error(
      `[firm-resolver] whatsapp lookup failed phoneNumberId=${phoneNumberId}:`,
      error,
    );
    return null;
  }
  if (!data) return null;
  return { firmId: data.id as string, firmName: (data.name as string) ?? 'Unknown firm' };
}
