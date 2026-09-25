import { describe, expect, it } from "vitest";
import { formatBriefMarkdown, formatBriefText, createMarkdownDownload, briefSections, escapeMarkdownLiteral } from "../export";
import { getSourceDetails, STATEMENT_KIND_LABELS } from "../sources";
import { emptyAnswers } from "../brief";
import type { AnswerReferencePath, DesiredClientBrief, DesiredClientStatement, SavedBrief } from "../types";

const long = (prefix: string) => `${prefix}${"x".repeat(180 - prefix.length)}`;
function fixture() {
  const answers = emptyAnswers();
  answers.focus = { area: "business", work: "business_agreements", work_other: "", service_area: "Ontario", certainty: "chosen", route: "established",
    comparison: { selected: "a", a: { work: "business_agreements", fee_effort: "worthwhile", team_fit: "proven", capacity: "room", evidence: "repeated" }, b: { work: "business_acquisitions", fee_effort: "scoped", team_fit: "stretch", capacity: "limited", evidence: "few" } } };
  answers.situation = { timing: "planning", role: "business_organization", role_other: "", contact: "owner" };
  answers.client = { goals: ["understand"], concerns: ["next"] };
  answers.value = { reasons: ["skills"], fee_effort: "worthwhile", collected_fee: "2to5", team_hours: "upto5", payment: "varies" };
  answers.delivery = { conditions: ["time"], capacity: "room", limit: "fees" };
  answers.direction = { aim: "more_current", evidence: ["repeated"], less: "within", less_note: "Other contracts" };
  answers.clarifications = { FOCUS_UNCLEAR: null, CLIENT_GOAL_UNCLEAR: "understand", CURRENT_CAPACITY_CONFLICT: null, FEE_EFFORT_CONFLICT: null, EXPERIENCE_DIRECTION_CONFLICT: null };
  const statement = (text: string, kind: DesiredClientStatement["kind"], paths: AnswerReferencePath[] = ["focus.work"]): DesiredClientStatement => ({ text, kind, source_answer_ids: paths });
  const brief: DesiredClientBrief = {
    definition: statement("The firm wants to explore Business agreements for a business. Service area supplied: Ontario.", "experience", ["focus.work", "focus.service_area"]),
    client_goals: [statement("Understand the options", "preference", ["client.goals"])],
    firm_reasons: [statement("It uses work we do well", "experience", ["value.reasons"])],
    delivery_conditions: [statement("Enough time", "hypothesis", ["delivery.conditions"])],
    evidence: [statement("Several matters", "preference", ["direction.evidence"])],
    open_questions: [],
    marketing: { topic: statement("Plain-language explanation", "suggestion", ["focus.work"]), inquiry_question: statement("What do you hope to achieve?", "suggestion", ["client.goals"]), validation_step: statement("Review relevant examples", "suggestion", ["direction.aim"]) },
    work_to_promote_less: [statement("Work to promote less: Other work. " + long("optional-"), "preference", ["direction.less", "direction.less_note"])],
  };
  const saved: SavedBrief = { brief, sourceBriefRevision: answers.revision, generatedAt: "2025-06-12T12:00:00.000Z", wordingReviewed: false, mode: "ai" };
  return { answers, brief, saved, statement };
}

