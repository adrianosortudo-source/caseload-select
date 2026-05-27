"use client";

/**
 * CasePicker — the entry surface for /screen-demo
 *
 * Four cards. Three calibrated samples plus "Use your own inquiry."
 * Each sample card carries the expected band as a chip so the lawyer
 * sees the spread of outcomes upfront — A, B, C — and understands the
 * Screen is calibrated, not theatrical.
 *
 * The "Use your own" card is visually distinct (gold accent border) to
 * signal it's the high-intent path for someone who wants personalized
 * output on the first pass.
 */

import { useRouter } from "next/navigation";
import { SAMPLE_CASES, type SampleCase } from "../_data/cases";
import { BAND_COLOR } from "../_lib/scoring";

function CaseCard({ sample }: { sample: SampleCase }) {
  const router = useRouter();
  const accent = sample.isCustom ? "#C4B49A" : BAND_COLOR[sample.expectedBand];

  return (
    <article
      className={`case-card${sample.isCustom ? " case-card-custom" : ""}`}
      style={{ ["--accent" as string]: accent }}
    >
      <div className="case-head">
        <span className="case-tag">{sample.tag}</span>
        {!sample.isCustom && (
          <span className="case-chip">{sample.expectedOutcome}</span>
        )}
      </div>
      <h3 className="case-title">{sample.title}</h3>
      <p className="case-body">{sample.description}</p>
      <button
        type="button"
        className="case-cta"
        onClick={() => router.push(`/screen-demo/quiz/${sample.id}`)}
      >
        {sample.isCustom ? "Run my inquiry" : "Run this case"}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
          <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <polyline points="12 5 19 12 12 19" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>

      <style jsx>{`
        .case-card {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          border-top: 3px solid var(--accent);
          padding: 28px 26px 24px;
          display: flex;
          flex-direction: column;
          gap: var(--sp-3);
          box-shadow: var(--shadow-1);
          transition: box-shadow 0.3s, transform 0.3s;
        }
        .case-card:hover {
          box-shadow: var(--shadow-2);
          transform: translateY(-4px);
        }
        .case-card-custom {
          background: linear-gradient(180deg, #F9F6EE 0%, var(--white) 100%);
          border: 1px solid var(--stone);
          border-top: 3px solid var(--stone);
        }

        .case-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--sp-3);
        }
        .case-tag {
          font-family: var(--font-display);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.8px;
          text-transform: uppercase;
          color: var(--stone-on-light);
        }
        .case-chip {
          font-family: var(--font-display);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: var(--accent);
          padding: 4px 10px;
          border: 1px solid var(--accent);
          border-radius: 999px;
          background: color-mix(in srgb, var(--accent) 8%, transparent);
        }
        .case-title {
          font-family: var(--font-display);
          font-size: 17px;
          font-weight: 800;
          color: var(--navy);
          line-height: 1.35;
          margin: 0;
        }
        .case-body {
          font-size: 13.5px;
          color: var(--text-muted);
          line-height: 1.6;
          margin: 0;
          flex: 1;
        }
        .case-cta {
          margin-top: var(--sp-4);
          font-family: var(--font-body);
          font-size: 12.5px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          background: var(--navy);
          color: var(--white);
          border: none;
          padding: 12px 18px;
          border-radius: var(--r-tight);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.2s, transform 0.2s;
          align-self: flex-start;
        }
        .case-card-custom .case-cta {
          background: var(--stone-on-light);
        }
        .case-cta:hover {
          background: #253870;
          transform: translateY(-1px);
        }
        .case-card-custom .case-cta:hover {
          background: var(--navy);
        }
      `}</style>
    </article>
  );
}

export default function CasePicker() {
  return (
    <div className="case-grid">
      {SAMPLE_CASES.map((sample) => (
        <CaseCard key={sample.id} sample={sample} />
      ))}
      <style jsx>{`
        .case-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: var(--sp-5);
          max-width: 920px;
          margin: 0 auto;
        }
        @media (max-width: 720px) {
          .case-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
