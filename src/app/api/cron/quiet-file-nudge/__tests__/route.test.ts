/**
 * Tests for GET /api/cron/quiet-file-nudge
 *
 * Covers: auth gate, empty-state short-circuits, the quiet-matter filter
 * (message cutoff + suppression cutoff), recipient resolution via
 * firm_lawyers (respecting email_notifications_enabled), and the
 * notification_outbox row shape (real columns only: this route replaces
 * a prior script that inserted a nonexistent `lawyer_ids` column and never
 * set the required `recipient_email`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

let cronAuthed = true;
vi.mock('@/lib/cron-auth', () => ({
  isCronAuthorized: () => cronAuthed,
}));

// ── Chainable Supabase query-builder mock ──────────────────────────────────
// Each table gets its own builder; every fluent method returns `this` and
// the object is awaitable (implements `.then`), resolving to a per-table
// configured { data, error } result. `insert` resolves independently so
// insert-error tests do not have to fight the select chain's result.

function makeBuilder(selectResult: { data: unknown; error: unknown }) {
  const insertMock = vi.fn(() => Promise.resolve({ error: null }));
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: insertMock,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(selectResult).then(resolve, reject),
  };
  return { builder, insertMock };
}

let mattersResult: { data: unknown; error: unknown };
let messagesResult: { data: unknown; error: unknown };
let lawyersResult: { data: unknown; error: unknown };
let insertMock: ReturnType<typeof vi.fn>;

const mockSupabase = {
  from: vi.fn((table: string) => {
    if (table === 'client_matters') return makeBuilder(mattersResult).builder;
    if (table === 'matter_messages') return makeBuilder(messagesResult).builder;
    if (table === 'firm_lawyers') return makeBuilder(lawyersResult).builder;
    if (table === 'notification_outbox') {
      const { builder, insertMock: im } = makeBuilder({ data: null, error: null });
      insertMock = im;
      return builder;
    }
    return makeBuilder({ data: null, error: null }).builder;
  }),
};

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: mockSupabase,
}));

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/quiet-file-nudge', { method: 'GET' });
}

const NOW = new Date('2026-07-02T13:00:00.000Z');
const ELEVEN_DAYS_AGO = new Date('2026-06-21T00:00:00.000Z').toISOString();
const TWO_DAYS_AGO = new Date('2026-06-30T00:00:00.000Z').toISOString();

const QUIET_MATTER = {
  id: 'matter-1',
  firm_id: 'firm-1',
  lead_id: 'lawyer-1',
  assignee_ids: [],
  primary_name: 'Ana Santos',
  matter_type: 'Residential purchase',
  practice_area: 'real_estate',
  quiet_nudge_sent_at: null,
};

describe('GET /api/cron/quiet-file-nudge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    cronAuthed = true;
    mattersResult = { data: [], error: null };
    messagesResult = { data: [], error: null };
    lawyersResult = { data: [], error: null };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns 401 when not cron-authorized', async () => {
    cronAuthed = false;
    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns ok with zero scanned when no active matters exist', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, scanned: 0, nudged: 0 });
  });

  it('returns 500 when the client_matters query errors', async () => {
    mattersResult = { data: null, error: { message: 'db down' } };
    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });

  it('nudges a matter with no client message ever sent', async () => {
    mattersResult = { data: [QUIET_MATTER], error: null };
    messagesResult = { data: [], error: null };
    lawyersResult = { data: [{ id: 'lawyer-1', email: 'damaris@drglaw.ca', email_notifications_enabled: true }], error: null };

    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.quiet).toBe(1);
    expect(body.nudged).toBe(1);
    expect(body.notifications_queued).toBe(1);
    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({
        recipient_email: 'damaris@drglaw.ca',
        firm_id: 'firm-1',
        matter_id: 'matter-1',
        event_type: 'milestone_draft_ready',
      }),
    ]);
    const payload = insertMock.mock.calls[0][0][0].event_payload;
    expect(payload.body).toMatch(/no client update has been sent/i);
  });

  it('does not nudge a matter with a recent client message', async () => {
    mattersResult = { data: [QUIET_MATTER], error: null };
    messagesResult = { data: [{ matter_id: 'matter-1', created_at: TWO_DAYS_AGO }], error: null };

    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.quiet).toBe(0);
    expect(body.nudged).toBe(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('nudges a matter whose last client message is past the 10-day cutoff', async () => {
    mattersResult = { data: [QUIET_MATTER], error: null };
    messagesResult = { data: [{ matter_id: 'matter-1', created_at: ELEVEN_DAYS_AGO }], error: null };
    lawyersResult = { data: [{ id: 'lawyer-1', email: 'damaris@drglaw.ca', email_notifications_enabled: true }], error: null };

    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.nudged).toBe(1);
    const payload = insertMock.mock.calls[0][0][0].event_payload;
    expect(payload.body).toMatch(/no client update sent on this matter since/i);
  });

  it('suppresses a re-nudge within QUIET_NUDGE_SUPPRESSION_DAYS', async () => {
    const recentlyNudged = { ...QUIET_MATTER, quiet_nudge_sent_at: TWO_DAYS_AGO };
    mattersResult = { data: [recentlyNudged], error: null };
    messagesResult = { data: [], error: null };

    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.quiet).toBe(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('re-nudges once the suppression window has passed', async () => {
    const staleNudge = { ...QUIET_MATTER, quiet_nudge_sent_at: ELEVEN_DAYS_AGO };
    mattersResult = { data: [staleNudge], error: null };
    messagesResult = { data: [], error: null };
    lawyersResult = { data: [{ id: 'lawyer-1', email: 'damaris@drglaw.ca', email_notifications_enabled: true }], error: null };

    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.nudged).toBe(1);
  });

  it('skips a matter whose only lawyer has email_notifications_enabled=false', async () => {
    mattersResult = { data: [QUIET_MATTER], error: null };
    messagesResult = { data: [], error: null };
    lawyersResult = { data: [{ id: 'lawyer-1', email: 'damaris@drglaw.ca', email_notifications_enabled: false }], error: null };

    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.quiet).toBe(1);
    expect(body.nudged).toBe(0);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('fans out to both lead_id and assignee_ids as distinct recipients', async () => {
    const twoLawyerMatter = { ...QUIET_MATTER, lead_id: 'lawyer-1', assignee_ids: ['lawyer-2'] };
    mattersResult = { data: [twoLawyerMatter], error: null };
    messagesResult = { data: [], error: null };
    lawyersResult = {
      data: [
        { id: 'lawyer-1', email: 'damaris@drglaw.ca', email_notifications_enabled: true },
        { id: 'lawyer-2', email: 'associate@drglaw.ca', email_notifications_enabled: true },
      ],
      error: null,
    };

    const { GET } = await import('../route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.notifications_queued).toBe(2);
    const emails = insertMock.mock.calls[0][0].map((r: { recipient_email: string }) => r.recipient_email);
    expect(emails.sort()).toEqual(['associate@drglaw.ca', 'damaris@drglaw.ca']);
  });
});
