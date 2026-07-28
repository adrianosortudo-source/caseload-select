import type { StrategyBrief } from "@/lib/types";

export const STRATEGY_BRIEF_FIELDS = [
  ["readerAndSituation", "Reader and real situation"],
  ["workSupported", "Work this supports"],
  ["whyThisWeek", "Why this topic this week"],
  ["practicalAngle", "DRG’s practical angle"],
  ["authorityAndEvidence", "Authority and evidence"],
  ["websiteAndConversionRole", "Website and conversion role"],
] as const satisfies ReadonlyArray<readonly [keyof StrategyBrief, string]>;

export function isCompleteStrategyBrief(value: unknown): value is StrategyBrief {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const brief = value as Record<string, unknown>;
  const keys = Object.keys(brief);
  return keys.length === STRATEGY_BRIEF_FIELDS.length && STRATEGY_BRIEF_FIELDS.every(
    ([key]) => typeof brief[key] === "string" && brief[key].trim().length > 0,
  );
}

export function parseStrategyBrief(value: unknown): StrategyBrief | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid";

  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length === 0) return null;
  if (keys.length !== STRATEGY_BRIEF_FIELDS.length) return "invalid";

  const brief = {} as StrategyBrief;
  for (const [key] of STRATEGY_BRIEF_FIELDS) {
    const value = raw[key];
    if (typeof value !== "string") return "invalid";
    const cleaned = value.trim().slice(0, 2000);
    if (!cleaned) return "invalid";
    brief[key] = cleaned;
  }
  return isCompleteStrategyBrief(brief) ? brief : "invalid";
}
