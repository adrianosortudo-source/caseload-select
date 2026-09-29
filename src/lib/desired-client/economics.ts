import type { DesiredClientAnswers } from "./types";

export interface CalculatedContribution {
  label: "Contribution before overhead and acquisition costs";
  amount: string;
  currency: string;
  basis: "firm_reported_recorded" | "firm_reported_estimate";
  scope: "per matter";
}

function amount(value: string): number | null {
  const normalized = value.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Calculate only when the firm supplied comparable, single per-matter amounts. */
export function calculateContribution(answers: DesiredClientAnswers): CalculatedContribution | null {
  const fee = amount(answers.value.fee_amount);
  const cost = amount(answers.value.direct_cost_amount);
  const currency = answers.value.currency.trim().toUpperCase();
  if (fee === null || cost === null || answers.value.amount_scope !== "per_matter" || !["recorded", "estimated"].includes(answers.value.amount_basis ?? "") || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    const formatted = new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 2 }).format(fee - cost);
    return { label: "Contribution before overhead and acquisition costs", amount: formatted, currency, basis: answers.value.amount_basis === "recorded" ? "firm_reported_recorded" : "firm_reported_estimate", scope: "per matter" };
  } catch {
    return null;
  }
}
