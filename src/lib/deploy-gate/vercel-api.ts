/**
 * Vercel API client for the production deployment gate.
 *
 * Reuses the same VERCEL_API_TOKEN / VERCEL_TEAM_ID env vars already live
 * in this project for vercel-domains.ts (S9 custom domains); no new secret
 * beyond VERCEL_WEBHOOK_SECRET (signature verification for the incoming
 * deployment.created webhook) is required.
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
    githubOrg?: string;
    githubRepo?: string;
  };
}

export async function getDeploymentInfo(deploymentId: string): Promise<VercelDeploymentInfo | null> {
  const res = await fetch(`${BASE}/v13/deployments/${deploymentId}${teamParam()}`, { headers: headers() });
  if (!res.ok) return null;
  const data = (await res.json()) as VercelDeploymentInfo;
  return data;
}

export async function createDeploymentCheck(deploymentId: string, name: string): Promise<string | null> {
  const res = await fetch(`${BASE}/v1/deployments/${deploymentId}/checks${teamParam()}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name, blocking: true, status: "running", rerequestable: true }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function resolveDeploymentCheck(
  deploymentId: string,
  checkId: string,
  conclusion: "succeeded" | "failed" | "canceled",
  summary: string,
): Promise<void> {
  await fetch(`${BASE}/v1/deployments/${deploymentId}/checks/${checkId}${teamParam()}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({
      status: "completed",
      conclusion,
      output: { summary },
    }),
  });
}
