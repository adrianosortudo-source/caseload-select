/**
 * /widget-v2/demo/[firmId] — split-screen demo.
 *
 * Left: the real public intake renderer running against an in-browser fixture.
 * Right: a read-only firm-review brief derived from the same engine state.
 *
 * Used for sales demos: walk a prospect (or a partner-firm decision-maker)
 * through the intake while the review brief updates beside it. Demo mode
 * disables transcription, checkpoints, persistence, and contact delivery.
 *
 * On mobile, panels stack vertically (widget on top, scoring panel below).
 * On desktop, side-by-side 60/40 split (widget gets the larger half).
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { DemoSplitClient } from "./DemoSplitClient";
import { DRG_WIDGET_THEME, themeToCssVars } from "@/lib/widget-theme";

interface PageProps {
  params: Promise<{ firmId: string }>;
}

export default async function DemoSplitPage({ params }: PageProps) {
  const { firmId } = await params;

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("name")
    .eq("id", firmId)
    .single();

  if (!firm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F3EF]">
        <p className="text-[14px] text-[#1E2F58]/60" style={{ fontFamily: "DM Sans, sans-serif" }}>
          Firm not found.
        </p>
      </div>
    );
  }

  const displayName = (firm.name as string).replace(/\s+Test$/i, "");

  return (
    <div style={themeToCssVars(DRG_WIDGET_THEME)}>
      <DemoSplitClient
        firmId={firmId}
        firmName={displayName}
        consentCaptureEnabled
      />
    </div>
  );
}
