import type { VisualReview } from "@/lib/design-check/visual-review-types";
import { useRef, useState } from "react";
import { coverageText, presentFinding } from "./report-presentation";

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
  visualReview?: VisualReview;
  legacyUnavailable?: boolean;
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
  const [failedCaptures, setFailedCaptures] = useState<string[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "success" | "manual">("idle");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const review = result.visualReview;
  const count = review?.findings.length ?? 0;
  const changes = `${count} visual ${count === 1 ? "change" : "changes"} identified`;
  const verdict = !review || review.status === "unavailable" ? "Visual assessment unavailable." : review.status === "partial" ? `Visual assessment is incomplete. ${changes} in the available evidence.` : count ? `Desktop and mobile screenshots reviewed. ${changes}.` : "No specific visual issues identified in these captures.";
  const limitations = (review?.captures ?? []).map(c => {
    const r = review?.viewportReviews.find(x => x.captureId === c.id);
    const label = c.id === "desktop" ? "Desktop" : "Mobile";
    if (!c.available) {
      const why = c.reason === "image_too_large" ? "The image exceeded the size limit." : c.reason === "image_invalid" ? "The captured image could not be prepared." : c.reason === "payload_limit" ? "The image was removed to keep the report within its size limit." : "The capture was not available.";
      return `${label} capture unavailable. ${why}`;
    }
    if (!r) return `${label}: Captured, not visually assessed. ${review?.reasonCodes.includes("invalid_visual_response") ? "The visual assessment could not be validated." : "The visual assessment was unavailable."}`;
    if (r.pageKind !== "homepage") return `${label}: ${r.pageKind} page shown; normal homepage visual assessment was not possible.`;
    const clipped = c.totalHeight ? `${label} capture shows the top ${c.height} pixels of a ${c.totalHeight}-pixel page. ` : "";
    const unassessed = Object.entries(r.areas).filter(([, value]) => value === "not_assessable").map(([area]) => `${area.replaceAll("_", " ")}: ${r.areaReasons[area as keyof typeof r.areaReasons]}`);
    if (unassessed.length) return `${clipped}${label}: ${unassessed.join(" ")}`;
    return `${clipped}Homepage capture reviewed.`;
  });
  const coverage = (review?.viewportReviews ?? []).filter(r => r.pageKind === "homepage").map(r => `${r.captureId} areas assessed: ${Object.entries(r.areas).filter(([, status]) => status === "assessed").map(([area]) => area.replaceAll("_", " ")).join(", ") || "none"}.`);
  const plan = [result.domain, verdict, ...limitations, ...coverage, ...failedCaptures.map(id => `${id} screenshot could not be displayed; findings cannot be visually checked here.`), ...(review?.findings ?? []).flatMap(f => [`${f.captureId}: ${f.section}, ${f.element}`, f.visibleText ? `Visible text: ${f.visibleText}` : "", `Observed: ${f.observation}`, `Possible consequence: ${f.consequence}`, `Change: ${f.change}`, `Priority: ${f.priority}`, f.limitation ? `Limitation: ${f.limitation}` : ""]), ...(review?.strengths ?? []).map(s => `${s.captureId} strength, ${s.section}, ${s.element}${s.visibleText ? ` (visible text: ${s.visibleText})` : ""}: ${s.observation}`)].filter(Boolean).join("\n");
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(plan);
      setCopyState("success");
    } catch { setCopyState("manual"); requestAnimationFrame(() => fallbackRef.current?.focus()); }
  }
  return <div className="dc-report">
    <header className="dc-report-header" data-ui-component-content="report-summary">
      <div className="dc-report-identity"><div className="dc-report-meta"><p className="dc-report-domain">{result.domain}</p><p className="dc-report-date">Checked {new Date(result.checkedAt).toLocaleDateString()}</p></div><button type="button" className="dc-reset-btn" onClick={onReset}>Check another site</button></div>
      <h2 data-ui-copy="heading">Visual assessment</h2><p data-ui-copy="body">{verdict}</p>
      {!review && <p data-ui-copy="supporting">Visual assessment was not supplied with this report.</p>}
    </header>
    <section className="dc-visual-captures" data-ui-component-content="visual-captures"><h2 data-ui-copy="heading">Screenshots</h2>
      {(review?.captures ?? []).map((c, i) => <Capture key={c.id} capture={c} limitation={limitations[i]} assessment={review?.viewportReviews.find(r => r.captureId === c.id)} failed={failedCaptures.includes(c.id)} onFailure={() => setFailedCaptures(xs => xs.includes(c.id) ? xs : [...xs, c.id])} />)}
    </section>
    {!!review?.findings.length && <section className="dc-path-section" data-ui-component-content="visual-findings"><h2 data-ui-copy="heading">Visual changes</h2><ol className="dc-findings-list">{review.findings.map(f => <li key={f.id} className="dc-finding-item" data-ui-component-content="visual-finding"><h3 data-ui-copy="heading">{f.section}: {f.element}</h3><p data-ui-copy="supporting">{f.captureId} · {f.priority} priority</p>{f.visibleText && <p data-ui-copy="body"><strong>Visible text:</strong> {f.visibleText}</p>}<p data-ui-copy="body"><strong>Observed:</strong> {f.observation}</p><p data-ui-copy="body"><strong>Possible consequence:</strong> {f.consequence}</p><p data-ui-copy="body"><strong>Change:</strong> {f.change}</p>{f.limitation && <p data-ui-copy="supporting">{f.limitation}</p>}</li>)}</ol></section>}
    {!!review?.strengths.length && <section data-ui-component-content="visual-strengths"><h2 data-ui-copy="heading">Observed strengths</h2><ul>{review.strengths.map((s,i) => <li key={i} data-ui-component-content="visual-strength"><p data-ui-copy="body">{s.captureId}, {s.section}, {s.element}{s.visibleText ? ` (${s.visibleText})` : ""}: {s.observation}</p></li>)}</ul></section>}
    <div className="dc-report-actions"><button type="button" className="dc-reset-btn" onClick={copy}>Copy action plan</button><p role="status" aria-live="polite">{copyState === "success" ? "Action plan copied." : copyState === "manual" ? "Copy the action plan from the text below." : ""}</p>{copyState === "manual" && <label>Action plan for manual copy<textarea ref={fallbackRef} readOnly value={plan} rows={10} onFocus={e => e.currentTarget.select()} /></label>}</div>
    {result.legacyUnavailable ? <div data-ui-component-content="unavailable-checks"><p data-ui-copy="body">Other automated checks were unavailable because the desktop capture was unavailable.</p></div> :
    <details ref={detailsRef} className="dc-report-details" id="dc-finding-details" data-ui-component-content="automated-checks"><summary>Other automated checks</summary>
      <section data-ui-component-content="all-findings"><h2 data-ui-copy="heading">All findings</h2>
        <ol className="dc-findings-list">{result.rankedFindings.map((f,i) => { const item = presentFinding(f,result.redFlagPanel.activeFlags); return <li id={`dc-finding-${i}`} tabIndex={-1} key={i} className="dc-finding-item" data-ui-component-content="detail-finding">
          <h3 data-ui-copy="heading">{f.label}</h3><p data-ui-copy="body"><strong>Observed:</strong> {item.evidence}</p><p data-ui-copy="body"><strong>Recommended action:</strong> {item.copy.action}</p><p data-ui-copy="supporting">{f.dimension}</p><p data-ui-copy="supporting">{item.status}</p><p data-ui-copy="supporting">{item.copy.owner}</p>
        </li>; })}</ol>
        <h3 data-ui-copy="heading">All detected flags</h3><ul>{result.redFlagPanel.activeFlags.map(f => {
          const item = presentFinding({dimension:"",label:f.label,severity:"flag",flagKey:f.key,evidence:f.detail,opportunity:"",estimatedEffort:"low"},result.redFlagPanel.activeFlags);
          return <li id={`dc-flag-${f.key}`} tabIndex={-1} key={f.key} data-ui-component-content="detail-flag"><p data-ui-copy="body"><strong>{f.label}</strong></p><p data-ui-copy="supporting">{f.classification}</p><p data-ui-copy="supporting">{item.status}</p><p data-ui-copy="body"><strong>Observed:</strong> {item.evidence}</p><p data-ui-copy="body"><strong>Recommended action:</strong> {item.copy.action}</p></li>;
        })}</ul>
      </section>
      <section data-ui-component-content="scoring-details"><h2 data-ui-copy="heading">Combined automated score</h2><p data-ui-copy="body">Content and authority checks contribute to this score.</p><p data-ui-copy="body">Current: {result.letterGrade}, {result.score}/100.</p><p data-ui-copy="body">Uncapped score: {result.uncappedScore}/100.</p><p data-ui-copy="body">Calculated scenario: {result.attainable.letterGrade}, {result.attainable.score}/100.</p><p data-ui-copy="body"><strong>Scenario note:</strong> This is a calculation, not a promised result.</p>
        <dl className="dc-detail-scores">{result.dimensionBar.map(d => <div key={d.name}><dt>{d.name}</dt><dd>{d.score === null ? "Not applicable on this page" : `${d.score}/100`}</dd></div>)}</dl>
        <dl className="dc-detail-records"><div><dt>Not applicable</dt><dd>{result.notApplicableDimensions.join(", ") || "None reported"}</dd></div><div><dt>Not measured</dt><dd>{result.notMeasuredDimensions.join(", ") || "None reported"}</dd></div></dl><p data-ui-copy="body">{coverageText(result)}</p>
        <h3 data-ui-copy="heading">Not checked in this version</h3><ul>{result.redFlagPanel.notCheckableInV1.map(n => <li key={n.key} data-ui-component-content="detail-unchecked"><dl className="dc-detail-unchecked"><dt>{n.label}</dt><dd data-ui-copy="body">{n.reason}</dd></dl></li>)}</ul>
      </section>
    </details>}
  </div>;
}

