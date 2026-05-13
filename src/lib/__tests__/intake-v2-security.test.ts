/**
 * Tests for src/lib/intake-v2-security.ts (origin allow-list, body
 * validator, brief_html sanitizer).
 *
 * originAllowed() reaches into Supabase to load custom domains. We mock
 * the supabaseAdmin import so the helper resolves without a real DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `server-only` is a Next.js convention that throws when imported from a
// client component. Vitest doesn't satisfy the Next.js server context, so
// we stub it to a no-op for tests.
vi.mock('server-only', () => ({}));

// Mock supabase-admin BEFORE importing the SUT so the custom-domain
// lookup never hits the network.
vi.mock('../supabase-admin', () => {
  const custom_domains: Array<{ custom_domain: string }> = [
    { custom_domain: 'client.drglaw.ca' },
    { custom_domain: 'intake.kennylaw.com' },
  ];
  return {
    supabaseAdmin: {
      from: (_table: string) => ({
        select: (_cols: string) => ({
          not: (_field: string, _op: string, _v: unknown) => Promise.resolve({ data: custom_domains, error: null }),
        }),
      }),
    },
  };
});

import { originAllowed, validateIntakeBody, sanitizeBriefHtml } from '../intake-v2-security';

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request('https://app.caseloadselect.ca/api/intake-v2', {
    method: 'POST',
    headers,
    body: '{}',
  });
}

describe('originAllowed — main app + sandbox + custom domains', () => {
  beforeEach(() => {
    // Note: the 60-second cache may persist across tests. That's fine
    // since the mock returns the same data each time, and the cache
    // keys on time-since-fetch not on test isolation.
  });

  it('allows the main app domain', async () => {
    const res = await originAllowed(makeReq({ origin: 'https://app.caseloadselect.ca' }));
    expect(res.ok).toBe(true);
  });

  it('allows subdomains of the main app domain (firm subdomains)', async () => {
    const res = await originAllowed(makeReq({ origin: 'https://drglaw.caseloadselect.ca' }));
    expect(res.ok).toBe(true);
  });

  it('allows the sandbox host', async () => {
    const res = await originAllowed(makeReq({ origin: 'https://caseload-screen-v2.vercel.app' }));
    expect(res.ok).toBe(true);
  });

  it('allows Vercel preview URLs', async () => {
    const res = await originAllowed(makeReq({ origin: 'https://caseload-select-abc123.vercel.app' }));
    expect(res.ok).toBe(true);
  });

  it('allows localhost', async () => {
    const res = await originAllowed(makeReq({ origin: 'http://localhost:3000' }));
    expect(res.ok).toBe(true);
  });

  it('allows a firm-owned custom domain from intake_firms.custom_domain', async () => {
    const res = await originAllowed(makeReq({ origin: 'https://client.drglaw.ca' }));
    expect(res.ok).toBe(true);
  });

  it('rejects an unknown origin', async () => {
    const res = await originAllowed(makeReq({ origin: 'https://evil.example.com' }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('evil.example.com');
    }
  });

  it('falls back to Referer when Origin is missing', async () => {
    const res = await originAllowed(makeReq({ referer: 'https://app.caseloadselect.ca/widget/abc' }));
    expect(res.ok).toBe(true);
  });

  it('allows server-to-server callers with no Origin and no Referer', async () => {
    const res = await originAllowed(makeReq({}));
    expect(res.ok).toBe(true);
  });
});

// ─── Body validator ────────────────────────────────────────────────────────

function validBody(): Record<string, unknown> {
  return {
    lead_id: 'L-2026-05-13-XYZ',
    matter_type: 'pi_mva',
    practice_area: 'pi',
    band: 'B',
    axes: { value: 7, complexity: 4, urgency: 6, readiness: 5, readinessAnswered: true },
    brief_json: { lead_id: 'L-2026-05-13-XYZ', summary: 'rear-ended on 401' },
    brief_html: '<div class="brief"><h3>Summary</h3><p>rear-ended on 401</p></div>',
    slot_answers: { slots: { incident_date: '2026-04-22' }, slot_meta: {}, slot_evidence: {} },
    contact: { name: 'Test User', email: 'test@example.com', phone: '+14165551234' },
    intake_language: 'en',
    submitted_at: '2026-05-13T18:00:00Z',
  };
}

describe('validateIntakeBody — happy path', () => {
  it('accepts a fully-populated valid body', () => {
    const r = validateIntakeBody(validBody());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.lead_id).toBe('L-2026-05-13-XYZ');
      expect(r.body.axes.urgency).toBe(6);
      expect(r.body.intake_language).toBe('en');
    }
  });

  it('accepts a body without optional fields', () => {
    const b = validBody();
    delete b.contact;
    delete b.intake_language;
    delete b.submitted_at;
    delete b.band;
    const r = validateIntakeBody(b);
    expect(r.ok).toBe(true);
  });
});

describe('validateIntakeBody — rejections', () => {
  it('rejects non-object input', () => {
    const r = validateIntakeBody('not an object');
    expect(r.ok).toBe(false);
  });

  it('rejects when lead_id is missing', () => {
    const b = validBody();
    delete b.lead_id;
    const r = validateIntakeBody(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('lead_id'))).toBe(true);
  });

  it('rejects when lead_id contains invalid characters', () => {
    const b = validBody();
    b.lead_id = 'lead<script>';
    const r = validateIntakeBody(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('lead_id'))).toBe(true);
  });

  it('rejects an oversized brief_html (DoS bound)', () => {
    const b = validBody();
    b.brief_html = 'x'.repeat(250_001);
    const r = validateIntakeBody(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('brief_html'))).toBe(true);
  });

  it('rejects an invalid band letter', () => {
    const b = validBody();
    b.band = 'Z';
    const r = validateIntakeBody(b);
    expect(r.ok).toBe(false);
  });

  it('accepts a null band', () => {
    const b = validBody();
    b.band = null;
    const r = validateIntakeBody(b);
    expect(r.ok).toBe(true);
  });

  it('rejects axes with non-numeric fields', () => {
    const b = validBody();
    b.axes = { value: 'high', complexity: 4, urgency: 6, readiness: 5 };
    const r = validateIntakeBody(b);
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed intake_language code', () => {
    const b = validBody();
    b.intake_language = 'not a lang';
    const r = validateIntakeBody(b);
    expect(r.ok).toBe(false);
  });

  it('accepts ISO 639-1 codes for known supported languages', () => {
    for (const lang of ['en', 'fr', 'es', 'pt', 'zh', 'ar']) {
      const b = validBody();
      b.intake_language = lang;
      expect(validateIntakeBody(b).ok).toBe(true);
    }
  });

  it('rejects raw_transcript over 16 KB', () => {
    const b = validBody();
    b.raw_transcript = 'x'.repeat(16_001);
    const r = validateIntakeBody(b);
    expect(r.ok).toBe(false);
  });

  it('rejects a non-ISO submitted_at', () => {
    const b = validBody();
    b.submitted_at = 'yesterday';
    const r = validateIntakeBody(b);
    expect(r.ok).toBe(false);
  });

  it('rejects brief_json with too many top-level keys', () => {
    const b = validBody();
    const huge: Record<string, number> = {};
    for (let i = 0; i < 201; i++) huge[`k${i}`] = i;
    b.brief_json = huge;
    const r = validateIntakeBody(b);
    expect(r.ok).toBe(false);
  });
});

// ─── Sanitizer ─────────────────────────────────────────────────────────────

describe('sanitizeBriefHtml — XSS vectors', () => {
  it('strips <script> tags entirely (with content)', () => {
    const out = sanitizeBriefHtml('<p>before</p><script>alert(1)</script><p>after</p>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<p>before</p>');
    expect(out).toContain('<p>after</p>');
  });

  it('strips self-closing <script> variants', () => {
    const out = sanitizeBriefHtml('<script src="https://evil.example/x.js"></script><p>ok</p>');
    expect(out).not.toContain('script');
  });

  it('strips <style> tags (CSS injection vector)', () => {
    const out = sanitizeBriefHtml('<style>body{background:url(javascript:alert(1))}</style><p>ok</p>');
    expect(out).not.toContain('<style>');
    expect(out).not.toContain('javascript:');
  });

  it('strips <iframe>, <object>, <embed>, <applet>', () => {
    const cases = [
      '<iframe src="https://evil.example"></iframe>',
      '<object data="evil.swf"></object>',
      '<embed src="evil.swf">',
      '<applet code="Evil.class"></applet>',
    ];
    for (const html of cases) {
      const out = sanitizeBriefHtml(html);
      expect(out).not.toMatch(/<iframe|<object|<embed|<applet/i);
    }
  });

  it('strips <form>, <input>, <button> (no form-based exfil)', () => {
    const out = sanitizeBriefHtml(
      '<form action="https://evil.example"><input name="csrf"/><button>steal</button></form>',
    );
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
    expect(out).not.toContain('<button');
  });

  it('strips on*= event handlers', () => {
    const out = sanitizeBriefHtml('<p onclick="alert(1)" onmouseover="alert(2)">click me</p>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onmouseover');
    expect(out).not.toContain('alert');
    expect(out).toContain('<p');
  });

  it('strips href="javascript:..." URLs', () => {
    const out = sanitizeBriefHtml('<a href="javascript:alert(1)">link</a>');
    expect(out).not.toContain('javascript:');
  });

  it('strips src="data:..." URLs', () => {
    const out = sanitizeBriefHtml('<img src="data:text/html,<script>alert(1)</script>">');
    expect(out).not.toContain('data:');
  });

  it('strips href="vbscript:..." and href="file:..."', () => {
    expect(sanitizeBriefHtml('<a href="vbscript:msgbox(1)">x</a>')).not.toContain('vbscript:');
    expect(sanitizeBriefHtml('<a href="file:///etc/passwd">x</a>')).not.toContain('file:');
  });

  it('strips HTML comments (hiding place for content scanners)', () => {
    const out = sanitizeBriefHtml('<p>visible</p><!-- <script>alert(1)</script> -->');
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('alert');
  });

  it('preserves safe tags (h1-h6, p, ul, li, strong, a)', () => {
    const html = '<h2>Title</h2><p>body <strong>bold</strong></p><ul><li>one</li></ul><a href="https://example.com">link</a>';
    const out = sanitizeBriefHtml(html);
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('https://example.com');
  });

  it('hardens <a target="_blank"> with rel="noopener noreferrer" when missing', () => {
    const out = sanitizeBriefHtml('<a href="https://example.com" target="_blank">link</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('leaves an existing rel attribute alone on target="_blank" anchors', () => {
    const html = '<a href="https://example.com" target="_blank" rel="nofollow">link</a>';
    const out = sanitizeBriefHtml(html);
    // Existing rel preserved, no duplicate noopener added
    expect((out.match(/rel=/g) ?? []).length).toBe(1);
    expect(out).toContain('rel="nofollow"');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeBriefHtml('')).toBe('');
  });

  it('handles malformed HTML without throwing', () => {
    const out = sanitizeBriefHtml('<p>unclosed <script>alert(1) <p>nested</p>');
    expect(out).not.toContain('<script>');
  });
});
