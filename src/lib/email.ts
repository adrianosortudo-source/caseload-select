import { Resend } from "resend";

const key = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM ?? "CaseLoad Select <noreply@caseloadselect.ca>";
export const resend = key ? new Resend(key) : null;

export async function sendEmail(to: string, subject: string, html: string) {
  if (!resend) return { skipped: true as const };
  const { data, error } = await resend.emails.send({ from, to, subject, html });
  if (error) throw new Error(error.message);
  return { skipped: false as const, id: data?.id };
}
