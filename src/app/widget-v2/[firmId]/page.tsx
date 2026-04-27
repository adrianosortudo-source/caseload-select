/**
 * /widget-v2/[firmId] — new web-channel renderer for the CaseLoad Screen engine.
 *
 * Side-by-side with /widget/[firmId] (current production widget). Once v2 is
 * proven, /widget/[firmId] can be swapped to use IntakeControllerV2 and this
 * route can be retired.
 *
 * Loads minimal firm config (name) from Supabase, then mounts IntakeControllerV2.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { IntakeControllerV2 } from "@/components/intake-v2/IntakeControllerV2";

interface PageProps {
  params: Promise<{ firmId: string }>;
}

export default async function WidgetV2Page({ params }: PageProps) {
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

  return <IntakeControllerV2 firmId={firmId} firmName={firm.name as string} />;
}
