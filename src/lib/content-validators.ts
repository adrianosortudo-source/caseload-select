import "server-only";

export type ValidatorKey =
  | "banned_vocabulary"
  | "approved_vocabulary"
  | "em_dash"
  | "italics_markup"
  | "orphan_words"
  | "word_count"
  | "required_sections"
  | "lso_compliance"
  | "opening_discipline"
  | "source_integrity";

export type Severity = "fail" | "warn" | "info";

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  location?: string;
}

export interface ValidatorResult {
  key: ValidatorKey;
  status: "pass" | "warn" | "fail" | "error";
  severity: Severity;
  findings: Finding[];
}

export interface ValidatorConfig {
  banned_vocabulary: string[];
  approved_vocabulary: string[];
  lso_constraints: string[];
  formatting_rules: {
    no_em_dashes: boolean;
    no_italics: boolean;
    no_orphan_words: boolean;
    no_rule_of_three: boolean;
  };
  format_spec: {
    word_range?: [number, number];
    structure?: string[];
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateBannedVocabulary(
  text: string,
  banned: string[]
): ValidatorResult {
  const findings: Finding[] = [];
  for (const term of banned) {
    const pattern = new RegExp(`\\b${escapeRegex(term.toLowerCase())}\\b`, "gi");
    const matches = text.match(pattern);
    if (matches) {
      findings.push({
        rule: "banned_vocabulary",
        severity: "fail",
        message: `Banned term "${term}" found (${matches.length} occurrence${matches.length > 1 ? "s" : ""}).`,
      });
    }
  }
  return {
    key: "banned_vocabulary",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

export function validateApprovedVocabulary(
  text: string,
  approved: string[]
): ValidatorResult {
  const findings: Finding[] = [];
  const lower = text.toLowerCase();
  let found = 0;
  for (const term of approved) {
    if (lower.includes(term.toLowerCase())) found++;
  }
  const ratio = approved.length > 0 ? found / approved.length : 1;
  if (ratio < 0.1) {
    findings.push({
      rule: "approved_vocabulary",
      severity: "warn",
      message: `Only ${found}/${approved.length} approved terms used. Consider incorporating more brand-aligned vocabulary.`,
    });
  }
  return {
    key: "approved_vocabulary",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

const EM_DASH_CHAR = "—";

export function validateEmDash(text: string): ValidatorResult {
  const findings: Finding[] = [];
  let count = 0;
  for (const ch of text) {
    if (ch === EM_DASH_CHAR) count++;
  }
  if (count > 0) {
    findings.push({
      rule: "em_dash",
      severity: "fail",
      message: `${count} em dash(es) found. Use commas, colons, semicolons, or restructure.`,
    });
  }
  return {
    key: "em_dash",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

export function validateItalicsMarkup(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const italicPatterns = [
    /\*[^*\n]+\*/g,
    /_[^_\n]+_/g,
    /<em>/gi,
    /<i>/gi,
    /font-style:\s*italic/gi,
  ];
  let total = 0;
  for (const pattern of italicPatterns) {
    const matches = text.match(pattern);
    if (matches) total += matches.length;
  }
  if (total > 0) {
    findings.push({
      rule: "italics_markup",
      severity: "fail",
      message: `${total} italic marker(s) found. Emphasis uses weight (700) and small caps (600), never italics.`,
    });
  }
  return {
    key: "italics_markup",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

export function validateOrphanWords(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const paragraphs = text.split(/\n{2,}/);
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed || trimmed.length < 40) continue;
    const words = trimmed.split(/\s+/);
    const lastWord = words[words.length - 1];
    if (lastWord && lastWord.length <= 3 && words.length > 6) {
      findings.push({
        rule: "orphan_words",
        severity: "warn",
        message: `Possible orphan word "${lastWord}" at end of paragraph. Review line breaks.`,
        location: trimmed.slice(0, 60) + "...",
      });
    }
  }
  return {
    key: "orphan_words",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

export function validateWordCount(
  text: string,
  range: [number, number]
): ValidatorResult {
  const findings: Finding[] = [];
  const words = text
    .replace(/<[^>]*>/g, "")
    .replace(/[#*_`~\[\]]/g, "")
    .split(/\s+/)
    .filter(Boolean).length;

  if (words < range[0]) {
    findings.push({
      rule: "word_count",
      severity: "warn",
      message: `${words} words. Target range is ${range[0]}-${range[1]}. Consider expanding.`,
    });
  } else if (words > range[1]) {
    findings.push({
      rule: "word_count",
      severity: "warn",
      message: `${words} words. Target range is ${range[0]}-${range[1]}. Consider tightening.`,
    });
  }
  return {
    key: "word_count",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

export function validateRequiredSections(
  text: string,
  sections: string[]
): ValidatorResult {
  const findings: Finding[] = [];
  const lower = text.toLowerCase();
  for (const section of sections) {
    if (section === "five_line_brief") {
      const briefTerms = ["risk", "price", "timeline", "decision", "next step"];
      const missing = briefTerms.filter((t) => !lower.includes(t));
      if (missing.length > 2) {
        findings.push({
          rule: "required_sections",
          severity: "fail",
          message: `Five-Line Brief incomplete. Missing: ${missing.join(", ")}.`,
        });
      }
    }
  }
  return {
    key: "required_sections",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

export function validateLsoCompliance(text: string): ValidatorResult {
  const findings: Finding[] = [];

  const outcomePromises = [
    /\bguarantee[sd]?\b/i,
    /\bensure[sd]?\s+(you|your|the)\b/i,
    /\bwill\s+win\b/i,
    /\bwill\s+succeed\b/i,
    /\bwill\s+recover\b/i,
    /\b100%\s+(success|recovery|guarantee)\b/i,
  ];
  for (const pattern of outcomePromises) {
    if (pattern.test(text)) {
      findings.push({
        rule: "lso_compliance",
        severity: "fail",
        message: `Possible outcome promise: "${text.match(pattern)?.[0]}". LSO Rule 4.2-1 prohibits outcome guarantees.`,
      });
    }
  }

  const superlatives = [
    /\bbest\s+(lawyer|firm|attorney|legal)\b/i,
    /\btop[-\s]rated\b/i,
    /\b#\s*1\b/i,
    /\bnumber\s+one\b/i,
    /\bunmatched\b/i,
    /\bunparalleled\b/i,
  ];
  for (const pattern of superlatives) {
    if (pattern.test(text)) {
      findings.push({
        rule: "lso_compliance",
        severity: "fail",
        message: `Unverifiable superlative: "${text.match(pattern)?.[0]}". LSO Rule 4.2-1 prohibits unverifiable claims.`,
      });
    }
  }

  return {
    key: "lso_compliance",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

export function validateOpeningDiscipline(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const firstParagraph = text.split(/\n{2,}/)[0]?.trim() ?? "";

  const performanceOpeners = [
    /^at\s+(drg|our|the\s+firm)/i,
    /^we\s+(are|have|pride|specialize|offer)/i,
    /^(our|the)\s+firm\s+(is|has|was|offers|provides)/i,
    /^with\s+(over|more\s+than)\s+\d+\s+years/i,
  ];
  for (const pattern of performanceOpeners) {
    if (pattern.test(firstParagraph)) {
      findings.push({
        rule: "opening_discipline",
        severity: "warn",
        message: "Opens with firm performance, not consequence. Lead with what changes for the reader.",
      });
    }
  }

  const suspenseBait = [
    /^(you won't believe|what if|imagine|picture this|here's the thing)/i,
    /^(did you know|have you ever|most people don't)/i,
  ];
  for (const pattern of suspenseBait) {
    if (pattern.test(firstParagraph)) {
      findings.push({
        rule: "opening_discipline",
        severity: "warn",
        message: "Suspense bait opening detected. Open with consequence.",
      });
    }
  }

  return {
    key: "opening_discipline",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

export function validateSourceIntegrity(
  sourceBrief: Record<string, unknown>
): ValidatorResult {
  const findings: Finding[] = [];
  const required = ["decision_question", "legal_distinction", "consequence"];
  for (const field of required) {
    const val = sourceBrief[field];
    if (!val || (typeof val === "string" && val.trim().length === 0)) {
      findings.push({
        rule: "source_integrity",
        severity: "fail",
        message: `Source brief missing required field: ${field}.`,
      });
    }
  }
  return {
    key: "source_integrity",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

export function runDeterministicValidators(
  text: string,
  config: ValidatorConfig,
  sourceBrief?: Record<string, unknown>
): ValidatorResult[] {
  const results: ValidatorResult[] = [];

  results.push(validateBannedVocabulary(text, config.banned_vocabulary));
  results.push(validateApprovedVocabulary(text, config.approved_vocabulary));

  if (config.formatting_rules.no_em_dashes) {
    results.push(validateEmDash(text));
  }
  if (config.formatting_rules.no_italics) {
    results.push(validateItalicsMarkup(text));
  }
  if (config.formatting_rules.no_orphan_words) {
    results.push(validateOrphanWords(text));
  }
  if (config.format_spec.word_range) {
    results.push(validateWordCount(text, config.format_spec.word_range));
  }
  if (config.format_spec.structure) {
    results.push(validateRequiredSections(text, config.format_spec.structure));
  }

  results.push(validateLsoCompliance(text));
  results.push(validateOpeningDiscipline(text));

  if (sourceBrief) {
    results.push(validateSourceIntegrity(sourceBrief));
  }

  return results;
}