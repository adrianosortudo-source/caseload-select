/**
 * /widget/[firmId] — Standalone embeddable intake widget page.
 *
 * Usage:
 *   <iframe src="https://your-domain.com/widget/YOUR_FIRM_ID" />
 *
 * Or link directly for full-page use:
 *   https://your-domain.com/widget/YOUR_FIRM_ID
 *
 * Firm config (name, accent color) is loaded server-side from Supabase.
 * The client-side widget only receives cosmetic props + firmId.
 *
 * Demo mode (used by /demo scenario launcher):
 *   /widget/FIRM_ID?demo=true&scenario=pi_strong&firm=Acme+Law
 *   Passes demoScenario + demoMode to IntakeWidget.
 *   Widget auto-sends the pre-loaded scenario message on mount and
 *   skips OTP. GHL delivery is suppressed server-side via demo=true
 *   flag on /api/screen requests.
 */

import { supabase } from "@/lib/supabase";
import { IntakeWidget } from "@/components/intake/IntakeWidget";

interface PageProps {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ scenario?: string; firm?: string; demo?: string }>;
}

export default async function WidgetPage({ params, searchParams }: PageProps) {
  const { firmId } = await params;
  const { scenario, firm: firmNameOverride, demo } = await searchParams;

  // Load minimal firm config for cosmetics (name + branding)
  const { data: firm } = await supabase
    .from("intake_firms")
    .select("name, branding")
    .eq("id", firmId)
    .single();

  if (!firm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Firm not found.</p>
      </div>
    );
  }

  const branding = (firm.branding ?? {}) as { accent_color?: string; firm_description?: string };
  const accentColor = branding.accent_color ?? "#1a3a5c";

  // In demo mode, allow the scenario launcher to override the displayed firm name
  const firmName = (demo === "true" && firmNameOverride)
    ? decodeURIComponent(firmNameOverride)
    : firm.name;

  return (
    <div className="min-h-screen flex items-start justify-center bg-gray-50 p-4 pt-10">
      <IntakeWidget
        firmId={firmId}
        firmName={firmName}
        accentColor={accentColor}
        demoMode={demo === "true"}
        demoScenario={demo === "true" ? scenario : undefined}
      />
    </div>
  );
}
