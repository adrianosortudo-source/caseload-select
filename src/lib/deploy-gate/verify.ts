/**
 * Pure decision logic for the production deployment gate (issue #61).
 *
 * A direct `vercel --prod` from a dirty working tree can serve production
 * traffic without ever going through GitHub Actions CI. This module decides,
 * from a deployment's own metadata plus its GitHub check-run results,
 * whether that deployment is allowed to receive the production alias.
 *
 * Fails closed on every ambiguous case: a dirty tree, a missing git source,
 * absent check runs, or unresolved checks are all treated as "not yet safe",
 * never as "presumably fine."
 */

export interface DeploymentMeta {
  target: string | null;
  gitDirty?: string;
  githubCommitSha?: string;
  githubOrg?: string;
  githubRepo?: string;
}

export interface CheckRunResult {
  completed: boolean;
  success: boolean;
}

export type GateReason =
  | "not_production"
  | "git_dirty"
  | "no_git_source"
  | "no_check_runs"
  | "checks_pending"
  | "checks_failed"
  | "checks_green";

export interface GateDecision {
  pass: boolean;
  reason: GateReason;
}

/** Only production-target deployments are gated; preview deploys are untouched. */
export function requiresGate(meta: DeploymentMeta): boolean {
  return meta.target === "production";
}

/**
 * A dirty-tree deploy can carry a githubCommitSha whose OWN history has
 * green CI, even though the actually-deployed content differs from what
 * CI tested. gitDirty is checked first and independently of check-run
 * results for exactly this reason: SHA-matched CI status is not proof
 * for a build with uncommitted changes layered on top.
 */
export function evaluateGate(meta: DeploymentMeta, checkRuns: CheckRunResult[] | null): GateDecision {
  if (!requiresGate(meta)) return { pass: true, reason: "not_production" };
  if (meta.gitDirty === "1") return { pass: false, reason: "git_dirty" };
  if (!meta.githubCommitSha || !meta.githubOrg || !meta.githubRepo) {
    return { pass: false, reason: "no_git_source" };
  }
  if (!checkRuns || checkRuns.length === 0) return { pass: false, reason: "no_check_runs" };
  if (!checkRuns.every((c) => c.completed)) return { pass: false, reason: "checks_pending" };
  if (!checkRuns.every((c) => c.success)) return { pass: false, reason: "checks_failed" };
  return { pass: true, reason: "checks_green" };
}
