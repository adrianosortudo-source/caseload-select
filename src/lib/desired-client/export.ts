import { buildBlueprintViewModel, EVIDENCE_BASIS_LABELS } from "./blueprint";
import { getSourceDetails } from "./sources";
import type { AnswerReferencePath, DesiredClientAnswers, DesiredClientBrief, LegacyDesiredClientBriefV1, SavedBrief } from "./types";

const stamp = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const escapeMarkdown = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");

function isCurrentBrief(brief: SavedBrief["brief"]): brief is DesiredClientBrief {
  return brief.report_version === "dcm-blueprint-v2";
}

function currentView(saved: SavedBrief, answers: DesiredClientAnswers) {
  if (!isCurrentBrief(saved.brief)) throw new Error("The saved blueprint uses the original report version.");
  return buildBlueprintViewModel(saved.brief, answers, {
    mode: saved.mode,
    generatedAt: saved.generatedAt,
    wordingReviewed: saved.wordingReviewed,
    openClarificationCode: saved.openClarificationCode,
  });
}

function legacyText(brief: LegacyDesiredClientBriefV1): string {
  return [
    "Desired Client Blueprint · Original version",
    "",
    "DESIRED CLIENT PORTRAIT",
    brief.portrait.text,
    "",
    "CLIENT NEED",
    brief.client_need.text,
    "",
    "FIRM VALUE",
    brief.firm_value.text,
    "",
    "MARKETING DIRECTION",
    `Message: ${brief.marketing.message.text}`,
    `Content: ${brief.marketing.content.text}`,
    `Next step: ${brief.marketing.next_step.text}`,
    "",
    "OPEN QUESTIONS",
    ...(brief.open_questions.length ? brief.open_questions.map((item) => `- ${item.text}`) : ["- None recorded"]),
  ].join("\n");
}

export function formatBriefText(saved: SavedBrief, answers: DesiredClientAnswers): string {
  if (!isCurrentBrief(saved.brief)) return legacyText(saved.brief);
  const view = currentView(saved, answers);
  return [
    view.title,
    view.status,
    view.evidenceStatus,
    `${view.modeLabel} · ${view.date}`,
    "",
    "OUR DESIRED-CLIENT DEFINITION",
    view.definition,
    ...view.cards.flatMap((card) => ["", card.title.toUpperCase(), ...card.claims.map((claim) => `${EVIDENCE_BASIS_LABELS[claim.evidence_basis]}: ${claim.text}`), ...(card.contribution ? [`${card.contribution.label}: ${card.contribution.amount} (${EVIDENCE_BASIS_LABELS[card.contribution.basis]}, ${card.contribution.scope})`] : [])]),
    "",
    "POINTS STILL TO RESOLVE",
    ...(view.openQuestions.length ? view.openQuestions.map((item) => `- ${item.text}`) : ["- No specific open question was recorded"]),
    "",
    "Evidence labels describe the source and certainty of the information. Firm-reported information has not been independently audited.",
  ].join("\n");
}

