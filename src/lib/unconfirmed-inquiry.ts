/**
 * Unconfirmed inquiry persistence — the rejected side of the contact-capture
 * doctrine gate.
 *
 * Doctrine (2026-05-15): inbound intakes that lack a name and/or any
 * reachable contact (email or phone) are NOT leads. They land here for
 * ops visibility but never reach the lawyer's triage portal.
 *
 * The shape mirrors what `screened_leads` carries for audit fields
 * (channel, raw_transcript, matter_type, practice_area, intake_language)
 * so an ops dashboard can render both tables side-by-side without
 * shape gymnastics. Contact fields are intentionally omitted — the
 * whole point of this table is that they're missing.
 *
 * RLS posture: same as screened_leads — service-role only, no public
 * read path. The portal has no view of this table by design.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { UnconfirmedReason } from '@/lib/screen-engine/contact-doctrine';

export interface PersistUnconfirmedInquiryArgs {
  firmId: string;
  channel: 'web' | 'facebook' | 'instagram' | 'whatsapp' | 'voice' | 'sms' | 'gbp';
  /** Channel-specific sender identifier (PSID / IGSID / wa_id / phone / null for web). */
  senderId?: string | null;
  /** Channel-specific metadata blob. */
  senderMeta?: Record<string, unknown> | null;
  rawTranscript?: string | null;
  matterType?: string | null;
  practiceArea?: string | null;
  intakeLanguage?: string | null;
  reason: UnconfirmedReason;
  followUpAttempts?: number;
}

export interface PersistUnconfirmedInquiryResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function persistUnconfirmedInquiry(
  args: PersistUnconfirmedInquiryArgs,
): Promise<PersistUnconfirmedInquiryResult> {
  const { data, error } = await supabase
    .from('unconfirmed_inquiries')
    .insert({
      firm_id: args.firmId,
      channel: args.channel,
      sender_id: args.senderId ?? null,
      sender_meta: args.senderMeta ?? null,
      raw_transcript: args.rawTranscript ?? null,
      matter_type: args.matterType ?? null,
      practice_area: args.practiceArea ?? null,
      intake_language: args.intakeLanguage ?? null,
      reason: args.reason,
      follow_up_attempts: args.followUpAttempts ?? 0,
    })
    .select('id')
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data.id as string };
}
