/**
 * Lawyer-facing matter detail page.
 *
 * URL: /portal/[firmId]/matters/[matterId]
 *
 * The post-take view: one matter, all its pieces. Server-rendered with
 * data fetched at request time so it's always fresh; client-side
 * actions hang off API routes already shipped (stage transition,
 * welcome edit/send, message send, explainer assign, embed set,
 * kickoff composition).
 *
 * Sections (top-down):
 *   1. Header: primary contact + matter type + practice area + current stage
 *   2. Stage timeline: forward-only chain with current stage highlighted,
 *      transition buttons (admin / staff per canAdvanceStage), kickoff
 *      button (S14 composition) when in intake
 *   3. Welcome draft panel: view, edit hint, send button, sent timestamp
 *   4. Message threads (tabbed): client | internal — list + compose
 *   5. Assigned explainers: list + pick + remove
 *   6. Embed slot: URL + set/clear
 *
 * Session: firm-side only (lawyer / operator). Client sessions go to
 * /portal/[firmId]/m/[matterId] (the client surface).
 */

import Link from 'next/link';
import { requirePortalViewer } from '@/lib/portal-auth';
import { getMatterById } from '@/lib/matter-stage';
import { formatTimestamp } from '@/lib/firm-timezone';
import { listMessagesForMatter } from '@/lib/matter-messages';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type {
  ClientMatter,
  ExplainerArticle,
  MatterMessage,
  MatterStage,
  MatterStageEvent,
} from '@/lib/types';
import { nextStage } from '@/lib/matter-stage-pure';
import WelcomeEditor from './WelcomeEditor';
import MessageThreads from './MessageThreads';
import { ConflictCheckPanel } from './ConflictCheckPanel';
import MilestoneDraftPanel from '@/components/portal/MilestoneDraftPanel';
import RequestReviewButton from './RequestReviewButton';
import ActivityTimeline from './ActivityTimeline';

const STAGE_LABEL: Record<MatterStage, string> = {
  intake: 'Intake',
  retainer_pending: 'Retainer pending',
  active: 'Active',
  closing: 'Closing',
  closed: 'Closed',
};

const STAGE_ORDER: MatterStage[] = ['intake', 'retainer_pending', 'active', 'closing', 'closed'];

interface PageProps {
  params: Promise<{ firmId: string; matterId: string }>;
}

