/**
 * Operator email alarm for unverified production deployments.
 *
 * The Checks API path (blocking deployment.created checks) is a confirmed
 * dead end on this project's plan: personal access tokens get a 403
 * invalidToken response, Vercel requires an integration OAuth token for
 * that endpoint. Free-tier Vercel cannot technically block alias
 * assignment here. This module is the compensating control: it tells the
 * operator within about a minute whenever a production deployment is
 * dirty-tree, untraceable to a real commit, or failed its GitHub Actions
 * checks, so a bad deploy is caught and rolled back quickly rather than
 * discovered later.
 *
 * Recipient is fixed per DR-047 (CRM Bible): the operator inbox is
 * adriano@caseloadselect.ca only, never a personal address.
 */

import { sendEmail } from "@/lib/email";

const OPERATOR_EMAIL = process.env.OPERATOR_NOTIFICATION_EMAIL || "adriano@caseloadselect.ca";

export interface DeployAlarmMeta {
  gitDirty?: string;
  githubCommitSha?: string;
  githubCommitRef?: string;
  actor?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;font-weight:600;">${escapeHtml(label)}</td><td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`;
}

function buildHtml(deploymentId: string, reason: string, meta: DeployAlarmMeta): string {
  const rows = [
    row("Deployment ID", deploymentId),
    row("Reason", reason),
    row("gitDirty", meta.gitDirty ?? "none"),
    row("Commit SHA", meta.githubCommitSha ?? "none"),
    row("Branch ref", meta.githubCommitRef ?? "none"),
    row("Actor", meta.actor ?? "unknown"),
  ].join("");

  return `
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
${rows}
</table>
<p style="font-family:sans-serif;font-size:14px;">Inspect: https://vercel.com/adrianosortudo-7282s-projects/caseload-select</p>
<p style="font-family:sans-serif;font-size:14px;">Rollback if needed: vercel rollback (operator only, sentinel required per issue #61 hook).</p>
`;
}

export async function sendDeployAlarm(
  deploymentId: string,
  reason: string,
  meta: DeployAlarmMeta,
): Promise<void> {
  try {
    const result = await sendEmail(
      OPERATOR_EMAIL,
      `[DEPLOY ALARM] Unverified production deployment ${deploymentId}`,
      buildHtml(deploymentId, reason, meta),
    );
    // sendEmail returns {skipped:true} rather than throwing when
    // RESEND_API_KEY is missing, so a silently-dropped alarm would
    // otherwise leave no trace anywhere. This is the one signal that a
    // key rotation gap has gone unnoticed.
    if (result.skipped) {
      console.error(
        `deploy-gate: sendDeployAlarm SKIPPED for ${deploymentId} (RESEND_API_KEY not set), reason: ${reason}`,
      );
    }
  } catch (err) {
    console.error("deploy-gate: sendDeployAlarm failed", err);
  }
}
