/**
 * SMS send adapter. DORMANT (WP-7, CaseLoad_CRM_Migration_Plan_v1.md Phase 2
 * rail 5: "SMS (gated by 10DLC): Twilio direct once registration clears").
 *
 * No `twilio` SDK dependency: Twilio's Messages resource is a plain REST POST
 * (Basic Auth, form-encoded body), so a skeleton this small uses fetch()
 * directly rather than adding a package that will not be exercised until
 * 10DLC clears and an operator adds the env vars below.
 *
 * Mirrors lib/email.ts's disabled-by-default shape: no TWILIO_* env vars set
 * (the shipped state, always, in this sprint) means every call reports
 * skipped: true and never reaches the network.
 */

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

export function isSmsSendEnabled(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER,
  );
}

export interface SendSmsResult {
  skipped: boolean;
  sid?: string;
}

/**
 * Sends an SMS via Twilio's REST API. Skips (returns {skipped:true}) unless
 * all three TWILIO_* env vars are present, exactly like sendEmail's
 * RESEND_API_KEY gate. Never called with real cadence content in this
 * sprint: no cadence_rules row has channel='sms' yet (10DLC gates that).
 */
export async function sendSms(to: string, body: string): Promise<SendSmsResult> {
  if (!isSmsSendEnabled()) return { skipped: true };

  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_NUMBER!;

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const params = new URLSearchParams({ To: to, From: from, Body: body });

  const res = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Twilio send failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { sid?: string };
  return { skipped: false, sid: json.sid };
}