export default async function LawyerMatterDetailPage({ params }: PageProps) {
  const { firmId, matterId } = await params;
  // Operator-view contract (DR-076): admits operator read-only and fixes the
  // prior redirect to the non-existent /portal/[firmId]/login (a hard 404).
  const viewer = await requirePortalViewer(firmId);

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return (
      <main style={pageStyle}>
        <h1>Matter not found</h1>
        <p>This matter does not exist or does not belong to your firm.</p>
        <p><Link href={`/portal/${firmId}/clients`}>← Back to active clients</Link></p>
      </main>
    );
  }

  // Fetch supporting data in parallel
  const [clientMessages, internalMessages, stageEvents, assignedExplainers, conflictCheck] =
    await Promise.all([
      listMessagesForMatter(matterId, 'admin', { channel: 'client', limit: 50 }),
      listMessagesForMatter(matterId, 'admin', { channel: 'internal', limit: 50 }),
      supabase
        .from('matter_stage_events')
        .select('*')
        .eq('matter_id', matterId)
        .order('created_at', { ascending: true })
        .then((r) => (r.data ?? []) as MatterStageEvent[]),
      fetchAssignedExplainers(matterId),
      // Most-recent conflict check for this matter (gate reads the same way)
      supabase
        .from('screened_conflict_checks')
        .select('id,check_status,check_type,disposition,dispositioned_by,dispositioned_at,notes,created_at')
        .eq('matter_id', matterId)
        .eq('firm_id', firmId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then((r) => r.data ?? null),
    ]);

  const next = nextStage(matter.matter_stage);

  return (
    <main style={pageStyle}>
      <nav style={{ marginBottom: 16 }}>
        <Link href={`/portal/${firmId}/clients`} style={backLinkStyle}>
          ← Active clients
        </Link>
      </nav>

      <header style={headerStyle}>
        <p style={eyebrowStyle}>Matter detail</p>
        <h1 style={titleStyle}>{matter.primary_name}</h1>
        <p style={subTitleStyle}>
          {matter.practice_area} · {matter.matter_type} · created {formatDate(matter.created_at)}
        </p>
        <p style={contactRowStyle}>
          {matter.primary_email ? <span>📧 {matter.primary_email}</span> : null}
          {matter.primary_phone ? <span style={{ marginLeft: 16 }}>📞 {matter.primary_phone}</span> : null}
        </p>
        {viewer.isOperator && (
          <p style={{ marginTop: 10 }}>
            {/* DR-084: operator enters the client matter preview for this matter. */}
            <a
              href={`/api/portal/${firmId}/preview/enter?target=client&matterId=${matterId}`}
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "#1E2F58",
                textDecoration: "underline",
              }}
            >
              View as client
            </a>
          </p>
        )}
      </header>

      <StageTimeline matter={matter} events={stageEvents} firmId={firmId} matterId={matterId} next={next} />

      <ConflictCheckPanel
        firmId={firmId}
        matterId={matterId}
        screened_lead_id={matter.source_screened_lead_id ?? ''}
        existingCheck={conflictCheck}
      />

      <WelcomePanel matter={matter} firmId={firmId} matterId={matterId} />

      {matter.matter_stage === 'active' && (
        <MilestoneDraftPanel
          firmId={firmId}
          matterId={matterId}
          practiceArea={matter.practice_area}
          currentMilestone={matter.matter_milestone}
        />
      )}

      {(matter.matter_stage === 'active' || matter.matter_stage === 'closing' || matter.matter_stage === 'closed') && (
        <section style={cardStyle}>
          <p style={sectionEyebrowStyle}>Google review</p>
          <RequestReviewButton firmId={firmId} matterId={matterId} />
        </section>
      )}

      <section style={cardStyle}>
        <p style={sectionEyebrowStyle}>Messages</p>
        <MessageThreads
          firmId={firmId}
          matterId={matterId}
          initialClientMessages={clientMessages}
          initialInternalMessages={internalMessages}
        />
      </section>

      <ExplainersPanel
        articles={assignedExplainers}
        firmId={firmId}
        matterId={matterId}
      />

      <EmbedPanel matter={matter} firmId={firmId} matterId={matterId} />

      <section style={cardStyle}>
        <p style={sectionEyebrowStyle}>Activity</p>
        <ActivityTimeline firmId={firmId} matterId={matterId} />
      </section>
    </main>
  );
}

async function fetchAssignedExplainers(matterId: string): Promise<ExplainerArticle[]> {
  const { data: assignments } = await supabase
    .from('matter_explainer_assignments')
    .select('article_id')
    .eq('matter_id', matterId);
  const articleIds = (assignments ?? []).map((a) => a.article_id);
  if (articleIds.length === 0) return [];
  const { data } = await supabase
    .from('explainer_articles')
    .select('*')
    .in('id', articleIds)
    .order('ordering', { ascending: true });
  return (data ?? []) as ExplainerArticle[];
}

// ─── Stage Timeline ────────────────────────────────────────────────────

