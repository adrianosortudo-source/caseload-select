import type { DesiredClientBrief, DesiredClientBriefV2, DesiredClientBriefV4 } from "./types";

const clean = (value: string) => value.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
const hasDecisionEndpoint = (value: string) => /\b(?:before|prior to)\b[^.!?,;]{0,70}\b(?:decid\w*|decision)\b[^.!?,;]{0,50}\bproceed\b/i.test(value);

function removeRepeatedDecisionEndpoint(benefit: string, matter: string): string {
  if (!hasDecisionEndpoint(benefit) || !hasDecisionEndpoint(matter)) return benefit;
  return benefit.replace(/(?:,\s*|\s+)(?:before|prior to)\s+[^.!?,;]{0,70}\b(?:decid\w*|decision)\b[^.!?,;]{0,50}\bproceed\b(?:\s+with\s+[^,.!?]+)?$/i, "").trim();
}

/** Build the required opening sentence from the four source-linked components. */
export function buildDefinitionSentence(brief: Pick<DesiredClientBrief | DesiredClientBriefV2, "definition_components"> | Pick<DesiredClientBriefV4,"definition_components">, _confirmed: boolean, clientBenefit = "", benefitUnknown = false): string {
  const { client_matter, reasons, outcome } = brief.definition_components;
  const clientText = clean(client_matter.text) || "a client situation and matter to be defined";
  const reasonText = clean(reasons.text) || "the firm's reasons are still being established";
  const outcomeText = clean(outcome.text);
  if ("client" in brief.definition_components) {
    const rawClientType = clean(brief.definition_components.client.text) || "the desired client type is still to be defined";
    const clientTypeWithArticle = rawClientType.replace(/^(A|An|The)\b/, article => article.toLowerCase());
    const singularRole = /^(owner or founder|owner|founder|buyer|seller|business owner|company owner|individual|entrepreneur|executive|shareholder|principal)\b/i.exec(rawClientType);
    const clientType = singularRole && !/^(a|an|the)\b/i.test(rawClientType)
      ? `${/^(owner or founder|owner|individual|entrepreneur|executive)\b/i.test(rawClientType) ? "an" : "a"} ${rawClientType[0].toLocaleLowerCase("en-CA") + rawClientType.slice(1)}`
      : clientTypeWithArticle;
    const definitionReason = reasonText.replace(/^(?:the firm (?:wants|prefers) this work )?because\s+/i, "").replace(/^(A|An|The)\b/, article => article.toLowerCase()).replace(/^it\b/i, "the work");
    const matterText = clean(client_matter.text) || "the specific matter details remain to be defined";
    const clientMatter = `in a situation where ${matterText[0].toLocaleLowerCase("en-CA") + matterText.slice(1)}`;
    const practicalBenefit = removeRepeatedDecisionEndpoint(clean(clientBenefit), matterText);
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
