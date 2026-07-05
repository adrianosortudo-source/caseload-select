/**
 * /admin/seo-check
 *
 * Operator-facing surface for the SEO & AI Visibility Check. Same engine and
 * components as the public tool at /tools/seo-check, run in the "operator"
 * variant: no prospect email gate, a pages-to-scan selector (up to 10), and
 * no sales CTA on the report.
 *
 * The tool's components are styled with the marketing design tokens, which are
 * scoped to `.cls-marketing` and not loaded by the admin Tailwind app. We
 * import the token sheet here and wrap the tool in a `.cls-marketing` container
 * so the brand variables resolve inside the operator console.
 *
 * Auth: getOperatorSession() in /admin/layout.tsx.
 */

import "@/app/(marketing)/styles/tokens.css";
import SeoCheckTool from "@/app/(marketing)/tools/seo-check/_components/SeoCheckTool";
import PageHeader from "@/components/PageHeader";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

interface SavedAuditRow {
  id: string;
  domain: string | null;
  grade: string | null;
  overall_score: number | null;
  ai_search_score: number | null;
  scan_mode: string | null;
  pages_scanned: number | null;
  issue_count: number | null;
  created_at: string;
}

async function loadSavedAudits(): Promise<SavedAuditRow[]> {
  // Guarded: return nothing on any error so the page renders even if the
  // seo_check_runs table is absent (deploy-ahead-of-migration safety).
  try {
    const { data, error } = await supabaseAdmin
      .from("seo_check_runs")
      .select("id, domain, grade, overall_score, ai_search_score, scan_mode, pages_scanned, issue_count, created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) return [];
    return (data ?? []) as SavedAuditRow[];
  } catch {
    return [];
  }
}

export default async function AdminSeoCheckPage() {
  const audits = await loadSavedAudits();

  return (
    <div>
      <PageHeader
        title="SEO and AI visibility check"
        subtitle="Canonical SEO audit for prospects and clients. Run a quick scan to triage a new site fast, or standard/deep for a full technical, content, and AI-visibility diagnostic. Save results here and revisit them for follow-up."
        right={
          <p className="text-xs text-black/40 max-w-[260px] text-right leading-snug">
            Canonical SEO audit. Prospecting Diagnostic consumes SEO results separately.
          </p>
        }
      />

      <div className="cls-marketing">
        <SeoCheckTool variant="operator" />
      </div>

      {/* Saved audits: text-based PDF export. Reads seo_check_runs (populated by
          "Save this scan" in the tool above). window.print() rasterizes on some
          drivers, so the PDF here is server-rendered with a real text layer. */}
      <section className="mt-10">
        <div className="flex items-end justify-between gap-3 mb-3">
          <h2 className="text-sm font-display font-semibold uppercase tracking-wider text-navy">
            Saved audits
          </h2>
          <span className="text-xs text-black/40">Download a text-selectable PDF of any saved scan.</span>
        </div>

        {audits.length === 0 ? (
          <p className="text-sm text-black/50 border border-black/10 rounded-lg bg-white px-4 py-6 text-center">
            No saved audits yet. Run a check above, then use &ldquo;Save this scan&rdquo; on the report.
          </p>
        ) : (
          <div className="overflow-x-auto border border-black/10 rounded-lg bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider font-display text-black/40 border-b border-black/10">
                  <th className="px-4 py-2.5">Domain</th>
                  <th className="px-4 py-2.5">SEO</th>
                  <th className="px-4 py-2.5">AI</th>
                  <th className="px-4 py-2.5">Scan</th>
                  <th className="px-4 py-2.5">Issues</th>
                  <th className="px-4 py-2.5">Saved</th>
                  <th className="px-4 py-2.5 text-right">Export</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a) => (
                  <tr key={a.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-navy">{a.domain ?? "unknown"}</td>
                    <td className="px-4 py-2.5 text-black/70">{a.grade ?? "?"} {a.overall_score ?? "?"}</td>
                    <td className="px-4 py-2.5 text-black/70">{a.ai_search_score ?? "?"}</td>
                    <td className="px-4 py-2.5 text-black/60">{a.scan_mode ?? "?"} · {a.pages_scanned ?? 0}p</td>
                    <td className="px-4 py-2.5 text-black/60">{a.issue_count ?? 0}</td>
                    <td className="px-4 py-2.5 text-black/50">
                      {new Date(a.created_at).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/api/admin/seo-check/report-pdf?id=${a.id}`}
                        className="text-xs font-display font-semibold uppercase tracking-wider text-navy hover:underline"
                      >
                        Download PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
