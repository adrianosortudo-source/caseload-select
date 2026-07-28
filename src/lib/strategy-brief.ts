import type { StrategyBrief } from "@/lib/types";

export const STRATEGY_BRIEF_FIELDS = [
  ["readerAndSituation", "Reader and real situation"],
  ["workSupported", "Work this supports"],
  ["whyThisWeek", "Why this topic this week"],
  ["practicalAngle", "DRG’s practical angle"],
  ["authorityAndEvidence", "Authority and evidence"],
  ["websiteAndConversionRole", "Website and conversion role"],
] as const satisfies ReadonlyArray<readonly [keyof StrategyBrief, string]>;

export const STRATEGY_BRIEF_GUIDANCE: Record<keyof StrategyBrief, string> = {
  readerAndSituation: "Who the content is for and the real decision, pressure, or situation they are facing.",
  workSupported: "The DRG service, practice area, content cluster, or client journey this package advances.",
  whyThisWeek: "Why the subject matters now, including its business consequence and place in the editorial sequence.",
  practicalAngle: "The legal or commercial mechanisms DRG will help the reader understand and how they interact.",
  authorityAndEvidence: "The source material, legal authority, approved DRG content, and available performance evidence supporting the package.",
  websiteAndConversionRole: "Where the package strengthens the website and the next action it should encourage.",
};

export function strategyBriefFieldValue(
  brief: StrategyBrief | null | undefined,
  key: keyof StrategyBrief,
): { value: string; complete: boolean } {
  const value = brief?.[key]?.trim() ?? "";
  return value
    ? { value, complete: true }
    : { value: STRATEGY_BRIEF_GUIDANCE[key], complete: false };
}

export function isCompleteStrategyBrief(value: unknown): value is StrategyBrief {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const brief = value as Record<string, unknown>;
  return (
    Object.keys(brief).length === STRATEGY_BRIEF_FIELDS.length &&
    STRATEGY_BRIEF_FIELDS.every(
      ([key]) => typeof brief[key] === "string" && brief[key].trim().length > 0,
    )
  );
}

export function parseStrategyBrief(value: unknown): StrategyBrief | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid";

  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== STRATEGY_BRIEF_FIELDS.length) return "invalid";

  const brief = {} as StrategyBrief;
  for (const [key] of STRATEGY_BRIEF_FIELDS) {
    if (typeof raw[key] !== "string") return "invalid";
    const cleaned = raw[key].trim().slice(0, 2000);
    if (!cleaned) return "invalid";
    brief[key] = cleaned;
  }
  return isCompleteStrategyBrief(brief) ? brief : "invalid";
}
