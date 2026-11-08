export interface DimensionBarEntry {
  name: string;
  weight: number;
  // null when this page had nothing to grade for the dimension (e.g. no
  // form to check), never a fabricated 0.
  score: number | null;
}

export interface RankedFinding {
  dimension: string;
  label: string;
  severity: "flag" | "high" | "medium";
  opportunity: string;
  evidence: string;
  estimatedEffort: "low" | "medium" | "high";
  // Set only on severity "flag" entries: whether this specific flag caps
  // the grade (disqualifying) or is a real opportunity that does not
  // (advisory). See docs/BUILD_PLAN_design_check_calibration_v1.md
  // Phase 3.
  flagClassification?: "disqualifying" | "advisory";
  // True for the leading run of findings the report leads with (every
  // active flag, plus enough top ordinary findings to reach at least
  // five total). See "attainable" below and Phase 4 of the same plan.
  inAttainablePath?: boolean;
}

export interface RedFlag {
  key: string;
  label: string;
  detail: string;
  ceiling: number;
  confidence: "proven" | "best_effort";
  source: string;
  classification: "disqualifying" | "advisory";
}

export interface AttainableScore {
  score: number;
  letterGrade: "A" | "B" | "C" | "D" | "F";
}

export interface DesignCheckResult {
  domain: string;
  checkedAt: string;
  score: number;
  // The uncapped weighted average, before any red-flag ceiling. Used
  // only to name what a disqualifying flag is holding back; the grade
  // shown to a reader is always the capped `score` above.
  uncappedScore: number;
  letterGrade: "A" | "B" | "C" | "D" | "F";
  // The grade within reach if every finding carrying
  // inAttainablePath: true were fixed. Always >= score.
  attainable: AttainableScore;
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

function severityLabel(f: RankedFinding): string {
  if (f.severity === "flag") return f.flagClassification === "disqualifying" ? "Caps the grade" : "Real opportunity";
  return f.severity === "high" ? "High impact" : "Worth fixing";
}

function severityClass(f: RankedFinding): string {
  if (f.severity === "flag") return f.flagClassification === "disqualifying" ? "dc-finding-severity-flag-disqualifying" : "dc-finding-severity-flag-advisory";
  return `dc-finding-severity-${f.severity}`;
}

function FindingCard({ f }: { f: RankedFinding }) {
  return (
    <li className="dc-finding-item" data-ui-component-content="report-finding">
      <div className="dc-finding-head">
        <span className={`dc-finding-severity ${severityClass(f)}`}>{severityLabel(f)}</span>
        <span className="dc-finding-effort">{effortLabel(f.estimatedEffort)}</span>
      </div>
      <p className="dc-finding-opportunity" data-ui-copy="body">{f.opportunity}</p>
      <p className="dc-finding-evidence" data-ui-copy="supporting">{f.evidence}</p>
      <span className="dc-finding-dim">{f.dimension}</span>
    </li>
  );
}

export default function WebsiteDesignCheckReport({ result, onReset }: { result: DesignCheckResult; onReset: () => void }) {
  const { activeFlags, notCheckableInV1 } = result.redFlagPanel;
  const disqualifyingFlags = activeFlags.filter((f) => f.classification === "disqualifying");
  const isCapped = result.redFlagPanel.ceiling !== null;
  const pathFindings = result.rankedFindings.filter((f) => f.inAttainablePath);
  const restFindings = result.rankedFindings.filter((f) => !f.inAttainablePath);
  const hasRealGap = result.attainable.score > result.score;

  return (
    <div className="dc-report">
      <header className="dc-report-header" data-ui-component-content="report-summary">
        <div className="dc-report-identity">
          <div className="dc-report-meta">
            <p className="dc-report-domain">{result.domain}</p>
            <p className="dc-report-date">Checked {new Date(result.checkedAt).toLocaleDateString()}</p>
          </div>
          <button type="button" className="dc-reset-btn" onClick={onReset}>Check another site</button>
        </div>
        <dl className="dc-score-summary" aria-label="Website scores">
          <div className="dc-current-block">
            <dt className="dc-current-label">Today</dt>
            <dd><span className="dc-current-letter" style={{ color: gradeColor(result.letterGrade) }}>{result.letterGrade}</span><span className="dc-current-score">{result.score}/100</span></dd>
          </div>
          <div className="dc-attainable-block">
            <dt className="dc-attainable-label">Within reach</dt>
            <dd><span className="dc-grade-letter" style={{ color: gradeColor(result.attainable.letterGrade) }}>{result.attainable.letterGrade}</span><span className="dc-grade-score">{result.attainable.score}/100</span></dd>
          </div>
        </dl>
        {isCapped && (
          <p className="dc-unlock-line" data-ui-copy="supporting">
            The underlying measured craft is {result.uncappedScore}. The flagged items below are the ceiling.
          </p>
        )}
      </header>

      {pathFindings.length > 0 && (
        <section className="dc-path-section" data-ui-component-content="priority-findings">
          <h2 className="dc-section-title" data-ui-copy="heading">
            {hasRealGap ? `Close these ${pathFindings.length} to reach ${result.attainable.letterGrade}` : "Worth fixing next"}
          </h2>
          <p className="dc-path-sub" data-ui-copy="body">
            {hasRealGap
              ? "Ranked by impact: every flagged item first, then the findings worth the most."
              : "No further points are recoverable from these specific items, but they are still worth doing."}
          </p>
          <ol className="dc-findings-list">
            {pathFindings.map((f, i) => (
              <FindingCard key={i} f={f} />
            ))}
          </ol>
        </section>
      )}

      <section className="dc-dimension-bar" data-ui-component-content="category-scores">
        <h2 className="dc-section-title" data-ui-copy="heading">Where the site stands, by category</h2>
        {result.dimensionBar.map((d) => (
          <div key={d.name} className="dc-dim-row">
            <span className="dc-dim-name">{d.name}</span>
            <div className="dc-dim-track" aria-hidden="true">
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
          <p className="dc-not-measured" data-ui-copy="supporting">
            Nothing on this page to grade for: {result.notApplicableDimensions.join(", ")}. These are left out of the score rather than counted against it.
          </p>
        )}
        {result.notMeasuredDimensions.length > 0 && (
          <p className="dc-not-measured" data-ui-copy="supporting">Not yet measured in this version: {result.notMeasuredDimensions.join(", ")}.</p>
        )}
      </section>

      {disqualifyingFlags.length > 0 && (
        <section className="dc-redflag-panel" data-ui-component-content="grade-limitations">
          <h2 className="dc-redflag-title" data-ui-copy="heading">What&apos;s holding this grade back</h2>
          <p className="dc-redflag-sub" data-ui-copy="body">
            These findings cap the grade regardless of how the rest of the site scores. Fixing them unlocks the rest of the site&apos;s real score.
          </p>
          <ul className="dc-redflag-list">
            {disqualifyingFlags.map((flag) => (
              <li key={flag.key} className="dc-redflag-item" data-ui-component-content="grade-limitation">
                <span className="dc-redflag-label" data-ui-copy="heading">{flag.label}</span>
                <span className="dc-redflag-detail" data-ui-copy="body">{flag.detail}</span>
                {flag.confidence === "best_effort" && <span className="dc-redflag-tag">Best-effort detection</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {restFindings.length > 0 && (
        <section className="dc-findings" data-ui-component-content="remaining-findings">
          <h2 className="dc-section-title" data-ui-copy="heading">The rest of what we found</h2>
          <ol className="dc-findings-list">
            {restFindings.map((f, i) => (
              <FindingCard key={i} f={f} />
            ))}
          </ol>
        </section>
      )}

      {notCheckableInV1.length > 0 && (
        <section className="dc-disclosure" data-ui-component-content="unchecked-signals">
          <h2 className="dc-disclosure-title" data-ui-copy="heading">Not checked in this version</h2>
          <ul className="dc-disclosure-list">
            {notCheckableInV1.map((n) => (
              <li key={n.key} data-ui-component-content="unchecked-signal">
                <p data-ui-copy="body">
                <strong>{n.label}.</strong> {n.reason}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}


    </div>
  );
}
