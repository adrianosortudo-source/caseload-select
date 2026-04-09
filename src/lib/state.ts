export type LeadState =
  | "unaware"
  | "problem_aware"
  | "solution_aware"
  | "decision_ready"
  | "price_sensitive"
  | "delayed";

export type Intent = "researching" | "considering" | "ready_to_hire";

export const INTENT_OPTIONS: { value: Intent; label: string }[] = [
  { value: "researching", label: "Researching" },
  { value: "considering", label: "Considering" },
  { value: "ready_to_hire", label: "Ready to hire" },
];

export const LEAD_STATES: { value: LeadState; label: string }[] = [
  { value: "unaware", label: "Unaware" },
  { value: "problem_aware", label: "Problem aware" },
  { value: "solution_aware", label: "Solution aware" },
  { value: "decision_ready", label: "Decision ready" },
  { value: "price_sensitive", label: "Price sensitive" },
  { value: "delayed", label: "Delayed" },
];

export const STATE_STYLES: Record<LeadState, { bg: string; text: string; label: string }> = {
  unaware:         { bg: "bg-slate-100",   text: "text-slate-700",   label: "Unaware" },
  problem_aware:   { bg: "bg-sky-100",     text: "text-sky-700",     label: "Problem aware" },
  solution_aware:  { bg: "bg-violet-100",  text: "text-violet-700",  label: "Solution aware" },
  decision_ready:  { bg: "bg-emerald-100", text: "text-emerald-700", label: "Decision ready" },
  price_sensitive: { bg: "bg-amber-100",   text: "text-amber-700",   label: "Price sensitive" },
  delayed:         { bg: "bg-rose-100",    text: "text-rose-700",    label: "Delayed" },
};

export function intentToState(intent: Intent | null | undefined): LeadState {
  if (intent === "ready_to_hire") return "decision_ready";
  if (intent === "researching") return "solution_aware";
  return "problem_aware"; // considering / null / unknown
}
