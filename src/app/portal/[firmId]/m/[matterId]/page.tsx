/**
 * Client matter home (S8 Phase 1 Story 4).
 *
 * URL: /portal/[firmId]/m/[matterId]
 *
 * The first thing the client sees after accepting the magic-link
 * invite. Shows:
 *
 *   - Stage card: where the matter is in the 5-stage lifecycle,
 *     with a plain-language explanation of what that stage means
 *   - Welcome message: the lawyer's introductory note (sent via
 *     S08 welcome draft)
 *   - Message thread: the client-channel only (internal thread is
 *     never visible to the client)
 *   - Explainer articles assigned to this matter (S15)
 *
 * Session: client role only, scoped to this exact matter.
 */

import { redirect } from 'next/navigation';
import { getClientMatterSession } from '@/lib/portal-auth';
import { getMatterById } from '@/lib/matter-stage';
import { listMessagesForMatter } from '@/lib/matter-messages';
import { formatTimestamp } from '@/lib/firm-timezone';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { ExplainerArticle, MatterStage } from '@/lib/types';
import ComposeForm from './ComposeForm';

const STAGE_COPY: Record<MatterStage, { label: string; client_blurb: string }> = {
  intake: {
    label: 'We have your matter',
    client_blurb: 'We have your inquiry and we are reviewing it. Your lawyer will be in touch using the contact details you shared.',
  },
  retainer_pending: {
    label: 'Retainer in progress',
    client_blurb: 'Your lawyer has sent (or will soon send) the retainer agreement. Once it is signed and the retainer is in place, your matter moves to active.',
  },
  active: {
    label: 'Matter active',
    client_blurb: 'Your matter is active. Your lawyer is working on it. You can message them here and they will respond when they have an update.',
  },
  closing: {
    label: 'Wrapping up',
    client_blurb: 'Your matter is winding down. Your lawyer is finalising the last items.',
  },
  closed: {
    label: 'Closed',
    client_blurb: 'Your matter is closed. The full record stays with the firm. If anything new comes up, reply to your last message and your lawyer will pick it up.',
  },
};

interface PageProps {
  params: Promise<{ firmId: string; matterId: string }>;
}

export default async function ClientMatterHomePage({ params }: PageProps) {
  const { firmId, matterId } = await params;
  const session = await getClientMatterSession(firmId, matterId);
  if (!session) {
    redirect(`/portal/${firmId}/m/${matterId}/accept?expired=1`);
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return (
      <main style={pageStyle}>
        <h1>Matter not found</h1>
        <p>This page is no longer available.</p>
      </main>
    );
  }

  const messages = await listMessagesForMatter(matterId, 'client', { channel: 'client', limit: 100 });

  // Explainer assignments
  const { data: assignments } = await supabase
    .from('matter_explainer_assignments')
    .select('article_id, assigned_at')
    .eq('matter_id', matterId);
  const articleIds = (assignments ?? []).map((a) => a.article_id);
  let articles: ExplainerArticle[] = [];
  if (articleIds.length > 0) {
    const { data } = await supabase
      .from('explainer_articles')
      .select('*')
      .in('id', articleIds)
      .eq('published', true)
      .order('ordering', { ascending: true });
    articles = (data ?? []) as ExplainerArticle[];
  }

  const stage = STAGE_COPY[matter.matter_stage];

  return (
    <main style={pageStyle}>
      <header style={{ marginBottom: 32 }}>
        <p style={eyebrowStyle}>Your matter with the firm</p>
        <h1 style={titleStyle}>Hello {matter.primary_name.split(/\s+/)[0]}</h1>
      </header>

      <section style={cardStyle}>
        <p style={sectionEyebrow}>Where things stand</p>
        <h2 style={cardTitleStyle}>{stage.label}</h2>
        <p style={cardBodyStyle}>{stage.client_blurb}</p>
      </section>

      <section style={cardStyle}>
        <p style={sectionEyebrow}>Messages</p>
        {messages.length === 0 ? (
          <p style={{ color: '#888', fontSize: '0.92rem', marginBottom: 14 }}>
            No messages yet. Your lawyer will be in touch when they have an update. You can also reach out first using the form below.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {messages.map((m) => (
              <li key={m.id} style={messageRowStyle}>
                <p style={messageMetaStyle}>
                  {m.sender_role === 'client' ? 'You' : 'Your lawyer'} ·{' '}
                  {formatTimestamp(m.created_at, undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
                <div
                  style={messageBodyStyle}
                  dangerouslySetInnerHTML={{
                    __html: m.body.includes('<') ? m.body : escapeHtml(m.body).replace(/\n/g, '<br>'),
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <ComposeForm firmId={firmId} matterId={matterId} />
      </section>

      {articles.length > 0 && (
        <section style={cardStyle}>
          <p style={sectionEyebrow}>About what's happening</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {articles.map((a) => (
              <li key={a.id} style={{ marginBottom: 12 }}>
                <a
                  href={`/portal/${firmId}/m/${matterId}/explainers/${a.slug}`}
                  style={{ color: '#1E2F58', fontWeight: 700, textDecoration: 'none' }}
                >
                  {a.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer style={{ marginTop: 40, color: '#666', fontSize: 13 }}>
        <p>Need to reach the firm right away? Reply to your last email — your lawyer gets it directly.</p>
      </footer>
    </main>
  );
}

const pageStyle = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '40px 24px',
  fontFamily: "'Manrope', system-ui, sans-serif",
  color: '#0D1520',
} as const;

const eyebrowStyle = {
  fontFamily: "'Oxanium', system-ui, sans-serif",
  fontSize: '0.72rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
  color: '#888',
  margin: 0,
};

const titleStyle = {
  fontSize: '1.8rem',
  fontWeight: 800 as const,
  color: '#1E2F58',
  margin: '8px 0 0 0',
};

const cardStyle = {
  background: '#F4F3EF',
  border: '1px solid #E0DDD3',
  borderRadius: 8,
  padding: 22,
  marginBottom: 18,
};

const cardTitleStyle = {
  fontSize: '1.3rem',
  fontWeight: 800 as const,
  color: '#1E2F58',
  margin: '4px 0 12px 0',
};

const cardBodyStyle = {
  fontSize: '1rem',
  color: '#333',
  lineHeight: 1.5,
  margin: 0,
};

const sectionEyebrow = {
  ...eyebrowStyle,
  color: '#C4B49A',
  marginBottom: 6,
};

const messageRowStyle = {
  padding: '12px 0',
  borderBottom: '1px solid #E0DDD3',
};

const messageMetaStyle = {
  fontSize: '0.78rem',
  color: '#888',
  margin: '0 0 4px 0',
};

const messageBodyStyle = {
  fontSize: '0.94rem',
  color: '#222',
  lineHeight: 1.5,
};


function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
