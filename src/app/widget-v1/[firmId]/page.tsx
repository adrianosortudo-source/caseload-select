/**
 * /widget-v1/[firmId]  -  LEGACY widget (preserved as fallback after v2 cutover).
 *
 * The original 5-step IntakeWidget. Kept available so any iframe embed that
 * needs to fall back to v1 (broken v2 release, customer-specific issue, etc.)
 * can do so without a code revert.
 *
 * Production traffic now lands on /widget/[firmId] (v2 as of April 2026).
 * Do not embed this v1 route in new firm onboardings; use /widget/[firmId].
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
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
