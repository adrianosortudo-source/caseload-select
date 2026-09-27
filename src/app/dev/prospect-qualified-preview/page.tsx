import { notFound } from "next/navigation";
import ReconciledProspects from "@/app/admin/prospects/ReconciledProspects";
import SupplementalEvidenceImport from "@/app/admin/prospects/SupplementalEvidenceImport";
import { RECONCILED_GTA_PROSPECTS } from "@/app/admin/prospects/reconciled-prospects";
import { mergeQualifiedProspects } from "@/lib/qualified-gta-prospects";
import QualifiedProspectAuditPage from "@/app/admin/prospects/audits/[firmId]/page";

import { SYNTHETIC_SUPPLEMENTAL_GBP_PROSPECTS, SYNTHETIC_SAME_NAME_UNLINKED, SYNTHETIC_ZAREI_PROFILE_LINK } from "./synthetic-supplemental";

export const dynamic = "force-dynamic";

export default async function ProspectQualifiedPreviewPage({ searchParams }: { searchParams: Promise<{ audit?: string; supplementalGbp?: string; zareiProfile?: string }> }) {
  if (process.env.PROSPECT_QUALIFICATION_PREVIEW !== "1") return notFound();
  const { audit, supplementalGbp, zareiProfile } = await searchParams;
  if (supplementalGbp === "1") return <main className="min-h-screen bg-parchment p-4 sm:p-6"><ReconciledProspects initialData={{ records: SYNTHETIC_SUPPLEMENTAL_GBP_PROSPECTS, source: "fixture" }} /></main>;
  if (zareiProfile === "1") return <main className="min-h-screen bg-parchment p-4 sm:p-6"><ReconciledProspects initialData={{ records: [SYNTHETIC_ZAREI_PROFILE_LINK, SYNTHETIC_SAME_NAME_UNLINKED], source: "fixture" }} /></main>;
  if (audit) {
    return <main className="min-h-screen bg-parchment p-4 sm:p-6">{await QualifiedProspectAuditPage({ params: Promise.resolve({ firmId: audit }) })}</main>;
  }
  const merged = mergeQualifiedProspects(RECONCILED_GTA_PROSPECTS);
  return (
    <main className="min-h-screen bg-parchment p-4 sm:p-6 space-y-4">
      <SupplementalEvidenceImport />
      <ReconciledProspects initialData={{
        records: merged.records,
        source: "fixture",
        sourceCounts: { ledger: 0, fixture: RECONCILED_GTA_PROSPECTS.length },
        qualifiedImport: merged.report,
        fallbackReason: "ledger_empty",
      }} />
    </main>
  );
}
