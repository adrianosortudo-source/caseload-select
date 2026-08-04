/**
 * Vercel API client for the production deployment alarm.
 *
 * Reuses the same VERCEL_API_TOKEN / VERCEL_TEAM_ID env vars already live
 * in this project for vercel-domains.ts (S9 custom domains).
 *
 * This module used to also create and resolve blocking Checks API entries
 * (POST/PATCH /v1/deployments/{id}/checks) so Vercel would refuse to alias
 * a production deployment without a green check. That path is a confirmed
 * dead end: the Checks API returns 403 invalidToken for a personal access
 * token, since check creation requires an integration OAuth token (see the
 * "Ensure you provide a valid OAuth2 access token" wording in Vercel's own
 * docs for that endpoint, distinct from the generic "Bearer token" wording
 * on every other endpoint). Confirmed live against this project 2026-07-22.
 * getDeploymentInfo is the only surviving export; it now feeds the email
 * alarm in alarm.ts instead of a blocking check.
 */

const BASE = "https://api.vercel.com";

function headers() {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error("VERCEL_API_TOKEN not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function teamParam(prefix: "?" | "&" = "?"): string {
  return process.env.VERCEL_TEAM_ID ? `${prefix}teamId=${process.env.VERCEL_TEAM_ID}` : "";
}

export interface VercelDeploymentInfo {
  id: string;
  target: string | null;
  meta: {
    gitDirty?: string;
    githubCommitSha?: string;
    githubCommitRef?: string;
    githubOrg?: string;
    githubRepo?: string;
    actor?: string;
  };
}

export async function getDeploymentInfo(deploymentId: string): Promise<VercelDeploymentInfo | null> {
  const res = await fetch(`${BASE}/v13/deployments/${deploymentId}${teamParam()}`, { headers: headers() });
  if (!res.ok) return null;
  const data = (await res.json()) as VercelDeploymentInfo;
  return data;
}
