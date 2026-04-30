/**
 * /widget-v3/[firmId]  -  Chat-style intake widget.
 *
 * Embeds on a law firm's website as an iframe. The CaseLoad Screen engine
 * runs behind it via /api/screen. Firm branding (color, name, assistant
 * name, practice areas, booking URL) is loaded server-side.
 *
 * Usage:
 *   <iframe src="https://app.caseloadselect.ca/widget-v3/YOUR_FIRM_ID"
 *           style="border:none;width:400px;height:600px;" />
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { ChatWidget } from "./ChatWidget";

interface PageProps {
  params: Promise<{ firmId: string }>;
}

export interface FirmBranding {
  firmId: string;
  firmName: string;
  primaryColor: string;
  assistantName: string;
  bookingUrl: string | null;
  practiceAreas: Array<{ id: string; label: string; classification: string }>;
}

export default async function WidgetV3Page({ params }: PageProps) {
  const { firmId } = await params;

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("name, branding, practice_areas")
    .eq("id", firmId)
    .single();

  if (!firm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F3EF]">
        <p className="text-sm text-black/40" style={{ fontFamily: "DM Sans, sans-serif" }}>
          Intake not available.
        </p>
      </div>
    );
  }

  const branding = (firm.branding as Record<string, string | undefined>) ?? {};
  const practiceAreas = (firm.practice_areas as Array<{ id: string; label: string; classification: string }>) ?? [];

  const config: FirmBranding = {
    firmId,
    firmName: (firm.name as string) ?? "Law Firm",
    primaryColor: branding.primary_color ?? "#1E2F58",
    assistantName: branding.assistant_name ?? "Intake Assistant",
    bookingUrl: branding.booking_url ?? null,
    practiceAreas: practiceAreas.filter(a => a.classification !== "out_of_scope"),
  };

  return <ChatWidget config={config} />;
}
