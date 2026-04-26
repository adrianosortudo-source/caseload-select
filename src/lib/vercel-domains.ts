/**
 * Vercel API client for custom domain management.
 *
 * Required env vars:
 *   VERCEL_API_TOKEN    -  Personal access token from vercel.com/account/tokens
 *   VERCEL_PROJECT_ID   -  Project ID (prj_YmLWBg4YkJs9KuShlrv5VQI6eLyF)
 *   VERCEL_TEAM_ID      -  Team ID (team_qS5LzYPKszR4AeCUSHXi9yW3)  -  optional for personal accounts
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

function projectUrl(path: string): string {
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!projectId) throw new Error("VERCEL_PROJECT_ID not set");
  const team = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  return `${BASE}/v10/projects/${projectId}/domains${path}${team}`;
}

export interface DomainStatus {
  name: string;
  verified: boolean;
  cname_record: string | null;
  error: string | null;
}

export async function addVercelDomain(domain: string): Promise<DomainStatus> {
  const res = await fetch(projectUrl(""), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name: domain }),
  });
  const data = await res.json() as {
    name: string;
    verified: boolean;
    verification?: Array<{ type: string; value: string }>;
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);
  const cname = data.verification?.find((v) => v.type === "CNAME")?.value ?? "cname.vercel-dns.com";
  return { name: data.name, verified: data.verified, cname_record: cname, error: null };
}

export async function removeVercelDomain(domain: string): Promise<void> {
  const teamParam = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  const projectId = process.env.VERCEL_PROJECT_ID;
  await fetch(`${BASE}/v9/projects/${projectId}/domains/${domain}${teamParam}`, {
    method: "DELETE",
    headers: headers(),
  });
}

export async function getVercelDomainStatus(domain: string): Promise<DomainStatus> {
  const res = await fetch(projectUrl(`/${domain}`), { headers: headers() });
  const data = await res.json() as {
    name: string;
    verified: boolean;
    verification?: Array<{ type: string; value: string }>;
    error?: { message: string };
  };
  if (data.error) return { name: domain, verified: false, cname_record: null, error: data.error.message };
  const cname = data.verification?.find((v) => v.type === "CNAME")?.value ?? "cname.vercel-dns.com";
  return { name: data.name, verified: data.verified, cname_record: cname, error: null };
}
