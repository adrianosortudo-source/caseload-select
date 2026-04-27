/**
 * /widget/[firmId]  -  PRODUCTION embeddable intake widget (v2).
 *
 * As of April 2026 this route serves IntakeControllerV2  -  the redesigned
 * card/chip/slider intake with the live scoring engine, prospect-perspective
 * classifier, and structured Round 3 banks.
 *
 * Usage:
 *   <iframe src="https://app.caseloadselect.ca/widget/YOUR_FIRM_ID" />
 *
 * Or link directly for full-page use:
 *   https://app.caseloadselect.ca/widget/YOUR_FIRM_ID
 *
 * Fallback to legacy widget (rare, only if v2 is broken for a specific firm):
 *   https://app.caseloadselect.ca/widget-v1/YOUR_FIRM_ID
 *
 * Demo / split-screen sales tool (operator + prospect side by side):
 *   https://app.caseloadselect.ca/widget-v2/demo/YOUR_FIRM_ID
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { IntakeControllerV2 } from "@/components/intake-v2/IntakeControllerV2";

interface PageProps {
  params: Promise<{ firmId: string }>;
}

export default async function WidgetPage({ params }: PageProps) {
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
