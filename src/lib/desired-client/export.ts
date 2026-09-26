import { BRIEF_SECTION_HEADINGS, getDismissedClarificationText } from "./brief";
import { BRIEF_COPY, REVIEW_COPY } from "./copy";
import { getWriteInAnswers } from "./write_ins";
import { getSourceDetails, STATEMENT_KIND_LABELS } from "./sources";
import type { DesiredClientAnswers, DesiredClientBrief, DesiredClientStatement, SavedBrief } from "./types";

const EMPTY_OPEN_QUESTIONS = "No unresolved core question was identified from these answers. This profile still needs to be tested against actual work and client feedback.";
const MISSING_SOURCE_ANSWER = "No answer supplied";
type BriefSection = { heading: string; statements: DesiredClientStatement[] };
type SourcePair = { question: string; answer: string };

function localDateStamp(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Escapes Markdown and HTML-significant punctuation while preserving literal text. */
export function escapeMarkdownLiteral(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|><&]/g, "\\$&").replace(/\r\n?|\n/g, "<br>");
}

export function briefSections(brief: DesiredClientBrief): BriefSection[] {
  const sections: BriefSection[] = [
    { heading: BRIEF_SECTION_HEADINGS[0], statements: [brief.definition] },
    { heading: BRIEF_SECTION_HEADINGS[1], statements: brief.client_goals },
    { heading: BRIEF_SECTION_HEADINGS[2], statements: brief.firm_reasons },
    { heading: BRIEF_SECTION_HEADINGS[3], statements: brief.delivery_conditions },
    { heading: BRIEF_SECTION_HEADINGS[4], statements: brief.evidence },
    { heading: BRIEF_SECTION_HEADINGS[5], statements: brief.open_questions },
    { heading: BRIEF_SECTION_HEADINGS[6], statements: [brief.marketing.topic, brief.marketing.inquiry_question, brief.marketing.validation_step] },
  ];
  if (brief.work_to_promote_less.length) sections.push({ heading: "Work to promote less", statements: brief.work_to_promote_less });
  return sections;
}

export function getServiceAreaNote(brief: DesiredClientBrief, answers: DesiredClientAnswers): string | null {
  const area = answers.focus.service_area.trim();
  if (!area) return "Service area not supplied.";
  const suppliedPhrase = `Service area supplied: ${area}.`;
  return brief.definition.text.toLowerCase().includes(area.toLowerCase()) ? null : suppliedPhrase;
}

export function getFirstContactNote(answers: DesiredClientAnswers): string | null {
  const contact = answers.situation.contact;
  if (!contact) return null;
  if (contact === "unknown") return "Who makes the first contact is still to be established.";
  const label = getSourceDetails("situation.contact", answers).answer;
  if (!label) return null;
  return answers.focus.route === "new" || answers.focus.route === "exploring"
    ? `Expected first contact: ${label}. This may be someone other than the client.`
    : `First contact: ${label}. This may be someone other than the client.`;
}

function normalized(text: string): string { return text.trim().replace(/\s+/g, " ").toLowerCase(); }