export function formatBriefMarkdown(saved: SavedBrief, answers: DesiredClientAnswers): string {
  if (!isCurrentBrief(saved.brief)) return `# Desired Client Blueprint · Original version\n\n${legacyText(saved.brief)}\n`;
  const view = currentView(saved, answers);
  const cards = view.cards.flatMap((card) => [
    `## ${card.title}`,
    "",
    ...card.claims.flatMap((claim) => [`**Evidence:** ${EVIDENCE_BASIS_LABELS[claim.evidence_basis]}`, "", claim.text, "", `**Sources:** ${claim.source_answer_ids.join(", ") || "No linked answer"}`, ""]),
    ...(card.contribution ? [`**${card.contribution.label}:** ${card.contribution.amount} (${EVIDENCE_BASIS_LABELS[card.contribution.basis]}, ${card.contribution.scope})`, ""] : []),
    ...(card.opportunityBasis ? [`**Numerical and source result basis:** ${card.opportunityBasis}`, ""] : []),
  ]);
  const sources = view.sourceDetails.flatMap((slot) => [
    `### ${slot.slot}`,
    "",
    `- **${EVIDENCE_BASIS_LABELS[slot.statement.evidence_basis]}:** ${slot.statement.text}`,
    ...slot.answers.map((source) => `- **${source.question}:** ${source.answer ?? "Not supplied"}`),
    "",
  ]);
  return [
    `# ${view.title}`,
    "",
    `_${view.status} · ${view.evidenceStatus}_`,
    "",
    `**${view.modeLabel} · ${view.date}**`,
    "",
    "## Our desired-client definition",
    "",
    view.definition,
    "",
    ...cards,
    "## Points still to resolve",
    "",
    ...(view.openQuestions.length ? view.openQuestions.map((item) => `- ${item.text}`) : ["- No specific open question was recorded"]),
    "",
    "## Supporting answers and sources",
    "",
    ...sources,
    ...view.allAnswers.map((answer) => `- **${escapeMarkdown(answer.question)}:** ${escapeMarkdown(answer.answer)}`),
    "",
    "Evidence labels describe source and certainty. Firm-reported information has not been independently audited.",
  ].join("\n");
}

function emphasizedSentence(sentence: string, components: DesiredClientBrief["definition_components"]): string {
  const parts = Object.entries(components)
    .map(([key, value]) => ({ key, phrase: value.text.trim(), start: value.text.trim() ? sentence.indexOf(value.text.trim()) : -1 }))
    .filter((part) => part.start >= 0)
    .sort((a, b) => a.start - b.start);
  const chunks: string[] = [];
  let cursor = 0;
  for (const part of parts) {
    if (part.start < cursor) continue;
    chunks.push(escapeHtml(sentence.slice(cursor, part.start)));
    chunks.push(`<strong data-definition-part="${escapeHtml(part.key)}">${escapeHtml(sentence.slice(part.start, part.start + part.phrase.length))}</strong>`);
    cursor = part.start + part.phrase.length;
  }
  chunks.push(escapeHtml(sentence.slice(cursor)));
  return chunks.join("");
}

function sourceMarkup(saved: SavedBrief, answers: DesiredClientAnswers): string {
  if (!isCurrentBrief(saved.brief)) {
    const sourceLinks = [...saved.brief.open_questions, saved.brief.portrait, saved.brief.client_need, saved.brief.firm_value,
      saved.brief.marketing.message, saved.brief.marketing.content, saved.brief.marketing.next_step];
    const unique = [...new Set(sourceLinks.flatMap((item) => item.source_answer_ids))];
    if (!saved.sourceAnswersSnapshot || !unique.length) return "<p>No original answer snapshot is available.</p>";
    const rows = unique.map((path) => `<li><strong>${escapeHtml(path.replaceAll("_", " "))}:</strong> ${escapeHtml(snapshotAnswer(saved.sourceAnswersSnapshot, path) ?? "Not recorded")}</li>`).join("");
    return `<h3>Original answer snapshot sources</h3><ul>${rows}</ul>`;
  }
  const view = currentView(saved, answers);
  const sources = view.sourceDetails.map((slot) => `<article class="source-entry"><h3>${escapeHtml(slot.slot)}</h3><p><span class="evidence">${escapeHtml(EVIDENCE_BASIS_LABELS[slot.statement.evidence_basis])}</span> ${escapeHtml(slot.statement.text)}</p><ul>${slot.answers.map((answer) => `<li><strong>${escapeHtml(answer.question)}:</strong> ${escapeHtml(answer.answer ?? "Not supplied")}</li>`).join("")}</ul></article>`).join("");
  const answersList = view.allAnswers.map((answer) => `<li><strong>${escapeHtml(answer.question)}:</strong> ${escapeHtml(answer.answer)}</li>`).join("");
  return `${sources}<h3>Answers supplied</h3><ul>${answersList}</ul>`;
}

