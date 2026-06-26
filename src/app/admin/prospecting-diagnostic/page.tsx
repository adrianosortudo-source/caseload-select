/**
 * /admin/prospecting-diagnostic
 *
 * Internal operator workflow that turns the SEO & AI Visibility Check into a
 * sales-ready prospecting diagnostic. It reuses the existing /api/tools/seo-check
 * engine as the technical scan, then translates the raw findings into the
 * CaseLoad Select ACTS framework (Authority, Capture, Target, Screen) with
 * outreach hooks, strategic call questions, a 30/60/90 plan, a cold email
 * draft, and a JSON export for the downstream PDF diagnostic builder.
 *
 * Auth: getOperatorSession() in /admin/layout.tsx. The client component calls
 * /api/tools/seo-check with the operator session cookie attached, so the API
 * returns operator mode (scan depth + the internal prospecting summary).
 */

import ProspectingDiagnosticTool from "./_components/ProspectingDiagnosticTool";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default function AdminProspectingDiagnosticPage() {
  return (
    <div>
      <PageHeader
        title="Prospecting diagnostic"
        subtitle="Run a firm through the SEO and AI Visibility engine, then read the result back as a sales narrative. The technical findings translate into the ACTS framework, with outreach hooks, strategic call questions, a 30/60/90 plan, a cold email draft, and a JSON export for the diagnostic PDF builder. The SEO grade stays internal; the output speaks in business terms."
      />

      <ProspectingDiagnosticTool />
    </div>
  );
}
