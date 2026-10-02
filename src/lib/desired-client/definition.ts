import type { DesiredClientBrief, DesiredClientBriefV2, DesiredClientBriefV4 } from "./types";

const clean = (value: string) => value.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");

/** Build the required opening sentence from the four source-linked components. */
export function buildDefinitionSentence(brief: Pick<DesiredClientBrief | DesiredClientBriefV2, "definition_components"> | Pick<DesiredClientBriefV4,"definition_components">, _confirmed: boolean, clientBenefit = "", benefitUnknown = false): string {
  const { client_matter, reasons, outcome } = brief.definition_components;
  const clientText = clean(client_matter.text) || "a client situation and matter to be defined";
  const reasonText = clean(reasons.text) || "the firm's reasons are still being established";
  const outcomeText = clean(outcome.text);
  if ("client" in brief.definition_components) {
    const clientType = (clean(brief.definition_components.client.text) || "the desired client type is still to be defined").replace(/^(A|An|The)\b/, article => article.toLowerCase());
    const definitionReason = reasonText.replace(/^(?:the firm (?:wants|prefers) this work )?because\s+/i, "").replace(/^The firm\b/, "the firm");
    const matterText = clientText || "the client's situation and matter are still to be defined";
    const clientMatter = `for matters such as ${matterText[0].toLocaleLowerCase("en-CA") + matterText.slice(1)}`;
    const practicalBenefit = clean(clientBenefit);
    const alreadyIncluded = practicalBenefit && clientMatter.toLocaleLowerCase("en-CA").includes(practicalBenefit.toLocaleLowerCase("en-CA"));
    const benefitClause = practicalBenefit
      ? alreadyIncluded ? "" : `, so the client can ${practicalBenefit[0].toLocaleLowerCase("en-CA") + practicalBenefit.slice(1)}`
      : benefitUnknown ? ", with the practical benefit still to be established" : "";
    return `The firm wants to attract and serve ${clientType} ${clientMatter}${benefitClause}, because ${definitionReason}.`;
  }
  const sentenceOutcome = outcomeText ? outcomeText[0].toLocaleLowerCase("en-CA") + outcomeText.slice(1) : "";
  const opening = brief.definition_components && "firm" in brief.definition_components
    ? `We advise ${clientText} because ${reasonText}`
    : `We help ${clientText}; the firm wants more of this work because ${reasonText}`;
  if (outcome.evidence_basis === "unknown" || !outcomeText || outcomeText.toLowerCase().includes("still to be agreed")) {
    return brief.definition_components && "firm" in brief.definition_components
      ? `${opening}, with the measure of progress still to be agreed.`
      : `${opening}; a measure of progress is still to be agreed.`;
  }
  return brief.definition_components && "firm" in brief.definition_components
    ? `${opening}, with ${sentenceOutcome} proposed as a measure of progress.`
    : `${opening}; progress is proposed to be measured by ${sentenceOutcome}.`;
}