describe("Desired Client exports", () => {
  it("keeps all seven sections and puts optional less-promoted work in its own eighth section", () => {
    const { brief } = fixture();
    const sections = briefSections(brief);
    expect(sections.map((section) => section.heading)).toEqual([
      "Work to pursue", "What the client wants to achieve", "Why this work appeals to your firm", "Conditions for delivering it well",
      "What supports this definition", "Still to check", "Use it in your marketing", "Work to promote less",
    ]);
    expect(sections[6].statements).toHaveLength(3);
    expect(sections[7].statements[0].text).toContain("optional-");
  });

  it("uses every kind label, source question and resolved answer without exposing source IDs", () => {
    const { answers, saved, statement } = fixture();
    saved.brief.client_goals.push(statement("To test", "hypothesis", ["situation.timing"]));
    saved.brief.client_goals.push(statement("Still open", "unknown", ["clarifications.CLIENT_GOAL_UNCLEAR"]));
    const text = formatBriefText(saved, answers);
    for (const label of Object.values(STATEMENT_KIND_LABELS)) expect(text).toContain(label);
    expect(text).toContain("Which type of work should we focus on?: Commercial agreement drafting and review");
    expect(text).toContain("Which result should this profile focus on?: Understand the options and decide what to do");
    expect(text).not.toContain("focus.work");
  });

  it("resolves every allowed source path to a human question and only selected comparison answers", () => {
    const { answers } = fixture();
    const paths: AnswerReferencePath[] = [
      "focus.area", "focus.work", "focus.work_other", "focus.service_area", "focus.certainty", "focus.route",
      "situation.timing", "situation.role", "situation.role_other", "situation.contact", "client.goals", "client.concerns",
      "value.reasons", "value.fee_effort", "value.collected_fee", "value.team_hours", "value.payment", "delivery.conditions",
      "delivery.capacity", "delivery.limit", "direction.aim", "direction.evidence", "direction.less", "direction.less_note",
      "clarifications.FOCUS_UNCLEAR", "clarifications.CLIENT_GOAL_UNCLEAR", "clarifications.CURRENT_CAPACITY_CONFLICT",
      "clarifications.FEE_EFFORT_CONFLICT", "clarifications.EXPERIENCE_DIRECTION_CONFLICT",
      "focus.comparison.a.work", "focus.comparison.a.fee_effort", "focus.comparison.a.team_fit", "focus.comparison.a.capacity", "focus.comparison.a.evidence",
      "focus.comparison.b.work", "focus.comparison.b.fee_effort", "focus.comparison.b.team_fit", "focus.comparison.b.capacity", "focus.comparison.b.evidence",
    ];
    for (const path of paths) {
      const detail = getSourceDetails(path, answers);
      expect(detail.question).not.toBe(path);
      expect(detail.question).not.toContain("clarifications.");
    }
    expect(getSourceDetails("focus.comparison.a.work", answers).answer).toBe("Commercial agreement drafting and review");
    for (const path of paths.filter((value) => value.startsWith("focus.comparison.b."))) expect(getSourceDetails(path, answers).answer).toBeNull();
  });

  it("preserves 180-character optional inputs, avoids duplicating a supplied service area, and separates creation and download dates", () => {
    const { answers, saved } = fixture();
    const area = long("Service area ");
    const work = long("Work description ");
    const role = long("Role description ");
    answers.focus.service_area = area;
    answers.focus.work = "other";
    answers.focus.work_other = work;
    answers.situation.role = "other";
    answers.situation.role_other = role;
    saved.brief.definition.text = `The firm explores ${work} for ${role}. Service area supplied: ${area}.`;
    saved.brief.definition.source_answer_ids = ["focus.work_other", "situation.role_other", "focus.service_area"];
    const now = new Date(2026, 8, 24, 12);
    const plain = formatBriefText(saved, answers, now);
    const download = createMarkdownDownload(saved, answers, now);
    expect(plain).toContain(work);
    expect(plain).toContain(role);
    expect(plain.match(/Service area supplied:/g)).toHaveLength(1);
    expect(plain).toContain("Created 2025-06-12.");
    expect(download.filename).toBe("desired-client-brief-2026-09-24.md");
  });

  it("escapes Markdown and HTML in supplied content and includes the exact draft footer", () => {
    const { answers, saved } = fixture();
    saved.brief.definition.text = "# Fake heading\n[Fake link](https://example.test) <script>alert(1)</script> & text";
    const markdown = formatBriefMarkdown(saved, answers);
    expect(markdown).toContain("\\# Fake heading<br>\\[Fake link\\]\\(https://example\\.test\\) \\<script\\>alert\\(1\\)\\</script\\> \\& text");
    expect(markdown).not.toContain("\n# Fake heading");
    expect(markdown).toContain(escapeMarkdownLiteral("A working definition based on your answers. It guides marketing priorities; a lawyer decides whether to accept an individual matter."));
  });

  it("shows the empty-check default only without dismissed notes and deduplicates transient notes", () => {
    const { answers, saved } = fixture();
    answers.focus.service_area = "";
    const now = new Date(2026, 8, 24);
    const empty = formatBriefText(saved, answers, now);
    const output = formatBriefText(saved, answers, now, ["Confirm capacity.", " Confirm   capacity. "]);
    expect(output).toContain("Service area not supplied.");
    expect(empty).toContain("No unresolved core question was identified from these answers. This profile still needs to be tested against actual work and client feedback.");
    expect(output).not.toContain("No unresolved core question was identified from these answers.");
    expect(output.match(/Still open: Confirm capacity\./g)).toHaveLength(1);
  });
});
