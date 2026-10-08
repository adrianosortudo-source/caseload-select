"use client";

import Image from "next/image";

import { useMemo, useRef, useState } from "react";
import { buildBlueprintViewModel, EVIDENCE_BASIS_LABELS, REPORT_EDIT_LINKS } from "@/lib/desired-client/blueprint";
import { createHtmlDownload, createProfileDownload } from "@/lib/desired-client/export";
import { COMMON_COPY, REPORT_FOOTNOTE_COPY, REVIEW_COPY } from "@/lib/desired-client/copy";
import type { ClarificationCode, DesiredClientAnswers, DesiredClientBrief, DesiredClientBriefV4, SavedBrief } from "@/lib/desired-client/types";
import { ConfirmationDialog } from "./ConfirmationDialog";

function definitionSegments(sentence: string, components: DesiredClientBrief["definition_components"] | DesiredClientBriefV4["definition_components"]) {
  const matches = Object.entries(components)
    .map(([key, statement]) => ({ key, text: statement.text.trim(), start: statement.text.trim() ? sentence.indexOf(statement.text.trim()) : -1 }))
    .filter((part) => part.start >= 0)
    .sort((a, b) => a.start - b.start);
  const parts: Array<{ text: string; key?: string }> = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) parts.push({ text: sentence.slice(cursor, match.start) });
    parts.push({ text: sentence.slice(match.start, match.start + match.text.length), key: match.key });
    cursor = match.start + match.text.length;
  }
  if (cursor < sentence.length) parts.push({ text: sentence.slice(cursor) });
  return parts.map((part, index) => part.key
    ? <strong key={`${part.key}-${index}`}>{part.text}</strong>
    : <span key={`plain-${index}`}>{part.text}</span>);
}

function saveDownload(filename: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sourceSnapshotRows(saved: SavedBrief, brief: NonNullable<Extract<SavedBrief["brief"], { report_version: "dcm-blueprint-v1" }>>) {
  const snapshot = saved.sourceAnswersSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !("schema_version" in snapshot) || snapshot.schema_version !== "dcm-v2.2") return [];
  const statements = [brief.portrait, brief.client_need, brief.firm_value, brief.marketing.message, brief.marketing.content, brief.marketing.next_step, ...brief.open_questions];
  const paths = [...new Set(statements.flatMap((item) => item.source_answer_ids))];
  return paths.map((path) => {
    let current: unknown = snapshot;
    for (const segment of path.split(".")) {
      if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, segment)) { current = null; break; }
      current = (current as Record<string, unknown>)[segment];
    }
    const answer = Array.isArray(current)
      ? current.map((item) => typeof item === "string" ? item.replaceAll("_", " ") : "").filter(Boolean).join(", ")
      : typeof current === "string" ? current.replaceAll("_", " ")
        : typeof current === "number" || typeof current === "boolean" ? String(current) : "Not recorded";
    return { path, answer };
  });
}

