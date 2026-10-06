import type { DesiredClientAnswers } from "./types";

export interface CalculatedContribution {
  label: "Contribution before overhead and acquisition costs";
  amount: string;
  margin: { label: "Contribution margin on collected fees"; amount: string } | null;
  currency: string;
  basis: "firm_reported_recorded" | "firm_reported_estimate";
  scope: "per matter";
}

function amountInCents(value: string): number | null {
  const input = value.trim();
  // Accept a single non-negative amount, with either no grouping or valid
  // thousands groups. Do not turn a range or malformed "1,2" into a number.
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.replace(/,/g, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Read the sign from the source amounts, not from locale-formatted currency text. */
export function hasNegativeContribution(answers: DesiredClientAnswers): boolean {
  const fee = amountInCents(answers.value.fee_amount);
  const cost = amountInCents(answers.value.direct_cost_amount);
  return fee !== null && cost !== null && fee < cost;
}

/** Calculate only when the firm supplied comparable, single per-matter amounts. */
export function calculateContribution(answers: DesiredClientAnswers): CalculatedContribution | null {
  const fee = amountInCents(answers.value.fee_amount);
  const cost = amountInCents(answers.value.direct_cost_amount);
  const currency = answers.value.currency.trim().toUpperCase();
  if (fee === null || cost === null || answers.value.amount_scope !== "per_matter" || !["recorded", "estimated"].includes(answers.value.amount_basis ?? "") || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    const contributionCents = fee - cost;
    const magnitude = new Intl.NumberFormat("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(contributionCents) / 100);
    const currencyLabel = currency === "CAD" ? "C$" : `${currency} `;
    const formatted = `${contributionCents < 0 ? "−" : ""}${currencyLabel}${magnitude}`;
    const margin = fee > 0
      ? { label: "Contribution margin on collected fees" as const, amount: new Intl.NumberFormat("en-CA", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(contributionCents / fee).replace(/^-/, "−") }
      : null;
    return { label: "Contribution before overhead and acquisition costs", amount: formatted, margin, currency, basis: answers.value.amount_basis === "recorded" ? "firm_reported_recorded" : "firm_reported_estimate", scope: "per matter" };
  } catch {
    return null;
  }
}
