import { NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { resolveAgencyFollowupSendConfig } from "@/lib/agency-followup-send-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only operator diagnostic. This never sends, claims, changes a setting,
 * contacts Resend, or returns secret values. The test-mode evaluation uses a
 * copy of this deployment's environment and does not change its real mode.
 */
export async function GET() {
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.lawyer_id) return NextResponse.json({ error: "Operator identity required" }, { status: 403 });

  const actual = resolveAgencyFollowupSendConfig();
  const test = resolveAgencyFollowupSendConfig({ ...process.env, AGENCY_FOLLOWUP_SEND_MODE: "test" });
  const recipients = [...new Set((process.env.AGENCY_FOLLOWUP_TEST_RECIPIENT_ALLOWLIST ?? "")
    .split(/[\r\n,]+/).map((value) => value.trim()).filter(Boolean))];

  let rawRecordCount: number | null = null;
  try {
    const records: unknown = JSON.parse(process.env.AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST ?? "");
    if (Array.isArray(records)) rawRecordCount = records.length;
  } catch {
    // Keep null for a missing or malformed record restriction.
  }

  const target = rawRecordCount === 1 && test.testClaimTargets.length === 1
    ? test.testClaimTargets[0] : null;
  const hasSingleMatchingTarget = Boolean(
    target && recipients.length === 1 && recipients[0] === target.recipientEmail,
  );

  return NextResponse.json({
    actualMode: actual.mode,
    simulatedTestConfigurationReady: test.ready,
    simulatedTestBlockers: test.blockers,
    maxBatchSize: test.maxBatchSize,
    singleRecipientAndRecord: hasSingleMatchingTarget,
    testTarget: hasSingleMatchingTarget ? target : null,
    sender: test.configuredFrom,
    replyToMatchesTestRecipient: Boolean(
      hasSingleMatchingTarget && test.configuredReplyTo === recipients[0],
    ),
    providerAuthorizationVerified: false,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
