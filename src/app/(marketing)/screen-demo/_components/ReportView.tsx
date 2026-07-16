"use client";

/**
 * ReportView — the Sample Screen Report
 *
 * The marketing-demo equivalent of what a real CaseLoad Select firm
 * receives in their triage queue. Calibrated to look real, branded as
 * the actual product, and CLEARLY MARKED as a demonstration.
 *
 * The demonstration footer band appears at the top and bottom of every
 * section so the artifact cannot be mistaken for a real screening
 * recommendation even if it leaves the website (printed, screenshotted,
 * forwarded, archived). This is an LSO Rule 4.2-1 compliance device.
 *
 * Sections:
 *   1. Header — case identifier + score chip + band
 *   2. Score breakdown — Fit / Value / CPI
 *   3. Band assignment + recommended action
 *   4. Narrative — what the Screen concluded and why
 *   5. Next steps — sequence trigger + response window
 *   6. CTA — book a consultation to see this on a real intake
 */

import type { SampleCase } from "../_data/cases";
import type { ScreenScore, Answers } from "../_lib/scoring";
import { BAND_COLOR, BAND_LABEL, BAND_RANGE, AXIS_MAX } from "../_lib/scoring";
import { SCREEN_DEMO_QUESTIONS } from "../_data/questions";

interface ReportViewProps {
  caseFixture: SampleCase;
  score: ScreenScore;
  firmName: string;
  email: string;
  answers: Answers;
  /**
   * null  → API not called or in-flight (typical at first render).
   * true  → PDF email was sent successfully via Resend.
   * false → Resend was not configured, or send failed. Visitor still sees
   *         the inline report; we just don't claim the email was delivered.
   */
  emailDelivered?: boolean | null;
}

