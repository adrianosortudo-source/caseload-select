/**
 * Client explainer reader (S8 Phase 2).
 *
 * URL: /portal/[firmId]/m/[matterId]/explainers/[slug]
 *
 * The page the client matter home links to for each assigned explainer. Shows
 * one article's body. Access rules (no leaking of content the client shouldn't
 * see):
 *   - client-role session scoped to this exact matter (same gate as the matter
 *     home),
 *   - the article must be PUBLISHED, and
 *   - it must be ASSIGNED to this matter (matter_explainer_assignments).
 * Any miss returns a uniform "not available" — we never distinguish
 * nonexistent / unpublished / unassigned.
 *
 * body_html is sanitized on save (the operator authoring surface), and
 * sanitized again here on render as defense in depth (covers seed rows or any
 * value written outside the authoring UI). Rendered server-side.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getClientMatterSession } from '@/lib/portal-auth';
import { getMatterById } from '@/lib/matter-stage';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { sanitizeExplainerHtml } from '@/lib/explainer-html-sanitize';

interface PageProps {
  params: Promise<{ firmId: string; matterId: string; slug: string }>;
}

export default async function ClientExplainerPage({ params }: PageProps) {
  const { firmId, matterId, slug } = await params;

  const session = await getClientMatterSession(firmId, matterId);
  if (!session) {
    redirect(`/portal/${firmId}/m/${matterId}/accept?expired=1`);
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return <NotAvailable firmId={firmId} matterId={matterId} />;
  }

  // Article must be assigned to THIS matter and published.
  const { data: assignments } = await supabase
    .from('matter_explainer_assignments')
    .select('article_id')
    .eq('matter_id', matterId);
  const articleIds = (assignments ?? []).map((a) => a.article_id);
  if (articleIds.length === 0) {
    return <NotAvailable firmId={firmId} matterId={matterId} />;
  }

  const { data: article } = await supabase
    .from('explainer_articles')
    .select('slug, title, body_html')
    .eq('slug', slug)
    .eq('published', true)
    .in('id', articleIds)
    .maybeSingle<{ slug: string; title: string; body_html: string }>();

  if (!article) {
    return <NotAvailable firmId={firmId} matterId={matterId} />;
  }

  const safeBody = sanitizeExplainerHtml(article.body_html);

  return (
    <main style={pageStyle}>
      <Link href={`/portal/${firmId}/m/${matterId}`} style={backLinkStyle}>
        ← Back to your matter
      </Link>
      <article>
        <h1 style={titleStyle}>{article.title}</h1>
        {safeBody ? (
          <div style={bodyStyle} dangerouslySetInnerHTML={{ __html: safeBody }} />
        ) : (
          <p style={{ color: '#888', fontStyle: 'italic' }}>
            This article does not have any content yet.
          </p>
        )}
      </article>
    </main>
  );
}

function NotAvailable({ firmId, matterId }: { firmId: string; matterId: string }) {
  return (
    <main style={pageStyle}>
      <Link href={`/portal/${firmId}/m/${matterId}`} style={backLinkStyle}>
        ← Back to your matter
      </Link>
      <h1 style={titleStyle}>Not available</h1>
      <p style={{ color: '#555', lineHeight: 1.5 }}>
        This article is not available. It may have been removed, or it is not part of your matter.
      </p>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '40px 20px 64px',
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#1a1a1a',
};

const backLinkStyle: React.CSSProperties = {
  display: 'inline-block',
  marginBottom: 24,
  fontSize: '0.84rem',
  color: '#1E2F58',
  textDecoration: 'none',
  fontWeight: 600,
};

const titleStyle: React.CSSProperties = {
  fontFamily: "'Manrope', system-ui, sans-serif",
  fontSize: '1.6rem',
  fontWeight: 800,
  color: '#1E2F58',
  margin: '0 0 18px 0',
  lineHeight: 1.25,
};

const bodyStyle: React.CSSProperties = {
  fontSize: '1rem',
  lineHeight: 1.65,
  color: '#222',
};
