/**
 * Structure canon for the two article format families (Counsel Note, Clause
 * in the Margin), each in both shipped locales. Pure module: no I/O, no
 * Supabase, no filesystem. `gate.ts` imports `evaluateArticleStructure` and
 * calls it against a fetched body_html; this file owns only the canon table
 * and the pure evaluation function, mirroring how `placement-resolution.ts`
 * was factored out of `prove.ts` (EXECUTION-PLAN_publish-gate-truthfulness_v1
 * Decision D2), so the canon is directly unit-testable without a database.
 *
 * Replaces the prior `ARTICLE_STRUCTURE_MARKERS` gate.ts constant, which
 * checked for the three literal English words "Five-Line Brief", "Decision
 * Box", "FAQ" against every article regardless of locale or format family.
 * That was wrong on all counts this canon exists to fix:
 *   - it never matched the Portuguese headings at all (a Portuguese body can
 *     never contain the English words "Five-Line Brief" or "FAQ"), so every
 *     -pt structure check failed permanently regardless of content;
 *   - it demanded a Five-Line Brief on a Clause in the Margin, which the
 *     Clause's own canon validator explicitly forbids (see below) -- the old
 *     check was asking for the defect it should have been catching;
 *   - it checked for the bare substring "FAQ" anywhere in the body rather
 *     than the actual section heading, which both a false positive (the word
 *     "FAQ" appearing in body prose with no real FAQ section) and a false
 *     negative (a body whose real heading is "Frequently asked questions",
 *     which never contains the literal substring "FAQ") could slip past.
 *
 * Canon source of truth: the drg-asset-placement skill runtime's own Python
 * structural validators, which operate on the pre-render JSON record (not
 * the rendered HTML this gate checks), so this table is a second, independent
 * codification of the same requirements against the different artifact the
 * weekly-publish gate actually has access to (published body_html):
 *   - validate_counsel_note.py:225 -- `if not 5 <= len(faqs) <= 7:` (EN and
 *     PT Counsel Notes both require a Five-Line Brief, a Decision Box, and
 *     5-7 FAQ pairs; only the heading-presence check lives here, not the
 *     pair-count, which is out of scope for an HTML-heading grep).
 *   - validate_clause_margin.py:141 -- `if "fiveLineBrief" in record: errors
 *     .append(f"{label}: Clause must not contain Five-Line Brief")` --
 *     the Clause format FORBIDS a Five-Line Brief. A prior version of this
 *     plan's evidence table cited this file as "validate_clause.py"; the
 *     actual filename in the skill runtime is `validate_clause_margin.py`.
 *     Verified byte-identical content and line number against the real file
 *     during Phase 1 of EXECUTION-PLAN_publish-gate-truthfulness_v1; noted
 *     here rather than silently correcting the plan's prose elsewhere.
 *   - validate_clause_margin.py:142 -- `if not 2 <= len(record.get("faqs",
 *     [])) <= 3:` (Clause requires a Decision Box and 2-3 FAQ pairs, no
 *     Five-Line Brief).
 *
 * Heading match is exact-`<h2>`, not a loose substring anywhere in the body
 * (Decision D3): Counsel Note EN prose contains the sentence "A useful
 * internal brief can be five short lines", which a loose match would wrongly
 * treat as a Five-Line Brief heading and pass a document that lacked the
 * real section.
 *
 * Fail-closed (Standing Rule 4): an unknown (formatFamily, locale) pair is
 * not silently skipped or passed -- `evaluateArticleStructure` returns a
 * failing result that names both values, so a new format family or locale
 * added to config.ts without a matching canon entry here fails loudly
 * instead of silently passing every check.
 */

export interface ArticleStructureCanonEntry {
  /** `<h2>` headings that MUST be present, matched exactly (case-insensitive). */
  required: readonly string[];
  /** `<h2>` headings that MUST NOT be present, matched exactly (case-insensitive). */
  forbidden: readonly string[];
}

export interface ArticleStructureResult {
  ok: boolean;
  /** What was verified, or what is missing/present in violation -- never a bare "ok" (Phase 1.3). */
  detail: string;
}

const ARTICLE_STRUCTURE_CANON: Record<string, Record<string, ArticleStructureCanonEntry>> = {
  counsel_note: {
    "en-CA": {
      required: ["The Five-Line Brief", "Decision Box", "Frequently asked questions"],
      forbidden: [],
    },
    "pt-BR": {
      required: ["O essencial em cinco linhas", "Caixa de decisão", "Perguntas frequentes"],
      forbidden: [],
    },
  },
  clause_in_the_margin: {
    "en-CA": {
      required: ["Decision Box", "Frequently asked questions"],
      forbidden: ["The Five-Line Brief"],
    },
    "pt-BR": {
      required: ["Caixa de decisão", "Perguntas frequentes"],
      forbidden: ["O essencial em cinco linhas"],
    },
  },
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasHeading(bodyHtml: string, heading: string): boolean {
  const re = new RegExp("<h2[^>]*>\\s*" + escapeRegex(heading) + "\\s*</h2>", "i");
  return re.test(bodyHtml);
}

/**
 * Pure structural evaluation of one article body against the canon table
 * above. Never mutates, never reads the database or filesystem.
 */
export function evaluateArticleStructure(formatFamily: string, locale: string, bodyHtml: string): ArticleStructureResult {
  const byLocale = ARTICLE_STRUCTURE_CANON[formatFamily];
  const entry = byLocale ? byLocale[locale] : undefined;
  if (!entry) {
    return {
      ok: false,
      detail: `no structure canon entry for formatFamily="${formatFamily}" locale="${locale}" (fail-closed, Standing Rule 4: an unknown format family or locale must FAIL, never pass silently)`,
    };
  }

  const missingRequired = entry.required.filter((heading) => !hasHeading(bodyHtml, heading));
  const presentForbidden = entry.forbidden.filter((heading) => hasHeading(bodyHtml, heading));

  if (missingRequired.length === 0 && presentForbidden.length === 0) {
    const forbiddenNote = entry.forbidden.length > 0 ? `, ${entry.forbidden.length} forbidden section(s) confirmed absent` : "";
    return {
      ok: true,
      detail: `${entry.required.length} required section(s) found${forbiddenNote}`,
    };
  }

  const parts: string[] = [];
  if (missingRequired.length > 0) parts.push(`missing required: ${missingRequired.join(", ")}`);
  if (presentForbidden.length > 0) parts.push(`forbidden section present: ${presentForbidden.join(", ")}`);
  return { ok: false, detail: parts.join("; ") };
}