function snapshotAnswer(snapshot: unknown, path: string): string | null {
  let current: unknown = snapshot;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, segment)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  if (Array.isArray(current)) return current.map((item) => typeof item === "string" ? item.replaceAll("_", " ") : "").filter(Boolean).join(", ") || null;
  if (typeof current === "string") return current.replaceAll("_", " ");
  if (typeof current === "number" || typeof current === "boolean") return String(current);
  return null;
}

function legacyHtml(brief: LegacyDesiredClientBriefV1, saved: SavedBrief, answers: DesiredClientAnswers): string {
  const statement = (label: string, item: LegacyDesiredClientBriefV1["portrait"]) => `<section class="legacy-card"><h2>${escapeHtml(label)}</h2><p>${escapeHtml(item.text)}</p><span class="evidence">${escapeHtml(item.kind)}</span></section>`;
  return `<header><p class="eyebrow">CASELOAD SELECT · ORIGINAL REPORT VERSION</p><h1>Desired Client Blueprint</h1><p>Original report · ${escapeHtml(saved.generatedAt.slice(0, 10))}</p></header><main><section class="definition"><h2>Desired client portrait</h2><p>${escapeHtml(brief.portrait.text)}</p></section><div class="cards">${statement("Client need", brief.client_need)}${statement("Firm value", brief.firm_value)}</div><section class="legacy-card"><h2>Marketing direction</h2><p><strong>Message:</strong> ${escapeHtml(brief.marketing.message.text)}</p><p><strong>Content:</strong> ${escapeHtml(brief.marketing.content.text)}</p><p><strong>Next step:</strong> ${escapeHtml(brief.marketing.next_step.text)}</p></section><section class="legacy-card"><h2>Open questions</h2>${brief.open_questions.map((item) => `<p>${escapeHtml(item.text)}</p>`).join("") || "<p>None recorded</p>"}</section><details class="supporting"><summary>Original answer sources</summary>${sourceMarkup(saved, answers)}</details><p class="footnote">This is the original dcm-blueprint-v1 report. It has not been rewritten as the current six-card blueprint.</p></main>`;
}

