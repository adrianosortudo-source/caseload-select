import { notFound } from "next/navigation";
import ReconciledProspects from "@/app/admin/prospects/ReconciledProspects";
import { RECONCILED_GTA_PROSPECTS } from "@/app/admin/prospects/reconciled-prospects";
import { mergeQualifiedProspects } from "@/lib/qualified-gta-prospects";
import QualifiedProspectAuditPage from "@/app/admin/prospects/audits/[firmId]/page";

export const dynamic = "force-dynamic";

export default async function ProspectQualifiedPreviewPage({ searchParams }: { searchParams: Promise<{ audit?: string }> }) {
  if (process.env.PROSPECT_QUALIFICATION_PREVIEW !== "1") return notFound();
  const { audit } = await searchParams;
  if (audit) {
    return <main className="min-h-screen bg-parchment p-4 sm:p-6">{await QualifiedProspectAuditPage({ params: Promise.resolve({ firmId: audit }) })}</main>;
  }
  const merged = mergeQualifiedProspects(RECONCILED_GTA_PROSPECTS);
  const records = merged.records.map((record, index) => index === 0 ? {
    ...record,
    publicContacts: [
      {
        name: "Avery Founder",
        relationship: "founder" as const,
        email: null,
        emailKind: "owner" as const,
        sourceUrl: "https://example.test/team",
        observedAt: "2026-09-09",
      },
      {
        name: "Sam Lawyer",
        relationship: "named_lawyer" as const,
        email: "sam@example.test",
        emailKind: "named_person" as const,
        sourceUrl: "https://example.test/sam",
        observedAt: "2026-09-08",
      },
      {
        name: null,
        relationship: "firm_inbox" as const,
        email: "hello@example.test",
        emailKind: "general_firm" as const,
        sourceUrl: "https://example.test/contact",
        observedAt: "2026-09-07",
      },
    ],
  } : record);
  return (
    <main className="min-h-screen bg-parchment p-4 sm:p-6">
      <ReconciledProspects initialData={{
        records,
        source: "fixture",
        sourceCounts: { ledger: 0, fixture: RECONCILED_GTA_PROSPECTS.length },
        qualifiedImport: merged.report,
        fallbackReason: "ledger_empty",
      }} />
    </main>
  );
}
