import type { PortalRole } from "@/lib/portal-auth";

const DEFAULT_APP_DOMAIN = "caseloadselect.ca";
const LOCAL_ORIGIN = "http://localhost:3000";

function appDomain(): string {
  return process.env.NEXT_PUBLIC_APP_DOMAIN?.trim().toLowerCase() || DEFAULT_APP_DOMAIN;
}

function deploymentOrigin(): string | null {
  const vercelUrl = process.env.VERCEL_URL?.trim();
  return vercelUrl ? `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : null;
}

function previewOrigin(): string | null {
  return process.env.VERCEL_ENV === "preview" ? deploymentOrigin() : null;
}

function useLocalFallback(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.VERCEL_ENV;
}

/** Public/lawyer/client application origin for links and cross-origin redirects. */
export function appOrigin(): string {
  return previewOrigin()
    ?? (useLocalFallback() ? LOCAL_ORIGIN : `https://app.${appDomain()}`);
}

/** Dedicated operator-console origin. Preview and local builds stay single-origin. */
export function operatorOrigin(): string {
  return previewOrigin()
    ?? (useLocalFallback() ? LOCAL_ORIGIN : `https://admin.${appDomain()}`);
}

export function roleAwareOrigin(role: PortalRole): string {
  return role === "operator" ? operatorOrigin() : appOrigin();
}

function normalizeHostname(hostname: string): string {
  const value = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end >= 0 ? value.slice(0, end + 1) : value;
  }
  return value.split(":", 1)[0] ?? "";
}

export function isOperatorHost(hostname: string): boolean {
  return normalizeHostname(hostname) === `admin.${appDomain()}`;
}

/** Hosts where app and operator surfaces intentionally remain on one origin. */
export function isLocalOrPreviewHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "[::1]"
    || normalized.endsWith(".vercel.app");
}
