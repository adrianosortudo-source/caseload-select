export interface DimensionBarEntry {
  name: string;
  weight: number;
  score: number;
}

export interface RankedFinding {
  dimension: string;
  label: string;
  severity: "high" | "medium";
  opportunity: string;
  evidence: string;
  estimatedEffort: "low" | "medium" | "high";
}

export interface RedFlag {
  key: string;
  label: string;
  detail: string;
  ceiling: number;
  confidence: "proven" | "best_effort";
  source: string;
}

export interface DesignCheckResult {
  domain: string;
  checkedAt: string;
  score: number;
  letterGrade: "A" | "B" | "C" | "D" | "F";
  dimensionBar: DimensionBarEntry[];
  notMeasuredDimensions: string[];
  notApplicableDimensions: string[];
  rankedFindings: RankedFinding[];
  redFlagPanel: {
    activeFlags: RedFlag[];
    notCheckableInV1: Array<{ key: string; label: string; reason: string }>;
    ceiling: number | null;
  };
}

function gradeColor(grade: string): string {
  if (grade === "A" || grade === "B") return "var(--navy)";
  if (grade === "C") return "var(--stone-on-light)";
  return "var(--danger)";
}

function effortLabel(effort: RankedFinding["estimatedEffort"]): string {
  if (effort === "low") return "Quick fix";
  if (effort === "high") return "Larger project";
  return "Moderate effort";
}

