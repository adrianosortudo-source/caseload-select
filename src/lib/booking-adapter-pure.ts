/**
 * Pure booking-adapter config resolution (WP-6, CaseLoad_CRM_Migration_Plan_v1.md
 * §6 target architecture: "Rails as adapters: one interface per channel...
 * with point-API implementations"). This is the booking rail's adapter shape.
 *
 * Cal.com decision locked 2026-06-25 (plan §10): SaaS, not self-host. Account
 * creation and calendar setup are operator work (see docs/booking-setup-runbook.md);
 * this module only resolves the config a firm already has on file into a
 * renderable state. No network calls, no Cal.com API client: the public
 * booking page embeds Cal.com's own hosted booking widget by URL, so there
 * is nothing to call server-side.
 */

export type BookingProvider = 'cal_com';

export interface BookingConfig {
  provider?: BookingProvider;
  url?: string; // e.g. https://cal.com/drg-law/consult
}

export type ResolvedBooking =
  | { configured: true; provider: BookingProvider; url: string }
  | { configured: false };

/**
 * Resolves a firm's raw booking_config jsonb into a renderable state.
 * Fails closed to "not configured" on any malformed or partial config
 * (missing url, unknown provider, non-object input) rather than guessing.
 */
export function resolveBookingConfig(raw: unknown): ResolvedBooking {
  if (!raw || typeof raw !== 'object') return { configured: false };
  const cfg = raw as BookingConfig;
  if (cfg.provider !== 'cal_com') return { configured: false };
  if (!cfg.url || typeof cfg.url !== 'string') return { configured: false };
  if (!isHttpsUrl(cfg.url)) return { configured: false };
  return { configured: true, provider: 'cal_com', url: cfg.url };
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