function Capture({ capture: c, limitation, assessment, failed, onFailure }: { capture: NonNullable<DesignCheckResult["visualReview"]>["captures"][number]; limitation: string; assessment?: NonNullable<DesignCheckResult["visualReview"]>["viewportReviews"][number]; failed: boolean; onFailure: () => void }) {
  return <div className="dc-capture" data-ui-component-content="capture"><h3 data-ui-copy="heading">{c.id === "desktop" ? "Desktop" : "Mobile"} screenshot</h3><p data-ui-copy="supporting">{limitation}</p>{assessment?.pageKind === "homepage" && <p data-ui-copy="supporting">Areas assessed: {Object.entries(assessment.areas).filter(([,status]) => status === "assessed").map(([area]) => area.replaceAll("_", " ")).join(", ") || "None"}.</p>}{c.available && c.base64 && c.mimeType && !failed ? <><div className="dc-capture-preview"><img src={`data:${c.mimeType};base64,${c.base64}`} alt={`${c.id} screenshot preview`} onError={onFailure} /></div><p data-ui-copy="supporting">Top of screenshot preview</p><details><summary>View readable screenshot</summary><div className="dc-capture-scroll" tabIndex={0} aria-label={`${c.id} screenshot, scroll to inspect`}><img src={`data:${c.mimeType};base64,${c.base64}`} alt={`${c.id} captured page`} onError={onFailure} /></div></details></> : failed ? <p data-ui-copy="body" role="alert">Screenshot could not be displayed. Findings for this capture cannot be visually checked here.</p> : null}</div>;
}
