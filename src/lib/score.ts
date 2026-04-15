import type { CaseType } from "./types";

// Phase 1 rules-based score, 1–100.
export function scoreLead(input: {
  case_type: CaseType | null;
  estimated_value: number | null;
  description: string | null;
}): number {
  let s = 40;
  const val = input.estimated_value ?? 0;
  if (val >= 100_000) s += 30;
  else if (val >= 25_000) s += 20;
  else if (val >= 5_000) s += 10;

  const typeBoost: Record<CaseType, number> = {
    immigration: 15,
    corporate: 20,
    family: 10,
    criminal: 10,
    other: 5,
  };
  if (input.case_type) s += typeBoost[input.case_type];

  const desc = (input.description ?? "").length;
  if (desc > 300) s += 10;
  else if (desc > 80) s += 5;

  return Math.max(1, Math.min(100, s));
}
