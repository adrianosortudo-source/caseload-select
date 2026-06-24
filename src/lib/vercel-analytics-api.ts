/**
 * Vercel project status + deep links for the metrics dashboard.
 *
 * Vercel does not expose a public REST API for reading Web Analytics
 * or Speed Insights aggregate data. This client fetches deployment
 * status (latest production deploy) and builds deep links to the
 * Vercel dashboard where the operator can view full analytics.
 *
 * Env:  VERCEL_API_TOKEN, VERCEL_TEAM_ID  (already in codebase)
 */

const API_BASE = "https://api.vercel.com";

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function teamParam(): string {
  const id = process.env.VERCEL_TEAM_ID;
  return id ? `teamId=${id}` : "";
}

export function isVercelAvailable(): boolean {
  return !!process.env.VERCEL_API_TOKEN;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VercelDeployment {
  id: string;
  url: string;
  state: string;
  created: string;
  readyAt: string | null;
}

export interface VercelProjectStatus {
  configured: boolean;
  projectName: string | null;
  latestDeploy: VercelDeployment | null;
  deepLinks: {
    analytics: string;
    speedInsights: string;
    deployments: string;
  };
}

// ─── API ────────────────────────────────────────────────────────────────────

interface DeploymentApiItem {
  uid: string;
  url: string;
  state: string;
  created: number;
  ready?: number;
}

interface DeploymentsResponse {
  deployments?: DeploymentApiItem[];
}

interface ProjectResponse {
  name?: string;
}

export async function fetchVercelProjectStatus(
  projectId: string,
): Promise<VercelProjectStatus> {
  const empty: VercelProjectStatus = {
    configured: true,
    projectName: null,
    latestDeploy: null,
    deepLinks: {
      analytics: "",
      speedInsights: "",
      deployments: "",
    },
  };

  if (!isVercelAvailable()) return { ...empty, configured: false };

  const tp = teamParam();
  const sep = tp ? "&" : "";

  const [projectRes, deploysRes] = await Promise.all([
    fetch(`${API_BASE}/v9/projects/${projectId}?${tp}`, { headers: headers() }),
    fetch(
      `${API_BASE}/v6/deployments?projectId=${projectId}&target=production&limit=1${sep}${tp}`,
      { headers: headers() },
    ),
  ]);

  let projectName: string | null = null;
  if (projectRes.ok) {
    const p = (await projectRes.json()) as ProjectResponse;
    projectName = p.name ?? null;
  }

  let latestDeploy: VercelDeployment | null = null;
  if (deploysRes.ok) {
    const d = (await deploysRes.json()) as DeploymentsResponse;
    const first = d.deployments?.[0];
    if (first) {
      latestDeploy = {
        id: first.uid,
        url: first.url,
        state: first.state,
        created: new Date(first.created).toISOString(),
        readyAt: first.ready ? new Date(first.ready).toISOString() : null,
      };
    }
  }

  const teamSlug = process.env.VERCEL_TEAM_SLUG ?? "";
  const dashBase = teamSlug
    ? `https://vercel.com/${teamSlug}/${projectName ?? projectId}`
    : `https://vercel.com/~/projects/${projectId}`;

  return {
    configured: true,
    projectName,
    latestDeploy,
    deepLinks: {
      analytics: `${dashBase}/analytics`,
      speedInsights: `${dashBase}/speed-insights`,
      deployments: `${dashBase}/deployments`,
    },
  };
}
