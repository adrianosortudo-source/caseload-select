/**
 * Background resolution loop for a single deployment's gate check.
 * Runs inside waitUntil() after the webhook handler has already ACKed
 * Vercel, since GitHub Actions CI (a few minutes on this repo) will not
 * finish inside a single webhook-handling invocation.
 */

import { evaluateGate, type DeploymentMeta } from "./verify";
import { getDeploymentInfo, resolveDeploymentCheck } from "./vercel-api";
import { fetchCheckRuns } from "./github-status";

const POLL_INTERVAL_MS = 15_000;
const MAX_WAIT_MS = 8 * 60_000;
const CHECK_NAME = "Production deploy gate";

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

export async function resolveDeployGate(deploymentId: string, checkId: string): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const info = await getDeploymentInfo(deploymentId);
    if (!info) {
      await resolveDeploymentCheck(deploymentId, checkId, "failed", "Could not re-fetch deployment metadata.");
      return;
    }

    const meta: DeploymentMeta = {
      target: info.target,
      gitDirty: info.meta?.gitDirty,
      githubCommitSha: info.meta?.githubCommitSha,
      githubOrg: info.meta?.githubOrg,
      githubRepo: info.meta?.githubRepo,
    };

    // gitDirty / no_git_source are terminal — no amount of waiting resolves them.
    if (meta.gitDirty === "1" || !meta.githubCommitSha) {
      const decision = evaluateGate(meta, null);
      await resolveDeploymentCheck(deploymentId, checkId, "failed", reasonSummary(decision.reason));
      return;
    }

    const checkRuns = await fetchCheckRuns(meta.githubOrg!, meta.githubRepo!, meta.githubCommitSha!);
    const decision = evaluateGate(meta, checkRuns);

    if (decision.reason === "checks_pending" || decision.reason === "no_check_runs") {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    await resolveDeploymentCheck(
      deploymentId,
      checkId,
      decision.pass ? "succeeded" : "failed",
      reasonSummary(decision.reason),
    );
    return;
  }

  await resolveDeploymentCheck(
    deploymentId,
    checkId,
    "failed",
    `Timed out after ${MAX_WAIT_MS / 60_000} minutes waiting for GitHub Actions checks. Rerun this check once CI completes.`,
  );
}

export { CHECK_NAME };
