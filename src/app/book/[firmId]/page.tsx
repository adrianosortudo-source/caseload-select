/**
 * /book/[firmId]  -  Public per-firm booking page (WP-6, dormant booking
 * adapter). CaseLoad_CRM_Migration_Plan_v1.md §6 target architecture:
 * "Rails as adapters... point-API implementations (Cal.com, ...)".
 *
 * Cal.com decision locked 2026-06-25: SaaS, not self-host (plan §10).
 * Account creation and calendar configuration are operator work
 * (docs/booking-setup-runbook.md); this route only renders whatever
 * booking_config a firm already has on file.
 *
 * Server component, public (no auth): mirrors /widget/[firmId]'s pattern of
 * a service-role read for a public-facing per-firm surface. Not the CTA on
 * any intake form (per the app CLAUDE.md doctrine, the Screen IS the contact
 * path); this is a secondary, post-intake booking option, same posture as
 * DRG's existing /book page (intake-first, booking-second).
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { resolveBookingConfig } from '@/lib/booking-adapter-pure';

interface PageProps {
  params: Promise<{ firmId: string }>;
}

export default async function BookingPage({ params }: PageProps) {
  const { firmId } = await params;

  const { data: firm } = await supabase
    .from('intake_firms')
    .select('name, booking_config, branding')
    .eq('id', firmId)
    .maybeSingle();

  if (!firm) {
    return (
      <main style={containerStyle}>
        <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)' }}>This booking page could not be found.</p>
      </main>
    );
  }

  const firmName = (firm.branding as { firm_name?: string } | null)?.firm_name ?? firm.name ?? 'the firm';
  const booking = resolveBookingConfig(firm.booking_config);

  if (!booking.configured) {
    return (
      <main style={containerStyle}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E2F58' }}>Booking is not set up yet</h1>
        <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.6)', marginTop: 8 }}>
          {firmName} has not configured online booking. Reach out directly to schedule a time.
        </p>
      </main>
    );
  }

  return (
    <main style={{ ...containerStyle, padding: 0, maxWidth: '100%' }}>
      <iframe
        src={booking.url}
        title={`Book a time with ${firmName}`}
        style={{ width: '100%', height: '100vh', border: 'none' }}
      />
    </main>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  maxWidth: 480,
  margin: '0 auto',
  padding: '48px 20px',
  fontFamily: 'DM Sans, sans-serif',
};
