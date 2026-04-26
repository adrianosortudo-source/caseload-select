/**
 * /conflict-register
 *
 * Conflict register management UI. Shows all entries seeded from
 * client_won leads, CSV imports, and Clio syncs. Searchable by
 * name, email, phone, or matter type.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type ConflictRow = {
  id: string;
  law_firm_id: string | null;
  client_name: string;
  opposing_party: string | null;
  matter_type: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  clio_matter_id: string | null;
  created_at: string;
  law_firm_clients: { name: string } | null;
};

const SOURCE_LABELS: Record<string, string> = {
  caseload_select: "CaseLoad Select",
  csv_import:      "CSV Import",
  clio_sync:       "Clio Sync",
};

function sourceBadge(source: string) {
  const map: Record<string, string> = {
    caseload_select: "bg-blue-50 text-blue-700",
    csv_import:      "bg-amber-50 text-amber-700",
    clio_sync:       "bg-purple-50 text-purple-700",
  };
  return (
    <span className={`badge capitalize ${map[source] ?? "bg-black/5 text-black/40"}`}>
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-CA");
}

export default async function ConflictRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; firm?: string }>;
}) {
  const { q: rawQ, firm: firmFilter } = await searchParams;
  const q = rawQ?.trim() ?? "";

  // Load all firms for the filter dropdown
  const { data: firms } = await supabase
    .from("law_firm_clients")
    .select("id, name")
    .order("name");

  let query = supabase
    .from("conflict_register")
    .select("*, law_firm_clients(name)")
    .order("created_at", { ascending: false });

  if (firmFilter) {
    query = query.eq("law_firm_id", firmFilter);
  }

  const { data: rows } = await query;
  const allRows = (rows ?? []) as unknown as ConflictRow[];

  // Client-side text filter (server-side ilike would require separate query per field)
  const filtered = q
    ? allRows.filter((r) => {
        const haystack = [
          r.client_name,
          r.opposing_party ?? "",
          r.matter_type ?? "",
          r.email ?? "",
          r.phone ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q.toLowerCase());
      })
    : allRows;

  const totalCount = allRows.length;

  // Source breakdown
  const sourceCounts: Record<string, number> = {};
  for (const r of allRows) {
    sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Conflict Register</h1>
        <p className="text-sm text-black/50 mt-1">
          {totalCount} entr{totalCount !== 1 ? "ies" : "y"} ·{" "}
          {Object.entries(sourceCounts)
            .map(([src, n]) => `${n} from ${SOURCE_LABELS[src] ?? src}`)
            .join(" · ")}
        </p>
      </div>

      {/* Filters */}
      <form method="GET" className="flex gap-3 flex-wrap items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-black/50 mb-1 font-medium">Search</label>
          <input
            name="q"
            defaultValue={q}
            placeholder="Name, email, matter type..."
            className="w-full border border-black/12 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/20"
          />
        </div>
        <div>
          <label className="block text-xs text-black/50 mb-1 font-medium">Firm</label>
          <select
            name="firm"
            defaultValue={firmFilter ?? ""}
            className="border border-black/12 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/20"
          >
            <option value="">All firms</option>
            {(firms ?? []).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-navy text-white text-sm font-medium hover:bg-navy/90 transition"
        >
          Filter
        </button>
        {(q || firmFilter) && (
          <a
            href="/conflict-register"
            className="px-4 py-2 rounded-lg bg-black/5 text-black/60 text-sm hover:bg-black/8 transition"
          >
            Clear
          </a>
        )}
      </form>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="card p-10 text-center text-black/40 text-sm">
          {q || firmFilter
            ? "No entries match your search."
            : "No conflict register entries yet. Entries are added automatically when a lead moves to Client Won."}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-black/8 text-xs text-black/40">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
            {(q || firmFilter) ? ` (filtered from ${totalCount})` : ""}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/8 bg-black/[0.02] text-xs text-black/50">
                <th className="text-left px-4 py-3 font-medium">Client</th>
                <th className="text-left px-4 py-3 font-medium">Firm</th>
                <th className="text-left px-4 py-3 font-medium">Matter type</th>
                <th className="text-left px-4 py-3 font-medium">Opposing party</th>
                <th className="text-left px-4 py-3 font-medium">Source</th>
                <th className="text-left px-4 py-3 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-black/[0.01]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-black/80">{row.client_name}</div>
                    {row.email && (
                      <div className="text-xs text-black/40 mt-0.5">{row.email}</div>
                    )}
                    {row.phone && (
                      <div className="text-xs text-black/40">{row.phone}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-black/60">
                    {row.law_firm_clients?.name ?? " - "}
                  </td>
                  <td className="px-4 py-3 text-xs text-black/60 capitalize">
                    {row.matter_type ?? <span className="text-black/20"> - </span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-black/60">
                    {row.opposing_party ?? <span className="text-black/20"> - </span>}
                  </td>
                  <td className="px-4 py-3">
                    {sourceBadge(row.source)}
                  </td>
                  <td className="px-4 py-3 text-xs text-black/50">
                    {fmtDate(row.created_at)}
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
