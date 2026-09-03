/** Edge-safe recovery gate primitives. This module intentionally avoids Node
 * APIs so middleware can protect SSR routes before their handlers execute. */
import { isOperatorUiPath } from '@/lib/app-origins';

export const PRIVACY_RECOVERY_ROUTE = '/api/internal/privacy-recovery';

export function isPrivacyRecoveryProtectedPath(pathname: string): boolean {
  if (pathname === PRIVACY_RECOVERY_ROUTE || pathname.startsWith('/_next/') || pathname === '/favicon.ico') return false;
  if (pathname.startsWith('/api/')) return true;
  // Keep every operator SSR surface aligned with the host-routing policy.
  // Portal is deliberately separate: it is PII-bearing but user-facing.
  return pathname === '/portal' || pathname.startsWith('/portal/') || isOperatorUiPath(pathname);
}

/** Accept object and REST-string serializations, never a bare state string. */
export function recoveryCircuitIsOpen(value: unknown): boolean {
  if (typeof value === 'string') {
    try { return recoveryCircuitIsOpen(JSON.parse(value)); } catch { return false; }
  }
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (value as { state?: unknown }).state === 'open';
}
