/**
 * /widget-v2/demo/[firmId] — split-screen demo.
 *
 * Left half: the IntakeControllerV2 (prospect's view).
 * Right half: LiveScoringPanel showing engine state in real time.
 *
 * Used for sales demos: walk a prospect (or a partner-firm decision-maker)
 * through the intake on the left while showing the AI's scoring decisions
 * updating live on the right. Demonstrates the AI's value in a way a static
 * pitch cannot.
 *
 * On mobile, panels stack vertically (widget on top, scoring panel below).
 * On desktop, side-by-side 60/40 split (widget gets the larger half).
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { DemoSplitClient } from "./DemoSplitClient";

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

  return <DemoSplitClient firmId={firmId} firmName={firm.name as string} />;
}
