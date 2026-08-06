// Content Performance -- reporting layer (Phase 4). Operator-only, firm
// picked via ?firm_id=. A modest, truthful report for a date range: not
// a generic dashboard. Client component drives the date-range picker
// against /api/admin/content-performance/report.

import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import ContentAttributionReportView from "@/components/admin/ContentAttributionReportView";

export const dynamic = "force-dynamic";

type Firm = { id: string; name: string | null };

export default async function ContentPerformanceReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const firmId = typeof sp.firm_id === "string" ? sp.firm_id : null;

  const { data: firmsData } = await supabase.from("intake_firms").select("id,name").order("name");
  const firms = (firmsData ?? []) as Firm[];
  const selected = firmId
    ? (firms.find((f) => f.id === firmId) ?? null)
    : firms.length === 1
      ? firms[0]
      : null;

  if (!selected) {
    return (
      <div>
        <PageHeader title="Content Performance Report" subtitle="Select a firm." />
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {firms.map((firm) => (
            <Link
              key={firm.id}
              href={`/admin/content-studio/attribution/report?firm_id=${firm.id}`}
              className="rounded border border-black/8 bg-white p-6 hover:border-sky-300 hover:bg-sky-50/30 transition-colors"
            >
              <div className="font-medium text-sm text-black/80">{firm.name ?? "Unnamed firm"}</div>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Content Performance Report" subtitle={selected.name ?? "Unknown firm"} />
      <div className="mt-6">
        <ContentAttributionReportView firmId={selected.id} />
      </div>
    </div>
  );
}
