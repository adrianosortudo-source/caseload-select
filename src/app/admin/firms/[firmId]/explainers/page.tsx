/**
 * /admin/firms/[firmId]/explainers
 *
 * Firm-scoped explainer view. The explainer_articles library is global
 * (no firm_id); a firm "has" an explainer only by assignment to one of
 * its matters. This page reads matter_explainer_assignments for the
 * firm's client_matters and groups by article, so the operator sees
 * which client-education articles are reaching this firm's clients and
 * on how many matters.
 *
 * The authoring library (write + publish) stays global at
 * /admin/explainers. Auth enforced by /admin/layout.tsx.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { practiceAreaLabel } from "@/lib/screened-leads-labels";
import { MATTER_STAGES } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STAGE_LABEL = new Map<string, string>(MATTER_STAGES.map((s) => [s.key, s.label] as const));

interface MatterRow {
  id: string;
  primary_name: string | null;
  matter_type: string | null;
}

interface AssignmentRow {
  matter_id: string;
  article_id: string;
  assigned_at: string | null;
}

interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  practice_area: string;
  matter_stage: string;
  published: boolean;
}

interface GroupedArticle {
  article: ArticleRow;
  matters: { id: string; name: string }[];
}

export default async function FirmExplainersPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const session = await getOperatorSession();
  if (!session) redirect("/portal/login?error=missing");

  const { firmId } = await params;

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("id, name")
    .eq("id", firmId)
    .maybeSingle();

  const firmName = (firm?.name as string | null) ?? "(unknown firm)";

  const { data: matterData } = await supabase
    .from("client_matters")
    .select("id, primary_name, matter_type")
    .eq("firm_id", firmId)
    .returns<MatterRow[]>();

  const matters = matterData ?? [];
  const matterById = new Map(matters.map((m) => [m.id, m] as const));
  const matterIds = matters.map((m) => m.id);

  let grouped: GroupedArticle[] = [];

  if (matterIds.length > 0) {
    const { data: assignmentData } = await supabase
      .from("matter_explainer_assignments")
      .select("matter_id, article_id, assigned_at")
      .in("matter_id", matterIds)
      .returns<AssignmentRow[]>();

    const assignments = assignmentData ?? [];
    const articleIds = Array.from(new Set(assignments.map((a) => a.article_id)));

    if (articleIds.length > 0) {
      const { data: articleData } = await supabase
        .from("explainer_articles")
        .select("id, slug, title, practice_area, matter_stage, published")
        .in("id", articleIds)
        .returns<ArticleRow[]>();

      const articleById = new Map((articleData ?? []).map((a) => [a.id, a] as const));
      const byArticle = new Map<string, GroupedArticle>();

      for (const a of assignments) {
        const article = articleById.get(a.article_id);
        if (!article) continue;
        const matter = matterById.get(a.matter_id);
        const entry = byArticle.get(a.article_id) ?? { article, matters: [] };
        entry.matters.push({
          id: a.matter_id,
          name: matter?.primary_name ?? "Unknown client",
        });
        byArticle.set(a.article_id, entry);
      }

      grouped = Array.from(byArticle.values()).sort(
        (x, y) => y.matters.length - x.matters.length,
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Explainers</h1>
        <p className="mt-1 text-sm text-black/60">
          {firmName}: client-education articles assigned to this firm&apos;s matters.
        </p>
      </div>

      <div className="bg-white border border-border-brand p-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-black/55">
          The article library is shared across every firm. Author and publish content there; assign
          articles to a client from inside the matter.
        </p>
        <Link
          href="/admin/explainers"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold px-3 py-1.5 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors"
        >
          Explainer library <span aria-hidden>&#8599;</span>
        </Link>
      </div>

      {matters.length === 0 ? (
        <div className="bg-white border border-border-brand px-6 py-10 text-center">
          <p className="text-sm text-black/60">
            {firmName} has no open matters yet, so no explainers are assigned. Articles get assigned to
            a client from inside the matter once a lead is taken.
          </p>
        </div>
      ) : grouped.length === 0 ? (
        <div className="bg-white border border-border-brand px-6 py-10 text-center">
          <p className="text-sm text-black/60">
            No explainers assigned across {firmName}&apos;s {matters.length} matter
            {matters.length === 1 ? "" : "s"} yet. Open a matter to assign client-education articles.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-border-brand overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-parchment-2 border-b border-border-brand">
              <tr className="text-left text-black/50 uppercase tracking-wider">
                <th className="px-4 py-2 font-semibold">Article</th>
                <th className="px-4 py-2 font-semibold">Practice area</th>
                <th className="px-4 py-2 font-semibold">Stage</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Assigned to</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(({ article, matters: assignedMatters }) => (
                <tr key={article.id} className="border-b border-black/5 last:border-0 hover:bg-parchment/50">
                  <td className="px-4 py-2 align-top">
                    <Link
                      href={`/admin/explainers/${article.id}`}
                      className="text-navy font-semibold hover:underline"
                    >
                      {article.title || "Untitled"}
                    </Link>
                    <div className="text-[10px] font-mono text-black/35 mt-0.5">{article.slug}</div>
                  </td>
                  <td className="px-4 py-2 align-top text-black/70">
                    {practiceAreaLabel(article.practice_area)}
                  </td>
                  <td className="px-4 py-2 align-top text-black/70">
                    {STAGE_LABEL.get(article.matter_stage) ?? article.matter_stage}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <PublishedBadge published={article.published} />
                  </td>
                  <td className="px-4 py-2 align-top text-black/70">
                    <span className="font-semibold text-navy">
                      {assignedMatters.length} matter{assignedMatters.length === 1 ? "" : "s"}
                    </span>
                    <div className="text-[11px] text-black/55 mt-0.5">
                      {assignedMatters.map((m) => m.name).join(", ")}
                    </div>
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

function PublishedBadge({ published }: { published: boolean }) {
  return published ? (
    <span className="inline-flex items-center font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 border bg-green-pass/10 text-green-pass border-green-pass/30">
      Published
    </span>
  ) : (
    <span className="inline-flex items-center font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 border bg-parchment-2 text-muted border-border-brand">
      Draft
    </span>
  );
}
