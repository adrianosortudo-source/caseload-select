/**
 * Fetches GitHub Actions check-run results for a commit. This repo is
 * public, so unauthenticated reads work at 60 requests/hour per IP; with
 * the poll window bounded to under 5 minutes (route.ts maxDuration) and
 * gated to production-target deployments only (a handful per day, not
 * every preview), that stays comfortably inside budget under normal
 * conditions.
 *
 * If a GITHUB_TOKEN env var is ever set, it is used automatically (public
 * repos need no scopes for read-only check-run access) and lifts the limit
 * to 5000/hour per token, sidestepping any risk from a shared Vercel
 * egress IP being independently rate-limited by other traffic. No token is
 * set today; this is a graceful upgrade path, not a requirement.
 */

import type { CheckRunResult } from "./verify";

interface GithubCheckRunsResponse {
  check_runs: Array<{
    status: "queued" | "in_progress" | "completed";
    conclusion: string | null;
  }>;
}

function headers(): Record<string, string> {
  const base: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN;
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

export async function fetchCheckRuns(owner: string, repo: string, sha: string): Promise<CheckRunResult[] | null> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`, {
    headers: headers(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as GithubCheckRunsResponse;
  if (!data.check_runs || data.check_runs.length === 0) return null;
  return data.check_runs.map((run) => ({
    completed: run.status === "completed",
    success: run.conclusion === "success" || run.conclusion === "neutral" || run.conclusion === "skipped",
  }));
}
