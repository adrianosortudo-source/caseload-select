/**
 * @deprecated Removed from scope on 2026-05-06. Do not link to from new pages.
 *
 * S6 (retainer automation via DocuGenerate + DocuSeal) was permanently
 * removed from the project. The retainer document workflow is lawyer-owned.
 * See master CLAUDE.md "Build Roadmap" and CRM Bible v5.1 DR-032.
 *
 * This page is dormant. The `retainer_agreements` table is no longer being
 * written to from new sessions. Existing rows (if any) will display, but
 * the tracker itself should be removed in a follow-up cleanup.
 *
 * --------------------------------------------------------------------
 * ORIGINAL DESCRIPTION (HISTORICAL):
 *
 * /retainers
 *
 * Retainer agreements tracker. Shows all retainer_agreements across firms,
 * filterable by status. Lets Adriano see what's outstanding at a glance.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type RetainerRow = {
  id: string;
  firm_id: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  docuseal_signing_url: string | null;
  status: string;
  generated_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  voided_at: string | null;
  created_at: string;
  intake_firms: { name: string } | null;
};

const STATUS_ORDER = ["sent", "viewed", "generated", "pending", "signed", "voided"];

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending:   "bg-black/5 text-black/40",
    generated: "bg-sky-50 text-sky-700",
    sent:      "bg-blue-50 text-blue-700",
    viewed:    "bg-amber-50 text-amber-700",
    signed:    "bg-emerald-50 text-emerald-700",
    voided:    "bg-rose-50 text-rose-700",
  };
  return (
    <span className={`badge capitalize ${map[status] ?? "bg-black/5 text-black/40"}`}>
      {status}
    </span>
  );
}

function fmtDate(d: string | null) {
  if (!d) return <span className="text-black/20"> - </span>;
  return <span>{new Date(d).toLocaleDateString("en-CA")}</span>;
}

function lastEvent(row: RetainerRow): string {
  if (row.signed_at) return `Signed ${new Date(row.signed_at).toLocaleDateString("en-CA")}`;
  if (row.viewed_at) return `Viewed ${new Date(row.viewed_at).toLocaleDateString("en-CA")}`;
  if (row.sent_at)   return `Sent ${new Date(row.sent_at).toLocaleDateString("en-CA")}`;
  if (row.generated_at) return `Generated ${new Date(row.generated_at).toLocaleDateString("en-CA")}`;
  return `Created ${new Date(row.created_at).toLocaleDateString("en-CA")}`;
}

export default async function RetainersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: filterStatus } = await searchParams;

  let query = supabase
    .from("retainer_agreements")
    .select("*, intake_firms(name)")
    .order("created_at", { ascending: false });

  if (filterStatus && filterStatus !== "all") {
    query = query.eq("status", filterStatus);
  }

  const { data: retainers } = await query;
  const rows = (retainers ?? []) as unknown as RetainerRow[];

  // Status counts for filter tabs
  const { data: allRows } = await supabase
    .from("retainer_agreements")
    .select("status");

  const counts: Record<string, number> = { all: allRows?.length ?? 0 };
  for (const r of allRows ?? []) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  const active = filterStatus ?? "all";

  const tabs = [
    { key: "all",       label: "All" },
    { key: "sent",      label: "Awaiting Signature" },
    { key: "viewed",    label: "Viewed" },
    { key: "signed",    label: "Signed" },
    { key: "generated", label: "Generated" },
    { key: "voided",    label: "Voided" },
  ];

  return (
    <div className="p-8 max-w-6xl space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Retainer Agreements</h1>
        <p className="text-sm text-black/50 mt-1">
          {counts.all} agreement{counts.all !== 1 ? "s" : ""} total
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map((tab) => (
          <a
            key={tab.key}
            href={tab.key === "all" ? "/retainers" : `/retainers?status=${tab.key}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              active === tab.key
                ? "bg-navy text-white"
                : "bg-black/5 text-black/60 hover:bg-black/8"
            }`}
          >
            {tab.label}
            {counts[tab.key] != null && (
              <span className={`ml-1.5 ${active === tab.key ? "text-white/60" : "text-black/30"}`}>
                {counts[tab.key]}
              </span>
            )}
          </a>
        ))}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="card p-10 text-center text-black/40 text-sm">
          No retainer agreements{filterStatus && filterStatus !== "all" ? ` with status "${filterStatus}"` : ""} yet.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/8 bg-black/[0.02] text-xs text-black/50">
                <th className="text-left px-4 py-3 font-medium">Client</th>
                <th className="text-left px-4 py-3 font-medium">Firm</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Last event</th>
                <th className="text-left px-4 py-3 font-medium">Sent</th>
                <th className="text-left px-4 py-3 font-medium">Signed</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-black/[0.01]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-black/80">{row.contact_name}</div>
                    {row.contact_email && (
                      <div className="text-xs text-black/40 mt-0.5">{row.contact_email}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-black/60 text-xs">
                    {row.intake_firms?.name ?? " - "}
                  </td>
                  <td className="px-4 py-3">
                    {statusBadge(row.status)}
                  </td>
                  <td className="px-4 py-3 text-xs text-black/50">
                    {lastEvent(row)}
                  </td>
                  <td className="px-4 py-3 text-xs text-black/50">
                    {fmtDate(row.sent_at)}
                  </td>
                  <td className="px-4 py-3 text-xs text-black/50">
                    {fmtDate(row.signed_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.docuseal_signing_url && row.status !== "signed" && row.status !== "voided" && (
                      <a
                        href={row.docuseal_signing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gold hover:text-gold-2 font-medium"
                      >
                        View →
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
