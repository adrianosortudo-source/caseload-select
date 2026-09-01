/**
 * /admin/explainers
 *
 * Operator-facing list of explainer_articles (global client-education content
 * assigned to matters). Each row links to the per-article editor. This is the
 * authoring surface the operator uses to write the seed explainers (currently
 * published=false with empty bodies) without a deploy.
 *
 * Auth: getOperatorSession() in /admin/layout.tsx.
 */

import Link from 'next/link';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { practiceAreaLabel } from '@/lib/screened-leads-labels';
import { MATTER_STAGES, type ExplainerArticle } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const STAGE_LABEL = new Map(MATTER_STAGES.map((s) => [s.key, s.label] as const));

export default async function AdminExplainersPage() {
  const { data, error } = await supabase
    .from('explainer_articles')
    .select('id, slug, title, practice_area, matter_stage, ordering, published')
    .order('practice_area', { ascending: true })
    .order('ordering', { ascending: true })
    .order('title', { ascending: true })
    .returns<Pick<ExplainerArticle, 'id' | 'slug' | 'title' | 'practice_area' | 'matter_stage' | 'ordering' | 'published'>[]>();

  if (error) {
    return <ErrorState message={error.message} />;
  }

  const articles = data ?? [];
  const publishedCount = articles.filter((a) => a.published).length;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
          <h1 className="text-2xl font-bold text-navy mt-1">Explainers</h1>
        </div>
        <div className="text-xs text-black/50 uppercase tracking-wider">
          {publishedCount} of {articles.length} published
        </div>
      </div>

      <p className="text-sm text-black/55 max-w-3xl">
        Client-education articles assigned to matters. Edit a row to author its content and publish it.
        Unpublished articles are not shown to clients.
      </p>

      {articles.length === 0 ? (
        <div className="bg-white border border-black/8 px-6 py-10 text-center">
          <p className="text-sm text-black/60">No explainer articles found.</p>
        </div>
      ) : (
        <div className="bg-white border border-black/10 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-parchment-2 border-b border-black/10">
              <tr className="text-left text-black/50 uppercase tracking-wider">
                <th className="px-4 py-2 font-semibold">Title</th>
                <th className="px-4 py-2 font-semibold">Practice area</th>
                <th className="px-4 py-2 font-semibold">Stage</th>
                <th className="px-4 py-2 font-semibold">Order</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id} className="border-b border-black/5 last:border-0 hover:bg-parchment/50">
                  <td className="px-4 py-2 align-middle">
                    <Link href={`/admin/explainers/${a.id}`} className="text-navy font-semibold hover:underline">
                      {a.title || <span className="text-black/40 italic">Untitled</span>}
                    </Link>
                    <div className="text-[10px] font-mono text-black/35 mt-0.5">{a.slug}</div>
                  </td>
                  <td className="px-4 py-2 align-middle text-black/70">{practiceAreaLabel(a.practice_area)}</td>
                  <td className="px-4 py-2 align-middle text-black/70">{STAGE_LABEL.get(a.matter_stage) ?? a.matter_stage}</td>
                  <td className="px-4 py-2 align-middle text-black/60 tabular-nums">{a.ordering}</td>
                  <td className="px-4 py-2 align-middle">
                    <PublishedBadge published={a.published} />
                  </td>
                  <td className="px-4 py-2 align-middle text-right">
                    <Link
                      href={`/admin/explainers/${a.id}`}
                      className="text-xs uppercase tracking-wider font-semibold text-navy hover:underline"
                    >
                      Edit
                    </Link>
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
    <span className="inline-flex items-center font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 border bg-emerald-100 text-emerald-900 border-emerald-300">
      Published
    </span>
  ) : (
    <span className="inline-flex items-center font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 border bg-black/[0.04] text-black/50 border-black/15">
      Draft
    </span>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-white border border-red-200 px-6 py-6">
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}
