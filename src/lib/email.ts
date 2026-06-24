import { Resend } from "resend";

const key = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? "CaseLoad Select <noreply@caseloadselect.ca>";
export const resend = key ? new Resend(key) : null;

/**
 * Send an email through Resend.
 *
 * Pass an `idempotencyKey` to make the send safe to retry across crashes:
 * Resend dedupes by this key for 24 hours, so a crash-after-send followed by a
 * replay returns the same response without re-delivering. The notification
 * cron passes a content-stable hash so the same digest is never sent twice
 * even if the outbox stamp didn't land.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  options: { idempotencyKey?: string } = {},
) {
  if (!resend) return { skipped: true as const };
  const sendOptions = options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined;
  const { data, error } = await resend.emails.send({ from, to, subject, html }, sendOptions);
  if (error) throw new Error(error.message);
  return { skipped: false as const, id: data?.id };
}