export default function ReportView({
  caseFixture,
  score,
  firmName,
  email,
  answers,
  emailDelivered,
}: ReportViewProps) {
  const accent = BAND_COLOR[score.band];
  const bandLabel = BAND_LABEL[score.band];
  const bandRange = BAND_RANGE[score.band];

  const today = new Date().toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Pull human-readable answer summaries for the brief
  const answerSummary = SCREEN_DEMO_QUESTIONS.map((q) => {
    const v = answers[q.id];
    if (!v) return null;
    const selectedIds = Array.isArray(v) ? v : [v];
    const labels = selectedIds
      .map((id) => q.options.find((o) => o.id === id)?.label)
      .filter(Boolean);
    return { q: q.prompt, a: labels.join(" · ") };
  }).filter(Boolean) as { q: string; a: string }[];

  return (
    <div className="report">
      <DemoBand position="top" />

      {emailDelivered === true && (
        <div className="r-email-ok" role="status">
          <span className="r-email-ok-icon" aria-hidden="true">✓</span>
          <span>
            A copy of this report was emailed to <strong>{email}</strong>. Check your inbox in the next minute or two.
          </span>
        </div>
      )}

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header className="r-header" style={{ ["--accent" as string]: accent }}>
        <div className="r-header-meta">
          <div className="r-eyebrow">CaseLoad Select · Screen Report · Sample</div>
          <div className="r-date">{today}</div>
        </div>
        <div className="r-header-main">
          <div className="r-header-text">
            <div className="r-case-tag">{caseFixture.tag}</div>
            <h1 className="r-case-title">{caseFixture.title}</h1>
            <p className="r-firm">
              Prepared for <strong>{firmName}</strong>
            </p>
          </div>
          <div className="r-band-chip">
            <div className="r-band-letter">{score.band}</div>
            <div className="r-band-meta">
              <div className="r-band-label">{bandLabel}</div>
              <div className="r-band-range">{bandRange}</div>
            </div>
          </div>
        </div>
      </header>

      {/* ── CPI HERO ────────────────────────────────────────────── */}
      <section className="r-cpi">
        <div className="r-cpi-main">
          <div className="r-cpi-num">{score.cpi}</div>
          <div className="r-cpi-label">Case Priority Index<br />(0–100)</div>
        </div>
        <div className="r-cpi-split">
          <div className="r-cpi-split-row">
            <div className="r-cpi-split-key">Fit Score</div>
            <div className="r-cpi-split-val">{score.fitScore} <span>/ 30</span></div>
          </div>
          <div className="r-cpi-split-bar">
            <div className="r-cpi-split-bar-fill" style={{ width: `${(score.fitScore / 30) * 100}%` }} />
          </div>
          <div className="r-cpi-split-row">
            <div className="r-cpi-split-key">Value Score</div>
            <div className="r-cpi-split-val">{score.valueScore} <span>/ 70</span></div>
          </div>
          <div className="r-cpi-split-bar">
            <div className="r-cpi-split-bar-fill" style={{ width: `${(score.valueScore / 70) * 100}%` }} />
          </div>
        </div>
      </section>

      {/* ── AXIS BREAKDOWN ─────────────────────────────────────── */}
      <section className="r-axis">
        <h2 className="r-section-title">Scoring breakdown</h2>
        <div className="r-axis-grid">
          {(Object.keys(AXIS_MAX) as (keyof typeof AXIS_MAX)[]).map((key) => {
            const v = score.axis[key];
            const max = AXIS_MAX[key];
            return (
              <div key={key} className="r-axis-row">
                <div className="r-axis-row-head">
                  <span className="r-axis-key">{labelFor(key)}</span>
                  <span className="r-axis-val">{v} / {max}</span>
                </div>
                <div className="r-axis-bar">
                  <div className="r-axis-bar-fill" style={{ width: `${(v / max) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── NARRATIVE ──────────────────────────────────────────── */}
      <section className="r-narrative">
        <h2 className="r-section-title">What the Screen concluded</h2>
        <p>{score.narrative}</p>
      </section>

      {/* ── NEXT STEPS ─────────────────────────────────────────── */}
      <section className="r-next">
        <h2 className="r-section-title">Recommended next steps</h2>
        <div className="r-next-grid">
          <div className="r-next-card">
            <div className="r-next-label">Response window</div>
            <div className="r-next-value">{score.responseWindow}</div>
          </div>
          <div className="r-next-card">
            <div className="r-next-label">Action</div>
            <div className="r-next-value">{score.recommendedAction}</div>
          </div>
          <div className="r-next-card">
            <div className="r-next-label">Sequence trigger</div>
            <div className="r-next-value">{score.recommendedSequence}</div>
          </div>
        </div>
      </section>

      {/* ── ANSWER TRAIL ───────────────────────────────────────── */}
      <section className="r-answers">
        <h2 className="r-section-title">What the Screen heard</h2>
        <p className="r-answers-intro">
          The five questions the Screen asked, and how they were answered in
          this case. Every input is recorded and traceable so the firm can
          audit the score at any time.
        </p>
        <dl className="r-answers-list">
          {answerSummary.map((row, i) => (
            <div key={i} className="r-answers-row">
              <dt>{row.q}</dt>
              <dd>{row.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <DemoBand position="bottom" />

      {/* ── CTA ────────────────────────────────────────────────── */}
      <section className="r-cta">
        <h2>See the Screen run on your real intake<span className="ts" /></h2>
        <p>
          This was one sample inquiry. CaseLoad Select runs the Screen on
          every inquiry your firm receives, in seven channels, around the
          clock. A 30-minute call walks through what that looks like for
          your practice and your case mix.
        </p>
        <a href="/next-steps" className="r-cta-btn">See if this fits your practice →</a>
        <p className="r-cta-fine">
          Or run another sample case: <a href="/screen-demo">choose a different scenario</a>
        </p>
      </section>

      <Styles />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Demonstration footer band — LSO compliance device, top + bottom
 * ────────────────────────────────────────────────────────────────── */

function DemoBand({ position }: { position: "top" | "bottom" }) {
  return (
    <div className={`r-demo-band r-demo-band-${position}`} role="note">
      <span className="r-demo-band-icon" aria-hidden="true">⚠</span>
      <span className="r-demo-band-text">
        <strong>DEMONSTRATION REPORT.</strong> Not from a real client inquiry.
        Not legal advice. The score and recommendations below are produced
        from sample inputs to show how the CaseLoad Select Screen works,
        not to evaluate any actual matter.
      </span>
    </div>
  );
}

const LABEL_MAP: Record<string, string> = {
  geo: "Jurisdiction fit",
  contactability: "Contactability",
  legitimacy: "Intent signals",
  complexity: "Depth of work",
  urgency: "Time sensitivity",
  strategic: "Strategic value",
  fee: "Fee fit",
};

function labelFor(key: string): string {
  return LABEL_MAP[key] ?? key;
}

/* ────────────────────────────────────────────────────────────────── */

function Styles() {
  return (
    <style jsx global>{`
      .report {
        max-width: 760px;
        margin: 0 auto;
        background: var(--white);
        border-radius: var(--r-card);
        box-shadow: var(--shadow-3);
        overflow: hidden;
      }

      /* ── Email-delivered banner ─ */
      .r-email-ok {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 28px;
        background: #E8F2EC;
        border-bottom: 1px solid #BAD3C3;
        font-size: 13px;
        color: #2E5A41;
        line-height: 1.5;
      }
      .r-email-ok strong { color: #1B3D29; font-weight: 700; }
      .r-email-ok-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #2E7D5B;
        color: #FFFFFF;
        font-weight: 700;
        font-size: 13px;
        flex-shrink: 0;
      }

      /* ── Demo band ─ */
      .r-demo-band {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 28px;
        background: #FFF4E0;
        border-top: 1px solid #E8CFA0;
        border-bottom: 1px solid #E8CFA0;
        font-size: 12.5px;
        color: #6B4E1A;
        line-height: 1.55;
      }
      .r-demo-band strong { color: #4A3510; }
      .r-demo-band-icon {
        font-size: 18px;
        color: #B58D2E;
        flex-shrink: 0;
      }

      /* ── Header ─ */
      .r-header {
        padding: 32px 36px 28px;
        background: var(--navy);
        color: var(--white);
      }
      .r-header-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--sp-5);
      }
      .r-eyebrow {
        font-family: var(--font-display);
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: var(--stone);
      }
      .r-date {
        font-family: var(--font-display);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 1px;
        color: rgba(196, 180, 154, 0.7);
      }

      .r-header-main {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: var(--sp-5);
      }
      .r-header-text { flex: 1; }
      .r-case-tag {
        font-family: var(--font-display);
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: var(--stone);
        margin-bottom: 6px;
      }
      .r-case-title {
        font-family: var(--font-display);
        font-size: 22px;
        font-weight: 800;
        line-height: 1.2;
        margin: 0 0 6px;
        color: var(--white);
      }
      .r-firm {
        font-size: 13px;
        color: rgba(237, 234, 217, 0.7);
        margin: 0;
      }
      .r-firm strong {
        color: var(--white);
        font-weight: 700;
      }

      .r-band-chip {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 18px 14px 14px;
        border: 1.5px solid var(--accent);
        border-radius: var(--r-card);
        background: color-mix(in srgb, var(--accent) 18%, var(--navy));
        flex-shrink: 0;
      }
      .r-band-letter {
        font-family: var(--font-display);
        font-size: 36px;
        font-weight: 800;
        color: var(--accent);
        line-height: 1;
      }
      .r-band-label {
        font-family: var(--font-display);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 1.4px;
        text-transform: uppercase;
        color: var(--white);
      }
      .r-band-range {
        font-family: var(--font-display);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 1.2px;
        color: rgba(196, 180, 154, 0.8);
        margin-top: 2px;
      }

      /* ── Section base ─ */
      .r-cpi, .r-axis, .r-narrative, .r-next, .r-answers {
        padding: 28px 36px;
        border-bottom: 1px solid var(--border);
      }
      .r-section-title {
        font-family: var(--font-display);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 2.4px;
        text-transform: uppercase;
        color: var(--stone-on-light);
        margin: 0 0 var(--sp-4);
      }

      /* ── CPI hero ─ */
      .r-cpi {
        display: grid;
        grid-template-columns: 1fr 1.5fr;
        gap: var(--sp-7);
        align-items: center;
      }
      .r-cpi-main { text-align: center; }
      .r-cpi-num {
        font-family: var(--font-display);
        font-size: 64px;
        font-weight: 800;
        color: var(--navy);
        line-height: 1;
        margin-bottom: var(--sp-2);
      }
      .r-cpi-label {
        font-family: var(--font-display);
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 1.8px;
        text-transform: uppercase;
        color: var(--text-muted);
        line-height: 1.4;
      }
      .r-cpi-split {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .r-cpi-split-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .r-cpi-split-key {
        font-family: var(--font-display);
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 1.8px;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .r-cpi-split-val {
        font-family: var(--font-display);
        font-size: 18px;
        font-weight: 800;
        color: var(--navy);
      }
      .r-cpi-split-val span {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-muted);
      }
      .r-cpi-split-bar {
        height: 4px;
        background: var(--border);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: var(--sp-2);
      }
      .r-cpi-split-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--stone), var(--navy));
      }

      /* ── Axis breakdown ─ */
      .r-axis-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--sp-4) var(--sp-5);
      }
      .r-axis-row-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 4px;
      }
      .r-axis-key {
        font-family: var(--font-body);
        font-size: 12.5px;
        font-weight: 600;
        color: var(--navy);
      }
      .r-axis-val {
        font-family: var(--font-display);
        font-size: 11.5px;
        font-weight: 700;
        color: var(--text-muted);
      }
      .r-axis-bar {
        height: 3px;
        background: var(--border);
        border-radius: 3px;
        overflow: hidden;
      }
      .r-axis-bar-fill {
        height: 100%;
        background: var(--navy);
      }

      /* ── Narrative ─ */
      .r-narrative p {
        font-family: var(--font-body);
        font-size: 14.5px;
        color: var(--navy);
        line-height: 1.65;
        margin: 0;
      }

      /* ── Next steps ─ */
      .r-next-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--sp-4);
      }
      .r-next-card {
        padding: 14px 16px;
        background: var(--off-white);
        border-radius: var(--r-tight);
        border: 1px solid var(--border);
      }
      .r-next-card:first-child {
        grid-column: span 2;
      }
      .r-next-label {
        font-family: var(--font-display);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 1.6px;
        text-transform: uppercase;
        color: var(--stone-on-light);
        margin-bottom: 4px;
      }
      .r-next-value {
        font-family: var(--font-body);
        font-size: 13.5px;
        color: var(--navy);
        line-height: 1.55;
      }

      /* ── Answers ─ */
      .r-answers-intro {
        font-size: 13px;
        color: var(--text-muted);
        line-height: 1.6;
        margin: 0 0 var(--sp-4);
      }
      .r-answers-list {
        margin: 0;
      }
      .r-answers-row {
        padding: 12px 0;
        border-bottom: 1px solid var(--border);
      }
      .r-answers-row:last-child { border-bottom: none; }
      .r-answers-row dt {
        font-family: var(--font-display);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: var(--text-muted);
        margin-bottom: 4px;
      }
      .r-answers-row dd {
        font-family: var(--font-body);
        font-size: 13.5px;
        color: var(--navy);
        margin: 0;
      }

      /* ── CTA ─ */
      .r-cta {
        padding: 36px 36px 40px;
        text-align: center;
        background: var(--navy);
        color: var(--white);
      }
      .r-cta h2 {
        font-family: var(--font-display);
        font-size: 22px;
        font-weight: 800;
        margin: 0 0 var(--sp-3);
      }
      .r-cta p {
        font-size: 14px;
        color: rgba(237, 234, 217, 0.7);
        line-height: 1.6;
        margin: 0 auto var(--sp-5);
        max-width: 520px;
      }
      .r-cta-btn {
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 1.2px;
        text-transform: uppercase;
        color: var(--navy-deep);
        background: var(--stone);
        padding: 15px 30px;
        border-radius: var(--r-tight);
        text-decoration: none;
        display: inline-block;
        transition: background 0.2s, transform 0.2s;
      }
      .r-cta-btn:hover {
        background: var(--stone-light);
        transform: translateY(-1px);
      }
      .r-cta-fine {
        margin-top: var(--sp-5);
        font-size: 12px;
        color: rgba(196, 180, 154, 0.55);
      }
      .r-cta-fine a {
        color: var(--stone);
        text-decoration: underline;
      }

      @media (max-width: 640px) {
        .r-header-main { flex-direction: column; align-items: flex-start; }
        .r-cpi { grid-template-columns: 1fr; gap: var(--sp-5); }
        .r-axis-grid { grid-template-columns: 1fr; }
        .r-next-grid { grid-template-columns: 1fr; }
        .r-next-card:first-child { grid-column: auto; }
      }
    `}</style>
  );
}
