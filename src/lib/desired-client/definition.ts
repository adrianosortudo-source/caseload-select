import type { DesiredClientBrief } from "./types";

const clean = (value: string) => value.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");

/** Build the required opening sentence from the four source-linked components. */
export function buildDefinitionSentence(brief: DesiredClientBrief, confirmed: boolean): string {
  const { firm, client_matter, reasons, outcome } = brief.definition_components;
  const firmText = clean(firm.text) || "law firms";
  const clientText = clean(client_matter.text) || "a client situation and matter to be defined";
  const reasonText = clean(reasons.text) || "its economic and delivery reasons are still being established";
  const outcomeText = clean(outcome.text);
  const sentenceOutcome = outcomeText ? outcomeText[0].toLocaleLowerCase("en-CA") + outcomeText.slice(1) : "";
  const opening = `We help ${firmText} attract and respond to ${clientText}, which the firm wants more of because ${reasonText}`;
  if (outcome.evidence_basis === "unknown" || !outcomeText || outcomeText.toLowerCase().includes("still to be agreed")) {
    return `${opening}, with the measure of progress still to be agreed.`;
  }
  if (confirmed) return `${opening}, and we measure progress by ${sentenceOutcome}.`;
  return `${opening}, with ${sentenceOutcome} as the proposed measure of progress.`;
}
