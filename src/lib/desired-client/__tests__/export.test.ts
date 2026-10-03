import { describe, expect, it } from "vitest";
import { createAnswersDownload, createHtmlDownload, createProfileDownload, formatBriefHtml, formatBriefMarkdown, formatBriefText } from "../export";
import { getSourceDetails } from "../sources";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { completeAnswers, validBlueprint } from "./blueprint-helpers";
import type { LegacyDesiredClientBriefV1, SavedBrief } from "../types";
describe("Blueprint exports", () => {
  const setup = () => { const answers = completeAnswers(), saved: SavedBrief = { brief: buildStructuredBlueprintV4(answers), sourceAnswersSnapshot: answers, sourceAnswersVersion: "dcm-v3.2", sourceBriefRevision: answers.revision, generatedAt: "2026-09-26T12:00:00.000Z", wordingReviewed: false, mode: "structured" }; return { answers, saved }; };
  it("exports the synthesis and evidence cards, not an answer inventory", () => { const { answers, saved } = setup(), text = formatBriefText(saved, answers); expect(text).toContain((saved.brief as ReturnType<typeof buildStructuredBlueprintV4>).definition_sentence); expect(text).toContain("WHY THIS WORK"); expect(text).toContain("DESIRED CLIENT AND MATTER"); expect(text).toContain("EVIDENCE & OPEN QUESTIONS"); expect(text).not.toContain("What would you like the lawyer to help you with?"); });
  it("provides a print-ready HTML download with six cards and no PDF route", () => { const { answers, saved } = setup(), html = formatBriefHtml(saved, answers); expect(html).toContain("@media print"); expect(html).toContain("Evidence &amp; open questions"); expect(html).not.toContain("Download PDF"); expect(html).not.toContain("application/pdf"); const download = createHtmlDownload(saved, answers, new Date(2026, 8, 26)); expect(download.filename).toBe("desired-client-blueprint-2026-09-26.html"); expect(download.content).toBe(html); });
  it("keeps the client and matter distinct and the decision pathway separate in v4 outputs", () => {
    const { answers, saved } = setup();
    const html = formatBriefHtml(saved, answers);
    const text = formatBriefText(saved, answers);
    const markdown = formatBriefMarkdown(saved, answers);
    expect((html.match(/<section class="card">/g) ?? [])).toHaveLength(6);
    expect([...html.matchAll(/<section class="card"><h2>(.*?)<\/h2>/g)].map((match) => match[1])).toEqual([
      "Desired client and matter",
      "Client goals and needs",
      "Why this work",
      "Why clients choose the firm",
      "Matter signals",
      "Evidence &amp; open questions",
    ]);
    expect(html).toContain('<strong data-definition-part="client">');
    expect(html).toContain('<strong data-definition-part="client_matter">');
    expect(html).toContain('<section class="decision-pathway"');
    expect(html).toContain("Situation / trigger");
    expect(html).toContain("First contact");
    expect(html).toContain("Desired progress");
    expect(html).toContain("Client goals and needs");
    expect(html).toContain("Why clients choose the firm");
    expect(text).toContain("CLIENT TYPE");
    expect(text).toContain("CLIENT SITUATION AND MATTER");
    expect(text).toContain("CLIENT DECISION PATHWAY · WORKING INTERPRETATION");
    expect(markdown).toContain("## Client decision pathway · working interpretation");
    expect(markdown).toContain("## Client goals and needs");
    expect(html).not.toContain("Points still to resolve</h2>");
  });
  it("preserves uncertainty, capacity prerequisites, review period and newer answers in reports and answer downloads", () => {
    const answers=completeAnswers();
    answers.opportunity.uncertainty="We have not tested whether enough buyers are seeking this service.";
    answers.delivery.capacity="change";
    answers.repeatability.staffing_constraint="Reserve associate time before promoting additional matters.";
    answers.repeatability.review_period="Review after two quarters";
    answers.client.goal_detail="Understand liabilities and closing obligations before committing.";
    answers.client.decision_context="The owner and lender review the terms before signing.";
    answers.practice.client_strength_support="Clients have said our transaction explanations are clear.";
    answers.client_context.discovery_behaviour="They usually ask their accountant for a referral.";
    answers.repeatability.additional_matters="Two additional matters per quarter";
    const saved:SavedBrief={brief:buildStructuredBlueprintV4(answers),sourceAnswersSnapshot:answers,sourceAnswersVersion:"dcm-v3.2",sourceBriefRevision:answers.revision,generatedAt:"2026-09-26T12:00:00.000Z",wordingReviewed:false,mode:"structured"};
    for(const output of [formatBriefText(saved,answers),formatBriefMarkdown(saved,answers),formatBriefHtml(saved,answers)]) {
      expect(output).toContain("We have not tested whether enough buyers are seeking this service.");
      expect(output).toContain("Reserve associate time before promoting additional matters.");
      expect(output).toContain("Review after two quarters");
    }
    const allAnswers=createAnswersDownload(answers).content;
    for(const answer of [answers.client.goal_detail,answers.client.decision_context,answers.practice.client_strength_support,answers.client_context.discovery_behaviour,answers.repeatability.additional_matters]) expect(allAnswers).toContain(answer);
    expect(allAnswers).toContain(getSourceDetails("repeatability.additional_matters", answers).question);
    expect(getSourceDetails("repeatability.additional_matters", answers).question).not.toContain("per month");
  });
  it("keeps v1 reports visibly on the original-version rendering path", () => { const { answers, saved } = setup(); const statement = (text: string) => ({ text, kind: "preference" as const, source_answer_ids: ["focus.work" as const] }); const legacy: LegacyDesiredClientBriefV1 = { report_version: "dcm-blueprint-v1", portrait: statement("Original portrait"), client_need: statement("Original client need"), firm_value: statement("Original firm value"), marketing: { message: statement("Original message"), content: statement("Original content"), next_step: statement("Original next step") }, open_questions: [] }; const old: SavedBrief = { ...saved, brief: legacy, sourceAnswersVersion: "dcm-v2.2", sourceAnswersSnapshot: { focus: { work: "original source value" } } }; const text = formatBriefText(old, answers), html = formatBriefHtml(old, answers); expect(text).toContain("Original version"); expect(html).toContain("ORIGINAL REPORT VERSION"); expect(html).toContain("original source value"); expect(html).toContain("This is the original dcm-blueprint-v1 report"); expect(html).not.toContain("Practice we are building"); });
  it("uses neutral date-stamped HTML and text filenames", () => { const { answers, saved } = setup(), date = new Date(2026, 8, 26); expect(createProfileDownload(saved, answers, date).filename).toBe("desired-client-blueprint-2026-09-26.txt"); expect(createHtmlDownload(saved, answers, date).filename).toBe("desired-client-blueprint-2026-09-26.html"); });
});
