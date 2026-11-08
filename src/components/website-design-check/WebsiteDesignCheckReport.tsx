import { useRef, useState } from "react";
import { assessment, copyPlan, coverageText, groups, presentFinding } from "./report-presentation";

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
  flagKey?: string;
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
  judgmentCoverage?: { wholePage: true } | { wholePage: false; judgedTopPx: number; actualPageHeightPx: number };
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

export default function WebsiteDesignCheckReport({ result, onReset }: { result: DesignCheckResult; onReset: () => void }) {
  const [copyState, setCopyState] = useState<"idle" | "success" | "manual">("idle");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const priorities = groups(result).slice(0, 3);
  const plan = copyPlan(result, priorities);
  const flags = result.redFlagPanel.activeFlags.filter(f => f.classification === "disqualifying");
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(plan);
      setCopyState("success");
    } catch { setCopyState("manual"); requestAnimationFrame(() => fallbackRef.current?.focus()); }
  }
  function reveal(id: string) {
    if (detailsRef.current) detailsRef.current.open = true;
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }
  return <div className="dc-report">
    <header className="dc-report-header" data-ui-component-content="report-summary">
      <div className="dc-report-identity"><div className="dc-report-meta">
        <p className="dc-report-domain">{result.domain}</p>
        <p className="dc-report-date">Checked {new Date(result.checkedAt).toLocaleDateString()}</p>
      </div><button type="button" className="dc-reset-btn" onClick={onReset}>Check another site</button></div>
      <p data-ui-copy="supporting">Automated homepage check · Mobile and desktop.</p>
      <p data-ui-copy="body">{assessment(result, priorities)}</p>
    </header>
    {priorities.length > 0 && <section className="dc-path-section" data-ui-component-content="priority-findings">
      <h2 className="dc-section-title" data-ui-copy="heading">Priorities</h2>
      <ol className="dc-findings-list">{priorities.map((g,i) => <li className="dc-finding-item" key={i} data-ui-component-content="report-finding">
        <h3 data-ui-copy="heading">{g.copy.title}</h3>
        <p data-ui-copy="body"><strong>Found:</strong> {g.findings[0].evidence.length <= 170 ? g.findings[0].evidence : <a href={`#dc-finding-${result.rankedFindings.indexOf(g.findings[0].source)}`} onClick={() => reveal(`dc-finding-${result.rankedFindings.indexOf(g.findings[0].source)}`)}>See the full observation in details</a>}</p>
        <p data-ui-copy="body"><strong>Why:</strong> {g.copy.why}</p>
        <p data-ui-copy="body"><strong>Change:</strong> {Array.from(new Set(g.findings.map(item => item.copy.action))).join(" ")}</p>
        {g.findings.length > 1 && <p data-ui-copy="supporting">Combines related findings. See each observation in the details.</p>}
        <p data-ui-copy="supporting"><strong>Suggested owner:</strong> {g.copy.owner}. {g.status}.</p>
      </li>)}</ol>
    </section>}
    {flags.length > 0 && <section className="dc-redflag-panel" data-ui-component-content="grade-limitations">
      <h2 className="dc-redflag-title" data-ui-copy="heading">Review these flagged items</h2>
      <ul className="dc-redflag-list">{flags.map(f => <li key={f.key}><a href={`#dc-flag-${f.key}`} onClick={() => reveal(`dc-flag-${f.key}`)}>{f.label}</a> · {f.confidence === "best_effort" ? "Needs confirmation" : f.confidence === "proven" ? "Confirmed" : "Confidence not supplied"}</li>)}</ul>
    </section>}
    <p className="dc-report-current">Current score: <strong>{result.letterGrade} · {result.score}/100</strong></p>
    <div className="dc-report-actions"><button type="button" className="dc-reset-btn" onClick={copy}>Copy action plan</button>
      <p role="status" aria-live="polite">{copyState === "success" ? "Action plan copied." : copyState === "manual" ? "Copy the action plan from the text below." : ""}</p>
      {copyState === "manual" && <label>Action plan for manual copy<textarea ref={fallbackRef} readOnly value={plan} rows={10} onFocus={e => e.currentTarget.select()} /></label>}
    </div>
    <details ref={detailsRef} className="dc-report-details" id="dc-finding-details"><summary>See all findings and scoring details</summary>
      <section data-ui-component-content="all-findings"><h2 data-ui-copy="heading">All findings</h2>
        <ol className="dc-findings-list">{result.rankedFindings.map((f,i) => { const item = presentFinding(f,result.redFlagPanel.activeFlags); return <li id={`dc-finding-${i}`} tabIndex={-1} key={i} className="dc-finding-item" data-ui-component-content="detail-finding">
          <h3 data-ui-copy="heading">{f.label}</h3><p data-ui-copy="body">{item.evidence}</p><p data-ui-copy="body">{item.copy.action}</p><p data-ui-copy="supporting">{f.dimension} · {item.status} · {item.copy.owner}</p>
        </li>; })}</ol>
        <h3 data-ui-copy="heading">All detected flags</h3><ul>{result.redFlagPanel.activeFlags.map(f => {
          const item = presentFinding({dimension:"",label:f.label,severity:"flag",flagKey:f.key,evidence:f.detail,opportunity:"",estimatedEffort:"low"},result.redFlagPanel.activeFlags);
          return <li id={`dc-flag-${f.key}`} tabIndex={-1} key={f.key} data-ui-component-content="detail-flag"><p data-ui-copy="body"><strong>{f.label}</strong> ({f.classification}; {item.status}). {item.evidence}</p><p data-ui-copy="body">{item.copy.action}</p></li>;
        })}</ul>
      </section>
      <section data-ui-component-content="scoring-details"><h2 data-ui-copy="heading">Scoring details</h2><p data-ui-copy="body">Current: {result.letterGrade}, {result.score}/100. Uncapped score: {result.uncappedScore}/100.</p><p data-ui-copy="body">Calculated scenario: {result.attainable.letterGrade}, {result.attainable.score}/100. This is a calculation, not a promised result.</p>
        <ul>{result.dimensionBar.map(d => <li key={d.name} data-ui-component-content="detail-dimension"><p data-ui-copy="body">{d.name}: {d.score === null ? "Not applicable on this page" : `${d.score}/100`}</p></li>)}</ul>
        <p data-ui-copy="body">Not applicable: {result.notApplicableDimensions.join(", ") || "None reported"}.</p><p data-ui-copy="body">Not measured: {result.notMeasuredDimensions.join(", ") || "None reported"}.</p><p data-ui-copy="body">{coverageText(result)}</p>
        <h3 data-ui-copy="heading">Not checked in this version</h3><ul>{result.redFlagPanel.notCheckableInV1.map(n => <li key={n.key} data-ui-component-content="detail-unchecked"><p data-ui-copy="body">{n.label}: {n.reason}</p></li>)}</ul>
      </section>
    </details>
  </div>;
}
