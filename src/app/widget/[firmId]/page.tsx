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
 */

import { supabase } from "@/lib/supabase";
import { IntakeWidget } from "@/components/intake/IntakeWidget";

interface PageProps {
  params: Promise<{ firmId: string }>;
}

export default async function WidgetPage({ params }: PageProps) {
  const { firmId } = await params;

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

  return (
    <div className="min-h-screen flex items-start justify-center bg-gray-50 p-4 pt-10">
      <IntakeWidget
        firmId={firmId}
        firmName={firm.name}
        accentColor={accentColor}
      />
    </div>
  );
}
