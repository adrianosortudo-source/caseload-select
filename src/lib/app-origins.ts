import type { PortalRole } from "@/lib/portal-auth";

const DEFAULT_APP_DOMAIN = "caseloadselect.ca";
const LOCAL_ORIGIN = "http://localhost:3000";

function appDomain(): string {
  return configuredAppDomain() ?? DEFAULT_APP_DOMAIN;
}

function configuredAppDomain(): string | null {
  return process.env.NEXT_PUBLIC_APP_DOMAIN?.trim().toLowerCase() || null;
}

function deploymentOrigin(): string | null {
  const vercelUrl = process.env.VERCEL_URL?.trim();
  return vercelUrl ? `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : null;
}

function previewOrigin(): string | null {
  return process.env.VERCEL_ENV === "preview" ? deploymentOrigin() : null;
}

function canonicalOrigin(subdomain: "app" | "admin"): string | null {
  const domain = configuredAppDomain();
  return domain ? `https://${subdomain}.${domain}` : null;
}

/** Public/lawyer/client application origin for links and cross-origin redirects. */
export function appOrigin(): string {
  return previewOrigin()
    ?? canonicalOrigin("app")
    ?? deploymentOrigin()
    ?? LOCAL_ORIGIN;
}

/** Dedicated operator-console origin. Preview and local builds stay single-origin. */
export function operatorOrigin(): string {
  return previewOrigin()
    ?? canonicalOrigin("admin")
    ?? deploymentOrigin()
    ?? LOCAL_ORIGIN;
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

export function isAppHost(hostname: string): boolean {
  return normalizeHostname(hostname) === `app.${appDomain()}`;
}

/** Hosts where app and operator surfaces intentionally remain on one origin. */
export function isLocalOrPreviewHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  const isLocal = normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "[::1]";
  if (isLocal) return true;

  // A *.vercel.app hostname is a single-origin exception only on a real
  // Vercel preview deployment. Production aliases must use the canonical
  // app/admin split, otherwise an arbitrary production alias could bypass the
  // host-only operator-session boundary.
  return process.env.VERCEL_ENV === "preview"
    && normalized.endsWith(".vercel.app");
}

const LEGACY_OPERATOR_ROOTS = [
  "/analytics",
  "/conflict-register",
  "/domains",
  "/firms",
  "/leads",
  "/onboarding",
  "/pipeline",
  "/reviews",
  "/sequences",
  "/settings",
] as const;

function isPathAtOrBelow(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

/** Browser-navigation surfaces that belong on the dedicated operator origin. */
export function isOperatorUiPath(pathname: string): boolean {
  return isPathAtOrBelow(pathname, "/admin")
    || isPathAtOrBelow(pathname, "/operator")
    || LEGACY_OPERATOR_ROOTS.some((root) => isPathAtOrBelow(pathname, root));
}