export function BriefView({
  saved,
  answers,
  reviewed,
  onReview,
  onEdit,
  onAnother,
  onClear,
  onRetry = () => undefined,
  analysisLoading = false,
  analysisError = "",
  retryAllowed = false,
  providerCallsUsed = 0,
  providerCallLimit = 3,
  storageWarning,
}: {
  saved: SavedBrief;
  answers: DesiredClientAnswers;
  dismissedCode: ClarificationCode | null;
  reviewed: boolean;
  onReview: (v: boolean) => void;
  onEdit: (stage: 1 | 2 | 3 | 4 | 5 | 6) => void;
  onAnother: () => void;
  onClear: () => void;
  onRetry?: () => void;
  analysisLoading?: boolean;
  analysisError?: "" | "unavailable" | "invalid" | "providerCallLimitReached";
  retryAllowed?: boolean;
  providerCallsUsed?: number;
  providerCallLimit?: number;
  storageWarning: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [htmlFailed, setHtmlFailed] = useState(false);
  const [confirm, setConfirm] = useState<"another" | "clear" | null>(null);
  const fallback = useRef<HTMLTextAreaElement>(null);
  const legacyBrief = saved.brief.report_version === "dcm-blueprint-v1" ? saved.brief : null;
  const currentBrief = saved.brief.report_version === "dcm-blueprint-v2" || saved.brief.report_version === "dcm-blueprint-v3" || saved.brief.report_version === "dcm-blueprint-v4" ? saved.brief : null;
  const legacy = legacyBrief !== null;
  const model = useMemo(() => currentBrief ? buildBlueprintViewModel(currentBrief, answers, {
    mode: saved.mode,
    generatedAt: saved.generatedAt,
    wordingReviewed: reviewed,
    recoveredSections: saved.recoveredSections,
    openClarificationCode: saved.openClarificationCode,
  }) : null, [saved, answers, reviewed, currentBrief]);
  const text = createProfileDownload(saved, answers).content;

  async function copyProfile() {
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopyFailed(true);
      window.setTimeout(() => {
        fallback.current?.focus();
        fallback.current?.select();
      }, 0);
    }
  }

  function downloadHtml() {
    setHtmlFailed(false);
    try {
      const file = createHtmlDownload(saved, answers);
      saveDownload(file.filename, file.content, file.mimeType);
    } catch {
      setHtmlFailed(true);
    }
  }

  const report = legacyBrief;
  return <article className={`dc-brief${legacy ? " dc-brief--legacy" : " dc-brief--blueprint"}`} data-ui-component-content="desired-client-blueprint">
    <header className="dc-brief__header" data-ui-component-content="desired-client-blueprint-header">
      <Image className="dc-report-logo" src="/brand/logos/lockup-horizontal-tagline-light-transparent.png" alt="CaseLoad Select. Sign better cases." width={240} height={48} unoptimized />
      {legacy
        ? <><p className="dc-eyebrow" data-ui-copy="supporting">ORIGINAL REPORT VERSION</p><h1 data-ui-copy="heading">Desired Client Blueprint</h1><p className="dc-report-status" data-ui-copy="supporting">Original dcm-blueprint-v1 · {saved.mode === "ai" ? "AI-assisted" : "Structured"} · {new Date(saved.generatedAt).toLocaleDateString("en-CA")}</p></>
        : <><p className="dc-eyebrow" data-ui-copy="supporting">CASELOAD SELECT · DESIRED CLIENT &amp; MATTER BLUEPRINT</p><h1 data-ui-copy="heading">{model!.title}</h1><p className="dc-report-meta" data-ui-copy="supporting">{model!.modeLabel} · Created {model!.date}</p><div className="dc-report-status"><strong data-ui-copy="supporting">{model!.status}</strong><span data-ui-copy="supporting">{model!.evidenceStatus}</span></div></>}
    </header>
    {storageWarning && <p className="dc-alert dc-screen-only" data-ui-copy="supporting">This browser could not save your progress. You can still finish and download your blueprint.</p>}
    {analysisLoading && <p className="dc-alert dc-screen-only" role="status" data-ui-copy="supporting">{COMMON_COPY.previousBlueprintAvailable}</p>}
    {analysisError === "unavailable" && <p className="dc-alert dc-screen-only" role="alert" data-ui-copy="supporting">{COMMON_COPY.aiUnavailable} {COMMON_COPY.previousBlueprintAvailable}</p>}
    {analysisError === "invalid" && <p className="dc-alert dc-screen-only" role="alert" data-ui-copy="supporting">{COMMON_COPY.aiInvalid} {COMMON_COPY.previousBlueprintAvailable}</p>}
    {analysisError === "providerCallLimitReached" && <p className="dc-alert dc-screen-only" role="alert" data-ui-copy="supporting">{COMMON_COPY.providerCallLimitReached}</p>}
    {(analysisLoading || analysisError) && <p className="dc-report-meta dc-screen-only" role="status" data-ui-copy="supporting">{COMMON_COPY.providerCallsUsed(providerCallsUsed, providerCallLimit)}</p>}
    {analysisError && retryAllowed && <div className="dc-actions dc-screen-only"><button type="button" className="dc-button dc-button--primary" onClick={onRetry}>{REVIEW_COPY.tryAgain}</button></div>}
    {!legacy && saved.refreshedFrom && <p className="dc-alert dc-report-refresh" role="status" data-ui-component-content="desired-client-report-refresh" data-ui-copy="supporting">{saved.refreshedFrom.mode === "ai" ? "This saved AI blueprint was revalidated from its saved answers" : "This saved structured blueprint was rebuilt from its saved answers"} on {new Date(saved.generatedAt).toLocaleDateString("en-CA")}. {saved.refreshedFrom.mode === "structured" ? "No AI generation was used. " : "No new AI request was made. "}The wording changed during the refresh, so review it again. The earlier version was {saved.refreshedFrom.wordingReviewed ? "marked as reviewed" : "not marked as reviewed"}. {reviewed ? "You have reviewed the refreshed wording." : "Review this refreshed wording before using it in marketing."}</p>}
    {legacy && report ? <>
      <section className="dc-report-definition" data-ui-component-content="desired-client-legacy-definition"><h2 data-ui-copy="supporting">Desired client portrait</h2><p data-ui-copy="body">{report.portrait.text}</p><span className="dc-evidence-label">Original classification: {report.portrait.kind}</span></section>
      <div className="dc-report-cards dc-report-cards--legacy">
        <section className="dc-report-card"><h2 data-ui-copy="heading">Client need</h2><p data-ui-copy="body">{report.client_need.text}</p><span className="dc-evidence-label">Original classification: {report.client_need.kind}</span></section>
        <section className="dc-report-card"><h2 data-ui-copy="heading">Firm value</h2><p data-ui-copy="body">{report.firm_value.text}</p><span className="dc-evidence-label">Original classification: {report.firm_value.kind}</span></section>
        <section className="dc-report-card dc-report-card--wide"><h2 data-ui-copy="heading">Marketing direction</h2><div className="dc-legacy-list">{([["Message", report.marketing.message], ["Content", report.marketing.content], ["Next step", report.marketing.next_step]] as const).map(([label, item]) => <p key={label} data-ui-copy="body"><strong>{label}:</strong> {item.text}</p>)}</div></section>
        <section className="dc-report-card dc-report-card--wide"><h2 data-ui-copy="heading">Open questions</h2>{report.open_questions.length ? <ul>{report.open_questions.map((item, index) => <li key={`${index}-${item.text}`}>{item.text}</li>)}</ul> : <p>No open questions were recorded.</p>}</section>
      </div>
      <p className="dc-report-footnote" data-ui-copy="supporting">This saved report remains in its original version. Create a new blueprint to use the current six-card format.</p>
      {saved.sourceAnswersSnapshot && <details className="dc-report-supporting dc-screen-only"><summary>Original answer sources</summary><ul>{sourceSnapshotRows(saved, report).map((row) => <li key={row.path}><strong>{row.path.replaceAll(".", " · ").replaceAll("_", " ")}:</strong> {row.answer}</li>)}</ul></details>}
    </> : model && <>
      <section className="dc-report-definition" data-ui-component-content="desired-client-definition">
        <h2 data-ui-copy="supporting">Client definition</h2>
        <p data-ui-copy="body">{definitionSegments(model.definition, model.definitionComponents)}</p>
      </section>
      <section className="dc-definition-review dc-screen-only" aria-labelledby="dc-definition-review-title" data-ui-component-content="desired-client-definition-review">
        <h2 id="dc-definition-review-title" data-ui-copy="heading">Does this describe the clients and work your firm wants more of?</h2>
        <div className="dc-definition-review__actions">
          <button className="dc-button dc-button--primary" type="button" onClick={() => onReview(true)}>{reviewed ? "This definition reflects our direction" : "Yes, this reflects our direction"}</button>
          <button className="dc-button dc-button--secondary" type="button" onClick={() => onEdit(2)}>Edit the definition</button>
        </div>
        <p className="dc-report-review__note" data-ui-copy="supporting">Confirming this wording records a review of the definition only. It does not verify the firm&apos;s experience, economics, market demand, or proposed target.</p>
      </section>
      {model.conditions.length > 0 && <section className="dc-report-conditions" aria-labelledby="dc-conditions-title" data-ui-component-content="desired-client-conditions">
        <h2 id="dc-conditions-title" data-ui-copy="heading">Conditions and unresolved questions</h2>
        <p data-ui-copy="supporting">Resolve these constraints or evidence gaps before treating this direction as ready to grow.</p>
        <ul data-ui-component-content="desired-client-condition-list">{model.conditions.map((condition, index) => <li key={`${index}-${condition}`} data-ui-copy="body">{condition}</li>)}</ul>
      </section>}
      <section className="dc-report-progress" aria-labelledby="dc-progress-title" data-ui-component-content="desired-client-progress-review">
        <h2 id="dc-progress-title" data-ui-copy="heading">Progress review</h2>
        <dl>
          <div><dt>Measure</dt><dd>{model.progressReview.metric}</dd></div>
          <div><dt>Target</dt><dd>{model.progressReview.target}</dd></div>
          <div><dt>Review period</dt><dd>{model.progressReview.reviewPeriod}</dd></div>
          <div><dt>Status</dt><dd>{model.progressReview.status}</dd></div>
        </dl>
      </section>
      {model.decisionPathway && <section className="dc-report-decision-pathway" aria-labelledby="dc-decision-pathway-title" data-ui-component-content="desired-client-decision-pathway">
        <div className="dc-report-decision-pathway__heading"><h2 id="dc-decision-pathway-title" data-ui-copy="heading">Client decision pathway</h2><span data-ui-copy="supporting">Separate working interpretation · review with the firm</span></div>
        <div className="dc-report-decision-pathway__steps">{([
          ["Situation / trigger", model.decisionPathway.trigger],
          ["First contact", model.decisionPathway.first_contact],
          ["Decision", model.decisionPathway.decision],
          ["Desired progress", model.decisionPathway.desired_progress],
        ] as const).map(([label, statement]) => <div className="dc-report-decision-pathway__step" data-ui-component-content="desired-client-pathway-step" key={label}>
          <h3 data-ui-copy="supporting">{label}</h3><p data-ui-copy="body">{statement.text}</p><span className="dc-evidence-label" data-ui-copy="supporting">{EVIDENCE_BASIS_LABELS[statement.evidence_basis]}</span>
        </div>)}</div>
      </section>}
      <div className="dc-report-cards" data-ui-component-content="desired-client-blueprint-cards">
        {model.cards.map((card) => <section className="dc-report-card" key={card.id} data-ui-component-content={`desired-client-card-${card.id}`}>
          <h2 data-ui-copy="heading">{card.title}</h2>
          {card.recoveryDisclosure && <div className="dc-report-recovery" data-ui-component-content="desired-client-recovery-disclosure">
            <strong data-ui-copy="supporting">{card.recoveryDisclosure.label}</strong>
            <p className="text-pretty" data-ui-copy="supporting">{card.recoveryDisclosure.description}</p>
          </div>}
          <div className="dc-report-card__claims">
            {card.claims.map((claim, index) => <div className="dc-report-claim" data-ui-component-content="desired-client-report-claim" key={`${card.id}-${index}`}>
              <p data-ui-copy="body">{claim.text}</p>
              <span className="dc-evidence-label" data-ui-copy="supporting">{EVIDENCE_BASIS_LABELS[claim.evidence_basis]}</span>
            </div>)}
            {card.contribution && <div className="dc-calculated-metric">
              <strong>{card.contribution.label}</strong><span>{card.contribution.amount}</span>
              {card.contribution.margin ? <div className="dc-calculated-metric__margin"><strong>{card.contribution.margin.label}</strong><span>{card.contribution.margin.amount}</span></div> : <small>Contribution margin not calculated because collected fees are zero.</small>}
              <small>{EVIDENCE_BASIS_LABELS[card.contribution.basis]} · {card.contribution.scope}. Calculated as collected fees less direct delivery costs; overhead and acquisition costs are excluded. This is not net profit.</small>
            </div>}
            {card.opportunityBasis && <span className="dc-evidence-label dc-opportunity-basis">Numeric and source results: {card.opportunityBasis}</span>}
          </div>
        </section>)}
      </div>
      {saved.brief.report_version !== "dcm-blueprint-v4" && <section className="dc-report-open-questions" data-ui-component-content="desired-client-open-questions">
        <h2 data-ui-copy="heading">Points still to resolve</h2>
        {model.openQuestions.length ? <ul>{model.openQuestions.map((item, index) => <li key={`${index}-${item.text}`} data-ui-copy="body"><span>{item.text}</span><span className="dc-evidence-label">{EVIDENCE_BASIS_LABELS[item.evidence_basis]}</span></li>)}</ul> : <p data-ui-copy="body">No specific open question was recorded.</p>}
      </section>}
      <p className="dc-report-footnote" data-ui-copy="supporting">{REPORT_FOOTNOTE_COPY}</p>
      <details className="dc-report-supporting dc-screen-only">
        <summary>Supporting answers and sources</summary>
        <div className="dc-report-source-list">{model.sourceDetails.map((slot, slotIndex) => <section key={`${slotIndex}-${slot.slot}`}>
          <h3>{slot.slot}</h3>
          <p><span className="dc-evidence-label">{EVIDENCE_BASIS_LABELS[slot.statement.evidence_basis]}</span> {slot.statement.text}</p>
          {slot.answers.length > 0 && <ul>{slot.answers.map((source, index) => <li key={`${slotIndex}-${index}-${source.path}`}><strong>{source.question}:</strong> {source.answer ?? "Not supplied"}</li>)}</ul>}
        </section>)}</div>
        <h3>Answers supplied</h3><ul>{model.allAnswers.map((answer, index) => <li key={`${index}-${answer.question}`}><strong>{answer.question}:</strong> {answer.answer}</li>)}</ul>
      </details>
    </>}

    {legacy && <div className="dc-report-review dc-screen-only">
      <p data-ui-copy="body">Have you reviewed this draft wording?</p>
      <label className="dc-reviewed"><input type="checkbox" checked={reviewed} onChange={(event) => onReview(event.currentTarget.checked)} /><span>I have reviewed this original report wording.</span></label>
    </div>}
    {copied && <p role="status" className="dc-screen-only">Profile copied.</p>}
    {copyFailed && <><p role="status" className="dc-screen-only">The profile could not be copied automatically. Select and copy the profile text below.</p><textarea className="dc-screen-only" ref={fallback} aria-label="Select and copy profile" readOnly value={text} /></>}
    {htmlFailed && <p className="dc-alert dc-screen-only" role="status">The HTML report could not be prepared. Your answers are still saved.</p>}
    <div className="dc-actions dc-brief__actions dc-screen-only" aria-label="Blueprint actions">
      {!legacy && <button className="dc-button dc-button--primary" onClick={downloadHtml}>Download HTML report</button>}
      <button className="dc-button dc-button--secondary" onClick={copyProfile}>Copy profile</button>
      <button className="dc-button dc-button--secondary" onClick={() => window.print()}>Print blueprint</button>
    </div>
    {!legacy && <div className="dc-actions dc-report-edit-links dc-screen-only" aria-label="Edit blueprint answers">{REPORT_EDIT_LINKS.map(([stage, label]) => <button key={stage} className="dc-button dc-button--secondary" onClick={() => onEdit(stage)}>{label}</button>)}</div>}
    <div className="dc-actions dc-screen-only"><button className="dc-button dc-button--secondary" onClick={() => setConfirm("another")}>Start another</button><button className="dc-button dc-button--secondary" onClick={() => setConfirm("clear")}>Clear draft</button></div>
    {confirm && <ConfirmationDialog open onClose={() => setConfirm(null)} labelledBy="dc-confirm-title"><h2 id="dc-confirm-title">{confirm === "another" ? "Replace the draft saved in this browser?" : "Clear the draft and blueprint saved in this browser?"}</h2>{confirm === "another" && <p>Download your blueprint first if you want to keep a copy.</p>}<button className="dc-button dc-button--primary" onClick={() => { if (confirm === "another") onAnother(); else onClear(); setConfirm(null); }}>{confirm === "another" ? "Replace draft" : "Clear draft"}</button><button className="dc-button dc-button--secondary" onClick={() => setConfirm(null)}>Keep draft</button></ConfirmationDialog>}
  </article>;
}