function StageTimeline({
  matter,
  events,
  firmId,
  matterId,
  next,
}: {
  matter: ClientMatter;
  events: MatterStageEvent[];
  firmId: string;
  matterId: string;
  next: MatterStage | null;
}) {
  return (
    <section style={cardStyle}>
      <p style={sectionEyebrowStyle}>Stage</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {STAGE_ORDER.map((stage, idx) => {
          const isCurrent = stage === matter.matter_stage;
          const isPast = STAGE_ORDER.indexOf(matter.matter_stage) > idx;
          return (
            <span
              key={stage}
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                fontSize: '0.84rem',
                fontWeight: isCurrent ? 800 : 500,
                background: isCurrent ? '#1E2F58' : isPast ? 'var(--portal-accent)' : '#E0DDD3',
                color: isCurrent || isPast ? '#fff' : '#888',
              }}
            >
              {STAGE_LABEL[stage]}
            </span>
          );
        })}
      </div>

      {matter.matter_stage === 'intake' && (
        <div style={{ marginBottom: 12 }}>
          <KickoffButton firmId={firmId} matterId={matterId} />
          <span style={{ display: 'block', marginTop: 6, fontSize: '0.78rem', color: '#888' }}>
            Kickoff sends the welcome, auto-assigns explainers for retainer_pending, advances to retainer_pending, and generates a client invite link.
          </span>
        </div>
      )}

      {next && matter.matter_stage !== 'intake' && (
        <AdvanceStageButton firmId={firmId} matterId={matterId} from={matter.matter_stage} to={next} />
      )}

      {events.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.84rem', color: '#666' }}>
            Stage history ({events.length})
          </summary>
          <ul style={{ listStyle: 'none', padding: '8px 0 0 0', margin: 0, fontSize: '0.84rem' }}>
            {events.map((e) => (
              <li key={e.id} style={{ padding: '4px 0', color: '#555' }}>
                {formatDate(e.created_at)} — {e.from_stage ?? '(initial)'} → {e.to_stage}
                {e.note ? <span style={{ color: '#888' }}> · {e.note}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function KickoffButton({ firmId, matterId }: { firmId: string; matterId: string }) {
  return (
    <form
      action={`/api/portal/${firmId}/matters/${matterId}/kickoff`}
      method="POST"
      encType="application/json"
      style={{ display: 'inline-block' }}
    >
      <button type="submit" style={primaryButtonStyle}>
        Kick off matter
      </button>
    </form>
  );
}

function AdvanceStageButton({
  firmId,
  matterId,
  from,
  to,
}: {
  firmId: string;
  matterId: string;
  from: MatterStage;
  to: MatterStage;
}) {
  return (
    <form
      action={`/api/portal/${firmId}/matters/${matterId}/stage`}
      method="POST"
      style={{ display: 'inline-block' }}
    >
      <input type="hidden" name="to" value={to} />
      <button type="submit" style={primaryButtonStyle}>
        Advance: {STAGE_LABEL[from]} → {STAGE_LABEL[to]}
      </button>
    </form>
  );
}

// ─── Welcome Panel ─────────────────────────────────────────────────────

function WelcomePanel({
  matter,
  firmId,
  matterId,
}: {
  matter: ClientMatter;
  firmId: string;
  matterId: string;
}) {
  if (!matter.welcome_draft_html) {
    return (
      <section style={cardStyle}>
        <p style={sectionEyebrowStyle}>Welcome draft</p>
        <p style={{ color: '#888' }}>No draft available for this matter.</p>
      </section>
    );
  }

  return (
    <section style={cardStyle}>
      <p style={sectionEyebrowStyle}>Welcome draft</p>
      {matter.welcome_draft_sent_at ? (
        <>
          <p style={{ color: '#4a7d4a', fontSize: '0.88rem', marginBottom: 12 }}>
            ✓ Sent {formatDate(matter.welcome_draft_sent_at)}
          </p>
          <div
            style={welcomeBodyStyle}
            dangerouslySetInnerHTML={{
              __html: matter.welcome_draft_sent_body ?? matter.welcome_draft_html,
            }}
          />
        </>
      ) : (
        <>
          <p style={{ color: '#666', fontSize: '0.88rem', marginBottom: 12 }}>
            Draft is ready. Edit the HTML on the left; preview on the right. Save edits whenever; click Send when ready (Kickoff sends + advances stage in one click).
          </p>
          <WelcomeEditor
            firmId={firmId}
            matterId={matterId}
            originalHtml={matter.welcome_draft_html}
            initialEditedHtml={matter.welcome_draft_edited_html}
            isSent={false}
          />
        </>
      )}
    </section>
  );
}

// ─── Explainers Panel ──────────────────────────────────────────────────

function ExplainersPanel({
  articles,
  firmId,
  matterId,
}: {
  articles: ExplainerArticle[];
  firmId: string;
  matterId: string;
}) {
  return (
    <section style={cardStyle}>
      <p style={sectionEyebrowStyle}>Explainer articles assigned</p>
      {articles.length === 0 ? (
        <p style={{ color: '#888', fontSize: '0.88rem' }}>
          No explainers assigned. Use the kickoff button (intake stage) or POST to{' '}
          <code style={{ fontSize: '0.82rem' }}>/api/portal/{firmId}/matters/{matterId}/explainers</code> with{' '}
          <code style={{ fontSize: '0.82rem' }}>{`{ article_id }`}</code> to assign one.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {articles.map((a) => (
            <li key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid #E0DDD3', fontSize: '0.88rem' }}>
              <span style={{ fontWeight: 700 }}>{a.title}</span>{' '}
              <span style={{ color: '#888', fontSize: '0.78rem' }}>
                ({a.matter_stage} · {a.practice_area})
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Embed Panel ───────────────────────────────────────────────────────

function EmbedPanel({
  matter,
  firmId,
  matterId,
}: {
  matter: ClientMatter;
  firmId: string;
  matterId: string;
}) {
  return (
    <section style={cardStyle}>
      <p style={sectionEyebrowStyle}>Embed slot</p>
      {matter.embed_url ? (
        <>
          <p style={{ fontSize: '0.88rem', color: '#444' }}>
            Current: <code style={{ fontSize: '0.82rem' }}>{matter.embed_url}</code>
          </p>
          <p style={{ fontSize: '0.82rem', color: '#888', marginTop: 4 }}>
            PATCH {' '}
            <code style={{ fontSize: '0.78rem' }}>
              /api/portal/{firmId}/matters/{matterId}/embed
            </code>{' '}
            with{' '}
            <code style={{ fontSize: '0.78rem' }}>{`{ embed_url: null }`}</code> to clear.
          </p>
        </>
      ) : (
        <p style={{ fontSize: '0.88rem', color: '#888' }}>
          No embed configured. PATCH{' '}
          <code style={{ fontSize: '0.82rem' }}>
            /api/portal/{firmId}/matters/{matterId}/embed
          </code>{' '}
          with{' '}
          <code style={{ fontSize: '0.82rem' }}>{`{ embed_url: "https://…" }`}</code> (origin must be in the firm's embed_origins allow-list).
        </p>
      )}
    </section>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────

const pageStyle = {
  maxWidth: 920,
  margin: '0 auto',
  padding: '32px 24px',
  fontFamily: "'Manrope', system-ui, sans-serif",
  color: '#0D1520',
} as const;

const backLinkStyle = {
  color: '#1E2F58',
  fontSize: '0.86rem',
  textDecoration: 'none',
};

const headerStyle = {
  marginBottom: 24,
  paddingBottom: 16,
  borderBottom: '1px solid #E0DDD3',
};

const eyebrowStyle = {
  fontFamily: "'Oxanium', system-ui, sans-serif",
  fontSize: '0.72rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
  color: 'var(--portal-accent)',
  margin: 0,
};

const sectionEyebrowStyle = {
  ...eyebrowStyle,
  marginBottom: 8,
};

const titleStyle = {
  fontSize: '1.6rem',
  fontWeight: 800 as const,
  color: '#1E2F58',
  margin: '6px 0 2px 0',
};

const subTitleStyle = {
  fontSize: '0.92rem',
  color: '#666',
  margin: 0,
};

const contactRowStyle = {
  marginTop: 6,
  fontSize: '0.86rem',
  color: '#444',
};

const cardStyle = {
  background: '#F4F3EF',
  border: '1px solid #E0DDD3',
  borderRadius: 8,
  padding: 18,
  marginBottom: 16,
};

const welcomeBodyStyle = {
  background: '#fff',
  padding: 12,
  borderRadius: 4,
  fontSize: '0.92rem',
  color: '#222',
  lineHeight: 1.5,
};

const primaryButtonStyle = {
  background: '#1E2F58',
  color: '#fff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.86rem',
  fontWeight: 700 as const,
};

const secondaryButtonStyle = {
  background: 'var(--portal-accent)',
  color: '#fff',
  border: 'none',
  padding: '6px 12px',
  borderRadius: 3,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.82rem',
  fontWeight: 700 as const,
};

function formatDate(iso: string): string {
  // #140: render in firm-local time (default America/Toronto) via the
  // shared chokepoint, never server/UTC. Per-firm timezone threading lands
  // when the firm record is plumbed into this page; until then the Toronto
  // default is correct for the current client base.
  return formatTimestamp(iso, undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
