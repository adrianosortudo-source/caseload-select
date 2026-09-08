/**
 * Display and filter normalization for the operator prospect workspace.
 * Source values stay unchanged on the underlying record; this layer only
 * produces stable operator-facing labels and matching keys.
 */

function compact(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function titleWords(value: string): string {
  return compact(value).toLocaleLowerCase("en-CA").replace(/\b\p{L}/gu, (character) => character.toLocaleUpperCase("en-CA"));
}

const cityAliases: Readonly<Record<string, string>> = {
  mississaauga: "Mississauga",
  "richmond hil": "Richmond Hill",
  thronhill: "Thornhill",
};

const practiceAreaAliases: Readonly<Record<string, string>> = {
  arbitration: "Arbitration",
  "business law": "Business law",
  civil_litigation: "Civil litigation",
  "civil litigation": "Civil litigation",
  corporate_commercial: "Corporate and commercial",
  "corporate and commercial": "Corporate and commercial",
  criminal: "Criminal law",
  employment: "Employment law",
  estates: "Estates",
  family: "Family law",
  "family law": "Family law",
  general_counsel_advisory: "General counsel and advisory",
  "general counsel and advisory": "General counsel and advisory",
  general_practice: "General practice",
  "general practice": "General practice",
  immigration: "Immigration law",
  ip: "Intellectual property",
  mediation: "Mediation",
  notary_services: "Notary services",
  personal_injury: "Personal injury",
  "real estate": "Real estate law",
  real_estate: "Real estate law",
  tax: "Tax law",
  wills_estates: "Wills and estates",
  "wills and estates": "Wills and estates",
};

export function normalizedCityLabel(value: string): string {
  const key = compact(value).toLocaleLowerCase("en-CA");
  return cityAliases[key] ?? titleWords(value);
}

export function normalizedCityKey(value: string): string {
  return normalizedCityLabel(value).toLocaleLowerCase("en-CA");
}

export function normalizedPracticeAreaLabel(value: string): string {
  const key = compact(value).toLocaleLowerCase("en-CA");
  return practiceAreaAliases[key] ?? titleWords(value.replaceAll("_", " "));
}

export function normalizedPracticeAreaKey(value: string): string {
  return normalizedPracticeAreaLabel(value).toLocaleLowerCase("en-CA");
}

export function uniqueNormalizedLabels(values: readonly string[], normalizer: (value: string) => string): string[] {
  return [...new Set(values.map(normalizer).filter(Boolean))].sort((left, right) => left.localeCompare(right, "en-CA", { sensitivity: "base" }));
}