function presentationNotesFor(brief: DesiredClientBrief, notes: readonly string[]): string[] {
  const seen = new Set(brief.open_questions.map((item) => normalized(item.text)));
  const result: string[] = [];
  for (const value of notes.map((note) => note.trim()).filter(Boolean)) {
    const key = normalized(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function unresolvedNotesFor(saved: SavedBrief, notes: readonly string[]): string[] {
  const durableNote = saved.openClarificationCode ? getDismissedClarificationText(saved.openClarificationCode) : null;
  return presentationNotesFor(saved.brief, durableNote ? [...notes, durableNote] : notes);
}

function sourcePairs(statements: readonly DesiredClientStatement[], answers: DesiredClientAnswers): SourcePair[] {
  const pairs: SourcePair[] = [];
  const seen = new Set<string>();
  for (const statement of statements) for (const path of statement.source_answer_ids) {
    const detail = getSourceDetails(path, answers);
    const answer = detail.answer ?? MISSING_SOURCE_ANSWER;
    const key = `${normalized(detail.question)}\u0000${normalized(answer)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ question: detail.question, answer });
  }
  return pairs;
}

function plainStatement(statement: DesiredClientStatement): string {
  return `- ${STATEMENT_KIND_LABELS[statement.kind]}: ${statement.text}`;
}
function markdownStatement(statement: DesiredClientStatement): string {
  return `- **${STATEMENT_KIND_LABELS[statement.kind]}**: ${escapeMarkdownLiteral(statement.text)}`;
}

function plainSourceAppendix(sections: readonly BriefSection[], answers: DesiredClientAnswers): string[] {
  const parts: string[] = ["Source answers", ""];
  for (const section of sections) {
    const pairs = sourcePairs(section.statements, answers);
    if (!pairs.length) continue;
    parts.push(section.heading, ...pairs.map(({ question, answer }) => `- ${question}: ${answer}`), "");
  }
  return parts.length > 2 ? parts : [];
}

function markdownSourceAppendix(sections: readonly BriefSection[], answers: DesiredClientAnswers): string[] {
  const parts: string[] = ["## Source answers", ""];
  for (const section of sections) {
    const pairs = sourcePairs(section.statements, answers);
    if (!pairs.length) continue;
    parts.push(`### ${section.heading}`, "", ...pairs.map(({ question, answer }) => `- ${escapeMarkdownLiteral(question)}: ${escapeMarkdownLiteral(answer)}`), "");
  }
  return parts.length > 2 ? parts : [];
}

export function formatBriefText(
  saved: SavedBrief,
  answers: DesiredClientAnswers,
  now = new Date(),
  presentationNotes: readonly string[] = [],
): string {
  void now;
  const parts = [saved.mode === "ai" ? BRIEF_COPY.profileTitle : BRIEF_COPY.summaryTitle, saved.wordingReviewed ? BRIEF_COPY.reviewedExport : BRIEF_COPY.unreviewedExport,
    saved.mode === "ai" ? BRIEF_COPY.preparedAI : BRIEF_COPY.preparedStructured, ""];
  const sections = briefSections(saved.brief);
  for (const section of sections) {
    parts.push(section.heading);
    if (section.heading === BRIEF_SECTION_HEADINGS[0]) {
      const note = getServiceAreaNote(saved.brief, answers);
      if (note) parts.push(`- ${note}`);
      const contactNote = getFirstContactNote(answers);
      if (contactNote) parts.push(`- ${contactNote}`);
    }
    if (section.heading === BRIEF_SECTION_HEADINGS[5]) {
      const notes = unresolvedNotesFor(saved, presentationNotes);
      const statements = saved.brief.open_questions;
      if (statements.length) parts.push(...statements.map(plainStatement));
      else if (!notes.length) parts.push(`- ${EMPTY_OPEN_QUESTIONS}`);
      parts.push(...notes.map((note) => `- Still open: ${note}`));
    } else parts.push(...section.statements.map(plainStatement));
    parts.push("");
  }
  const ownAnswers = getWriteInAnswers(answers);
  if (ownAnswers.length) parts.push("Your own answers", ...ownAnswers.map(({label,text}) => "- " + label + ": " + text), "");
  parts.push(...plainSourceAppendix(sections, answers));
  parts.push(`Created ${localDateStamp(new Date(saved.generatedAt))}.`, REVIEW_COPY.draftFooter);
  return parts.join("\n").trim();
}

export function formatBriefMarkdown(
  saved: SavedBrief,
  answers: DesiredClientAnswers,
  now = new Date(),
  presentationNotes: readonly string[] = [],
): string {
  void now;
  const parts = [`# ${saved.mode === "ai" ? BRIEF_COPY.profileTitle : BRIEF_COPY.summaryTitle}`, "", `_${saved.wordingReviewed ? BRIEF_COPY.reviewedExport : BRIEF_COPY.unreviewedExport}_`,
    saved.mode === "ai" ? BRIEF_COPY.preparedAI : BRIEF_COPY.preparedStructured, ""];
  const sections = briefSections(saved.brief);
  for (const section of sections) {
    parts.push(`## ${section.heading}`, "");
    if (section.heading === BRIEF_SECTION_HEADINGS[0]) {
      const note = getServiceAreaNote(saved.brief, answers);
      if (note) parts.push(`- ${escapeMarkdownLiteral(note)}`);
      const contactNote = getFirstContactNote(answers);
      if (contactNote) parts.push(`- ${escapeMarkdownLiteral(contactNote)}`);
    }
    if (section.heading === BRIEF_SECTION_HEADINGS[5]) {
      const notes = unresolvedNotesFor(saved, presentationNotes);
      const statements = saved.brief.open_questions;
      if (statements.length) parts.push(...statements.map(markdownStatement));
      else if (!notes.length) parts.push(`- ${escapeMarkdownLiteral(EMPTY_OPEN_QUESTIONS)}`);
      parts.push(...notes.map((note) => `- Still open: ${escapeMarkdownLiteral(note)}`));
    } else parts.push(...section.statements.map(markdownStatement));
    parts.push("");
  }
  const ownAnswers = getWriteInAnswers(answers);
  if (ownAnswers.length) parts.push("## Your own answers", "", ...ownAnswers.map(({label,text}) => "- " + escapeMarkdownLiteral(label) + ": " + escapeMarkdownLiteral(text)), "");
  parts.push(...markdownSourceAppendix(sections, answers));
  parts.push(`Created ${localDateStamp(new Date(saved.generatedAt))}.`, escapeMarkdownLiteral(REVIEW_COPY.draftFooter));
  return `${parts.join("\n").trim()}\n`;
}

export function createMarkdownDownload(
  saved: SavedBrief,
  answers: DesiredClientAnswers,
  now = new Date(),
  presentationNotes: readonly string[] = [],
): { filename: string; content: string; mimeType: string } {
  return { filename: `desired-client-brief-${localDateStamp(now)}.md`, content: formatBriefMarkdown(saved, answers, now, presentationNotes), mimeType: "text/markdown;charset=utf-8" };
}