export default function WebsiteDesignCheckReport({ result, onReset }: { result: DesignCheckResult; onReset: () => void }) {
  const { activeFlags, notCheckableInV1 } = result.redFlagPanel;

  return (
    <div className="dc-report">
      <div className="dc-report-header">
        <div className="dc-grade-block">
          <span className="dc-grade-letter" style={{ color: gradeColor(result.letterGrade) }}>
            {result.letterGrade}
          </span>
          <span className="dc-grade-score">{result.score}/100</span>
        </div>
        <div className="dc-report-meta">
          <p className="dc-report-domain">{result.domain}</p>
          <p className="dc-report-date">Checked {new Date(result.checkedAt).toLocaleDateString()}</p>
        </div>
        <button type="button" className="dc-reset-btn" onClick={onReset}>
          Check another site
        </button>
      </div>

      {activeFlags.length > 0 && (
        <div className="dc-redflag-panel">
          <h3 className="dc-redflag-title">What&apos;s holding this grade back</h3>
          <p className="dc-redflag-sub">
            These findings cap the grade regardless of how the rest of the site scores. Fixing them unlocks the rest of the site&apos;s real score.
          </p>
          <ul className="dc-redflag-list">
            {activeFlags.map((flag) => (
              <li key={flag.key} className="dc-redflag-item">
                <span className="dc-redflag-label">{flag.label}</span>
                <span className="dc-redflag-detail">{flag.detail}</span>
                {flag.confidence === "best_effort" && <span className="dc-redflag-tag">Best-effort detection</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dc-dimension-bar">
        <h3 className="dc-section-title">Where the site stands, by category</h3>
        {result.dimensionBar.map((d) => (
          <div key={d.name} className="dc-dim-row">
            <span className="dc-dim-name">{d.name}</span>
            <div className="dc-dim-track">
              {/* An empty track, not a zero-width bar reading as a total
                  failure: a null score means this page had nothing to
                  grade here. */}
              {d.score !== null && (
                <div className="dc-dim-fill" style={{ width: `${d.score}%`, background: gradeColor(d.score >= 80 ? "A" : d.score >= 70 ? "C" : "F") }} />
              )}
            </div>
            <span className="dc-dim-score">{d.score === null ? "Not on this page" : d.score}</span>
          </div>
        ))}
        {result.notApplicableDimensions.length > 0 && (
          <p className="dc-not-measured">
            Nothing on this page to grade for: {result.notApplicableDimensions.join(", ")}. These are left out of the score rather than counted against it.
          </p>
        )}
        {result.notMeasuredDimensions.length > 0 && (
          <p className="dc-not-measured">Not yet measured in this version: {result.notMeasuredDimensions.join(", ")}.</p>
        )}
      </div>

      <div className="dc-findings">
        <h3 className="dc-section-title">The specific opportunities on this site</h3>
        <ol className="dc-findings-list">
          {result.rankedFindings.map((f, i) => (
            <li key={i} className="dc-finding-item">
              <div className="dc-finding-head">
                <span className={`dc-finding-severity dc-finding-severity-${f.severity}`}>{f.severity === "high" ? "High impact" : "Worth fixing"}</span>
                <span className="dc-finding-effort">{effortLabel(f.estimatedEffort)}</span>
              </div>
              <p className="dc-finding-opportunity">{f.opportunity}</p>
              <p className="dc-finding-evidence">{f.evidence}</p>
              <span className="dc-finding-dim">{f.dimension}</span>
            </li>
          ))}
        </ol>
      </div>

      {notCheckableInV1.length > 0 && (
        <div className="dc-disclosure">
          <p className="dc-disclosure-title">Not checked in this version</p>
          <ul className="dc-disclosure-list">
            {notCheckableInV1.map((n) => (
              <li key={n.key}>
                <strong>{n.label}.</strong> {n.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <style>{`
        .dc-report { max-width: 860px; margin: 0 auto; }

        .dc-report-header {
          display: flex;
          align-items: center;
          gap: var(--sp-5);
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          padding: var(--sp-6);
          margin-bottom: var(--sp-6);
        }
        .dc-grade-block { display: flex; flex-direction: column; align-items: center; min-width: 96px; }
        .dc-grade-letter { font-family: var(--font-display); font-size: 56px; font-weight: 800; line-height: 1; }
        .dc-grade-score { font-family: var(--font-body); font-size: 13px; color: var(--text-muted); margin-top: var(--sp-1); }
        .dc-report-meta { flex: 1; }
        .dc-report-domain { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--navy); margin: 0; }
        .dc-report-date { font-size: 12.5px; color: var(--text-muted); margin: var(--sp-1) 0 0; }
        .dc-reset-btn {
          font-family: var(--font-display); font-size: 11px; font-weight: 700; letter-spacing: var(--ls-button);
          text-transform: uppercase; color: var(--navy); background: none; border: 1.5px solid var(--border);
          border-radius: var(--r-tight); padding: var(--sp-3) var(--sp-4); cursor: pointer; white-space: nowrap;
          transition: border-color 0.2s;
        }
        .dc-reset-btn:hover { border-color: var(--navy); }

        .dc-redflag-panel {
          background: var(--white); border: 1.5px solid var(--danger); border-radius: var(--r-card);
          padding: var(--sp-5); margin-bottom: var(--sp-6);
        }
        .dc-redflag-title { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--danger); margin: 0 0 var(--sp-2); }
        .dc-redflag-sub { font-size: 13px; color: var(--text-muted); line-height: 1.6; margin: 0 0 var(--sp-4); }
        .dc-redflag-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
        .dc-redflag-item { display: flex; flex-direction: column; gap: 2px; }
        .dc-redflag-label { font-family: var(--font-display); font-size: 13.5px; font-weight: 700; color: var(--text); }
        .dc-redflag-detail { font-size: 12.5px; color: var(--text-muted); line-height: 1.55; }
        .dc-redflag-tag {
          font-family: var(--font-display); font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase;
          color: var(--stone-on-light); width: fit-content; margin-top: 2px;
        }

        .dc-dimension-bar { background: var(--white); border: 1px solid var(--border); border-radius: var(--r-card); padding: var(--sp-5); margin-bottom: var(--sp-6); }
        .dc-section-title { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--navy); margin: 0 0 var(--sp-4); }
        .dc-dim-row { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-3); }
        .dc-dim-name { font-size: 12.5px; color: var(--text); width: 220px; flex-shrink: 0; }
        .dc-dim-track { flex: 1; height: 8px; background: var(--parchment); border-radius: var(--r-pill, 999px); overflow: hidden; }
        .dc-dim-fill { height: 100%; border-radius: var(--r-pill, 999px); }
        .dc-dim-score { font-family: var(--font-display); font-size: 12.5px; font-weight: 700; color: var(--text); width: 30px; text-align: right; }
        .dc-not-measured { font-size: 12px; color: var(--text-muted); margin: var(--sp-3) 0 0; font-style: italic; }

        .dc-findings { margin-bottom: var(--sp-6); }
        .dc-findings-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-4); counter-reset: finding; }
        .dc-finding-item { background: var(--white); border: 1px solid var(--border); border-radius: var(--r-card); padding: var(--sp-5); }
        .dc-finding-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-2); }
        .dc-finding-severity {
          font-family: var(--font-display); font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase;
          padding: 3px 8px; border-radius: var(--r-tight);
        }
        .dc-finding-severity-high { color: var(--white); background: var(--danger); }
        .dc-finding-severity-medium { color: var(--navy); background: var(--stone-light); }
        .dc-finding-effort { font-size: 11.5px; color: var(--text-muted); }
        .dc-finding-opportunity { font-size: 14.5px; color: var(--text); line-height: 1.55; margin: 0 0 var(--sp-2); font-weight: 600; }
        .dc-finding-evidence { font-size: 12.5px; color: var(--text-muted); line-height: 1.55; margin: 0 0 var(--sp-2); }
        .dc-finding-dim { font-family: var(--font-display); font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--stone-on-light); }

        .dc-disclosure { background: var(--parchment); border-radius: var(--r-card); padding: var(--sp-5); }
        .dc-disclosure-title { font-family: var(--font-display); font-size: 12.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.6px; margin: 0 0 var(--sp-3); }
        .dc-disclosure-list { margin: 0; padding-left: var(--sp-5); font-size: 12.5px; color: var(--text-muted); line-height: 1.6; }
        .dc-disclosure-list strong { color: var(--text); }

        @media (max-width: 640px) {
          .dc-report-header { flex-direction: column; align-items: flex-start; }
          .dc-dim-row { flex-wrap: wrap; }
          .dc-dim-name { width: 100%; }
        }
      `}</style>
    </div>
  );
}
