/**
 * /admin/explainers/[id]
 *
 * Per-article editor surface. Loads the explainer_article and mounts the client
 * ExplainerEditor (title, body via the shared RichTextEditor, practice area,
 * matter stage, ordering, publish toggle). Save goes through
 * PATCH /api/admin/explainers/[id], which sanitizes body_html.
 *
 * Auth: getOperatorSession() in /admin/layout.tsx.
 */

import Link from 'next/link';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { PRACTICE_AREA_LABELS, practiceAreaLabel } from '@/lib/screened-leads-labels';
import { MATTER_STAGES, type ExplainerArticle } from '@/lib/types';
import ExplainerEditor, { type SelectOption } from '@/components/admin/ExplainerEditor';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminExplainerEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: article, error } = await supabase
    .from('explainer_articles')
    .select('id, slug, title, body_html, practice_area, matter_stage, ordering, published, created_at, updated_at')
    .eq('id', id)
    .maybeSingle<ExplainerArticle>();

  if (error) {
    return <ErrorState message={error.message} />;
  }
  if (!article) {
    return <ErrorState message={`No explainer found for id ${id}.`} />;
  }

  // Practice-area options: the known set, plus the article's current value if
  // it isn't one of them (so editing never silently drops an existing value).
  const practiceAreaOptions: SelectOption[] = Object.keys(PRACTICE_AREA_LABELS).map((key) => ({
    value: key,
    label: PRACTICE_AREA_LABELS[key],
  }));
  if (article.practice_area && !PRACTICE_AREA_LABELS[article.practice_area]) {
    practiceAreaOptions.unshift({ value: article.practice_area, label: practiceAreaLabel(article.practice_area) });
  }

  const stageOptions: SelectOption[] = MATTER_STAGES.map((s) => ({ value: s.key, label: s.label }));

  return (
    <div className="space-y-5">
      <div className="text-xs text-black/40">
        <Link href="/admin/explainers" className="hover:text-navy">Explainers</Link>
        <span className="mx-1.5">›</span>
        <span className="text-black/60">{article.title || article.slug}</span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-gold">Edit explainer</p>
          <h1 className="text-2xl font-bold text-navy mt-1">{article.title || article.slug}</h1>
          <p className="text-[11px] font-mono text-black/35 mt-1">{article.slug}</p>
        </div>
      </div>

      <ExplainerEditor
        id={article.id}
        initial={{
          title: article.title ?? '',
          body_html: article.body_html ?? '',
          practice_area: article.practice_area ?? '',
          matter_stage: article.matter_stage,
          ordering: article.ordering ?? 0,
          published: !!article.published,
        }}
        practiceAreaOptions={practiceAreaOptions}
        stageOptions={stageOptions}
      />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-white border border-red-200 px-6 py-6">
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}
