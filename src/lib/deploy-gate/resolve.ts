/**
 * Background alarm loop for a single production deployment.
 * Runs inside waitUntil() after the webhook handler has already ACKed
 * Vercel, since GitHub Actions CI (a few minutes on this repo) will not
 * finish inside a single webhook-handling invocation.
 *
 * This is detection, not prevention: the Checks API cannot block alias
 * assignment on this project's plan (see vercel-api.ts). A dirty-tree or
 * untraceable production deployment emails the operator right away; a
 * deployment with GitHub Actions checks in progress is polled until they
 * resolve, and only a failure or timeout triggers the alarm. A clean,
 * fully green deployment produces no email at all.
 */

import { evaluateGate, type DeploymentMeta } from "./verify";
import { getDeploymentInfo } from "./vercel-api";
import { fetchCheckRuns } from "./github-status";
import { sendDeployAlarm } from "./alarm";

const POLL_INTERVAL_MS = 15_000;
// Stays safely under the route's maxDuration = 300 (route.ts), leaving
// headroom for the initial signature verification, the final alarm send,
// and platform overhead around the function's own execution budget.
const MAX_WAIT_MS = 270_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reasonSummary(reason: string): string {
  switch (reason) {
    case "git_dirty":
      return "Rejected: the deployed build includes uncommitted changes not reviewed by CI.";
    case "no_git_source":
      return "Rejected: no traceable GitHub commit for this deployment.";
    case "no_check_runs":
      return "No GitHub Actions check runs found for this commit yet.";
    case "checks_pending":
      return "Waiting for GitHub Actions checks to complete.";
    case "checks_failed":
      return "Rejected: at least one required GitHub Actions check failed.";
    case "checks_green":
      return "All GitHub Actions checks passed for this exact commit.";
    default:
      return reason;
  }
}

export async function evaluateAndAlarm(deploymentId: string): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let lastKnownAlarmMeta = {};

  while (Date.now() < deadline) {
    const info = await getDeploymentInfo(deploymentId);
    if (!info) {
      await sendDeployAlarm(deploymentId, "deployment metadata unavailable", lastKnownAlarmMeta);
      return;
    }

    const meta: DeploymentMeta = {
      target: info.target,
      gitDirty: info.meta?.gitDirty,
      githubCommitSha: info.meta?.githubCommitSha,
      githubOrg: info.meta?.githubOrg,
      githubRepo: info.meta?.githubRepo,
    };
    const alarmMeta = {
      gitDirty: info.meta?.gitDirty,
      githubCommitSha: info.meta?.githubCommitSha,
      githubCommitRef: info.meta?.githubCommitRef,
      actor: info.meta?.actor,
    };
    lastKnownAlarmMeta = alarmMeta;

    // gitDirty / no_git_source are terminal, no amount of waiting resolves
    // them. These are exactly the two failure modes that reached production
    // twice on 2026-07-22, so they alarm immediately rather than waiting on
    // any poll cycle.
    if (meta.gitDirty === "1" || !meta.githubCommitSha) {
      const decision = evaluateGate(meta, null);
      await sendDeployAlarm(deploymentId, reasonSummary(decision.reason), alarmMeta);
      return;
    }

    const checkRuns = await fetchCheckRuns(meta.githubOrg!, meta.githubRepo!, meta.githubCommitSha!);
    const decision = evaluateGate(meta, checkRuns);

    if (decision.reason === "checks_pending" || decision.reason === "no_check_runs") {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (decision.pass) {
      // Clean deployment, all checks green: no email.
      return;
    }

    await sendDeployAlarm(deploymentId, reasonSummary(decision.reason), alarmMeta);
    return;
  }

  await sendDeployAlarm(
    deploymentId,
    `timed out waiting for GitHub checks (${Math.round(MAX_WAIT_MS / 60_000)} minutes)`,
    lastKnownAlarmMeta,
  );
}
