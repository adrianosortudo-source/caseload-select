/** Edge-safe recovery gate primitives. This module intentionally avoids Node
 * APIs so middleware can protect SSR routes before their handlers execute. */
export const PRIVACY_RECOVERY_ROUTE = '/api/internal/privacy-recovery';
const OPERATIONAL_PREFIXES = ['/admin', '/analytics', '/portal', '/onboarding'];

export function isPrivacyRecoveryProtectedPath(pathname: string): boolean {
  if (pathname === PRIVACY_RECOVERY_ROUTE || pathname.startsWith('/_next/') || pathname === '/favicon.ico') return false;
  if (pathname.startsWith('/api/')) return true;
  return OPERATIONAL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Accept object and REST-string serializations, never a bare state string. */
export function recoveryCircuitIsOpen(value: unknown): boolean {
  if (typeof value === 'string') {
    try { return recoveryCircuitIsOpen(JSON.parse(value)); } catch { return false; }
  }
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (value as { state?: unknown }).state === 'open';
}