export function formatBriefHtml(saved: SavedBrief, answers: DesiredClientAnswers): string {
  const legacy = !isCurrentBrief(saved.brief);
  const body = legacy ? legacyHtml(saved.brief as LegacyDesiredClientBriefV1, saved, answers) : (() => {
    const view = currentView(saved, answers);
    const cards = view.cards.map((card) => `<section class="card"><h2>${escapeHtml(card.title)}</h2>${card.claims.map((claim) => `<div class="claim"><span class="evidence">${escapeHtml(EVIDENCE_BASIS_LABELS[claim.evidence_basis])}</span><p>${escapeHtml(claim.text)}</p></div>`).join("")}${card.contribution ? `<div class="calculated"><strong>${escapeHtml(card.contribution.label)}:</strong> ${escapeHtml(card.contribution.amount)} <span class="evidence">${escapeHtml(EVIDENCE_BASIS_LABELS[card.contribution.basis])}</span><small>Per matter</small></div>` : ""}${card.opportunityBasis ? `<p class="opportunity-basis">Numeric and source results: <span class="evidence">${escapeHtml(card.opportunityBasis)}</span></p>` : ""}</section>`).join("");
    const questions = view.openQuestions.length ? `<section class="open-questions"><h2>Points still to resolve</h2><ul>${view.openQuestions.map((item) => `<li>${escapeHtml(item.text)} <span class="evidence">${escapeHtml(EVIDENCE_BASIS_LABELS[item.evidence_basis])}</span></li>`).join("")}</ul></section>` : "";
    return `<header><p class="eyebrow">CASELOAD SELECT · DESIRED CLIENT &amp; MATTER BLUEPRINT</p><h1>${escapeHtml(view.title)}</h1><p class="meta">${escapeHtml(view.modeLabel)} · Created ${escapeHtml(view.date)}</p><p class="status"><strong>${escapeHtml(view.status)}</strong><span>${escapeHtml(view.evidenceStatus)}</span></p></header><main><section class="definition"><h2>Our desired-client definition</h2><p>${emphasizedSentence(view.definition, view.definitionComponents)}</p></section><div class="cards">${cards}</div>${questions}<p class="footnote">Evidence labels describe the source and certainty of the information. Firm-reported information has not been independently audited. The firm decides which matters to accept.</p><details class="supporting"><summary>Supporting answers and sources</summary>${sourceMarkup(saved, answers)}</details></main>`;
  })();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Desired Client Blueprint</title><style>
    :root{color-scheme:light;--navy:#1e2f58;--ink:#172033;--muted:#566276;--paper:#f4f3ef;--line:#d7d8dc;--accent:#f0c27a}*{box-sizing:border-box}body{margin:0;padding:2rem;background:var(--paper);color:var(--ink);font:16px/1.5 Arial,sans-serif}.page{width:min(100%,1000px);margin:auto;padding:2.25rem;background:white;border:1px solid var(--line);border-top:6px solid var(--navy);box-shadow:0 1rem 3rem #17203312}header{padding-bottom:1.25rem;border-bottom:1px solid var(--line)}.eyebrow{margin:0 0 .5rem;color:var(--navy);font-size:.72rem;font-weight:700;letter-spacing:.1em}.meta,.status span,.footnote{color:var(--muted);font-size:.9rem}h1,h2,h3,p{max-width:none}h1{margin:.15rem 0;font-size:2rem;line-height:1.16}h2{font-size:1.05rem;line-height:1.25}header .status{display:flex;flex-wrap:wrap;gap:.5rem 1rem;margin:.8rem 0 0}.status strong{color:var(--navy)}.definition{margin:1.25rem 0;padding:1rem 1.15rem;border-left:4px solid var(--accent);background:#f8f6f0}.definition h2{margin:0 0 .45rem;color:var(--navy);font-size:.78rem;letter-spacing:.06em;text-transform:uppercase}.definition p{margin:0;font-size:1.1rem;line-height:1.5}.definition strong{color:#112850}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.card,.legacy-card{break-inside:avoid;padding:1rem;border:1px solid var(--line);background:white}.card-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem}.card h2,.legacy-card h2{margin:0;color:var(--navy)}.card p,.legacy-card p{margin:.6rem 0 0;overflow-wrap:anywhere}.claim{padding-top:.45rem;border-top:1px solid var(--line)}.claim:first-of-type{padding-top:0;border:0}.calculated{display:grid;gap:.25rem;margin-top:.5rem;padding-top:.5rem;border-top:1px solid var(--line)}.calculated small{color:var(--muted)}.opportunity-basis{font-size:.85rem}.evidence{display:inline-block;flex:none;padding:.12rem .45rem;border:1px solid #cbd2de;border-radius:999px;color:#30415f;font-size:.72rem;line-height:1.5}.open-questions{margin-top:1rem;padding:.9rem 1rem;background:#f8f6f0}.open-questions h2{margin:0;color:var(--navy)}.open-questions ul{margin:.5rem 0 0;padding-left:1.2rem}.footnote{margin:1rem 0 0}.supporting{margin-top:1.25rem;padding-top:.75rem;border-top:1px solid var(--line)}.supporting summary{cursor:pointer;color:var(--navy);font-weight:700}.source-entry{margin:1rem 0}.source-entry h3{margin:0;font-size:.95rem}.source-entry p{margin:.25rem 0}.source-entry ul{margin:.25rem 0;padding-left:1.2rem}.legacy-card{margin:.75rem 0}.legacy-card .evidence{margin-top:.5rem}.legacy-card p+p{margin-top:.5rem}
    @media(max-width:650px){body{padding:.5rem}.page{padding:1rem}.cards{grid-template-columns:1fr}.card-heading{flex-wrap:wrap}h1{font-size:1.6rem}}
    @page{size:auto;margin:10mm}@media print{body{padding:0;background:white;font-size:9pt;line-height:1.35}.page{width:100%;max-width:none;margin:0;padding:0;border:0;box-shadow:none}header{padding-bottom:.5rem}h1{font-size:19pt}.meta,.status span,.footnote{font-size:8pt}.definition{margin:.55rem 0;padding:.6rem .75rem}.definition p{font-size:10pt;line-height:1.35}.cards{gap:.45rem}.card,.legacy-card{padding:.55rem}.card h2,.legacy-card h2{font-size:9.5pt}.card p,.legacy-card p{margin-top:.3rem;font-size:8.6pt;line-height:1.32}.evidence{font-size:7pt}.open-questions{margin-top:.5rem;padding:.5rem .7rem}.open-questions h2{font-size:9pt}.open-questions li{font-size:8pt}.footnote{margin-top:.5rem}.supporting{display:none!important}.legacy-card{margin:.45rem 0}}
  </style></head><body><article class="page">${body}</article></body></html>`;
}

export function createHtmlDownload(saved: SavedBrief, answers: DesiredClientAnswers, now = new Date()) {
  return { filename: `desired-client-blueprint-${stamp(now)}.html`, content: formatBriefHtml(saved, answers), mimeType: "text/html;charset=utf-8" };
}

export function createMarkdownDownload(saved: SavedBrief, answers: DesiredClientAnswers, now = new Date()) {
  return { filename: `desired-client-blueprint-supporting-detail-${stamp(now)}.md`, content: formatBriefMarkdown(saved, answers), mimeType: "text/markdown;charset=utf-8" };
}

export function createProfileDownload(saved: SavedBrief, answers: DesiredClientAnswers, now = new Date()) {
  return { filename: `desired-client-blueprint-${stamp(now)}.txt`, content: formatBriefText(saved, answers), mimeType: "text/plain;charset=utf-8" };
}

export function createAnswersDownload(answers: DesiredClientAnswers, now = new Date()) {
  const paths: AnswerReferencePath[] = [
    "focus.area", "focus.work", "focus.work_other", "focus.service_area", "focus.route",
    "practice.direction", "practice.firm_type", "practice.capability", "practice.enjoys",
    "client_context.geography", "client_context.relevant_circumstances", "client_context.community_focus", "client_context.language_service_needs", "client_context.repeat_matter_pattern",
    "situation.trigger", "write_ins.trigger", "situation.timing", "situation.role", "situation.role_other", "situation.contact",
    "client.goals", "write_ins.goals", "client.concerns", "write_ins.concerns", "client.decision_needs", "write_ins.decision_needs",
    "value.reasons", "write_ins.reasons", "value.fee_effort", "write_ins.fee_effort", "value.collected_fee", "value.team_hours", "value.payment", "value.currency", "value.fee_amount", "value.direct_cost_amount", "value.amount_basis", "value.amount_scope",
    "delivery.conditions", "write_ins.conditions", "delivery.capacity", "write_ins.capacity", "delivery.limit", "write_ins.limit", "delivery.fit_signals", "write_ins.fit_signals",
    "direction.aim", "write_ins.aim", "direction.evidence", "write_ins.evidence", "direction.less", "direction.less_note",
    "opportunity.sources", "opportunity.source_detail", "opportunity.period", "opportunity.enquiry_count", "opportunity.retained_count", "opportunity.conversion", "opportunity.acquisition_cost", "opportunity.uncertainty",
    "repeatability.success_measure", "repeatability.success_other", "repeatability.target", "repeatability.review_period", "repeatability.additional_matters", "repeatability.staffing_constraint",
  ];
  const rows = paths.flatMap((path) => {
    const source = getSourceDetails(path, answers);
    return source.answer === null ? [] : [`- **${source.question}**: ${source.answer}`];
  });
  return { filename: `desired-client-discovery-answers-${stamp(now)}.md`, mimeType: "text/markdown;charset=utf-8", content: ["# Desired Client Discovery Answers", "", "_Answer record only. A Desired Client Blueprint has not been generated._", "", `Exported: ${stamp(now)}`, "", ...rows, "", "This document records your answers. A Desired Client Blueprint has not been generated.", ""].join("\n") };
}
