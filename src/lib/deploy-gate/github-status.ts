/**
 * Fetches GitHub Actions check-run results for a commit. This repo is
 * public, so unauthenticated reads work; scoping the gate to production-
 * target deployments only (a handful per day, not every preview) keeps
 * this comfortably inside the unauthenticated rate limit.
 */

import type { CheckRunResult } from "./verify";

interface GithubCheckRunsResponse {
  check_runs: Array<{
    status: "queued" | "in_progress" | "completed";
    conclusion: string | null;
  }>;
}

export async function fetchCheckRuns(owner: string, repo: string, sha: string): Promise<CheckRunResult[] | null> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as GithubCheckRunsResponse;
  if (!data.check_runs || data.check_runs.length === 0) return null;
  return data.check_runs.map((run) => ({
    completed: run.status === "completed",
    success: run.conclusion === "success" || run.conclusion === "neutral" || run.conclusion === "skipped",
  }));
}
