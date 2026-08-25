/**
 * Why Your Firm · Engine
 *
 * Pure functions only. No React, no fetch, no localStorage, no Date.now(),
 * no Math.random(). Every function here takes data in and returns data out,
 * which is what lets the API route re-run the exact same logic the browser
 * ran, on the server, against whatever the client actually sent.
 *
 * THAT SERVER-SIDE RE-RUN IS THE TRUST BOUNDARY
 * The API route never trusts a client-assembled brief. A visitor's browser
 * could be scripted to submit "we are the best in the GTA" as a proof line
 * with the compliance check silently skipped client-side. The server calls
 * computeSurvivors() itself on the submitted card ids, proof text and
 * statement values, so a blocked claim cannot reach the rendered PDF no
 * matter what the request body claims the UI already checked.
 *
 * WHAT "SURVIVES" MEANS
 * A ranked card survives step 3 when all four of these hold:
 *   1. The lawyer affirmed all three tests (provable, in demand, unique).
 *   2. The card itself carries no complianceFlag whose rule is "blocked".
 *   3. The proof line the lawyer typed triggers no rule with verdict
 *      "blocked" (R1, R3: R3 exists specifically to catch this, since no
 *      card claim itself uses a superlative).
 *   4. A proof line was actually entered. An empty proof cannot be verified,
 *      so it cannot survive; this is the same rule the differentiator deck's
 *      own header comment states about every card needing a proofPrompt.
 * A card that fails any of these drops, and carries a one-line reason into
 * the brief's "what you are not claiming" section. Dropping is not a defeat
 * for the tool; the research behind this build treats that section as the
 * tool's credibility, not its failure mode.
 */

import {
  DIFFERENTIATOR_CARDS,
  getCard,
  renderClaim,
  KEEP_CAP,
  type Category,
  type DifferentiatorCard,
} from "./differentiators";
import {
  ALTERNATIVES,
  PROFILES,
  resolveProfile,
  type Alternative,
  type PositioningProfile,
} from "./profiles";
import {
  COMPLIANCE_RULES,
  getRule,
  rulesTriggeredBy,
  STATEMENT_PATTERNS,
  getPattern,
  type ComplianceRule,
} from "./compliance";

/* ──────────────────────────────────────────────────────────────────
 *  Step 2 · pass one and pass two
 * ────────────────────────────────────────────────────────────────── */

/**
 * Caps a pass-two selection at KEEP_CAP, preserving the deck's own category
 * order (CATEGORIES order, which is DIFFERENTIATOR_CARDS order) rather than
 * selection order, so two lawyers who pick the same six cards in a different
 * click order get the same ranked list. The live UI enforces the cap at
 * selection time and this path is normally unreachable from it, but the plan
 * calls for it as a testable pure function in its own right, and it is what
 * the API route falls back to if a client ever submits more than six ids.
 */
export function capAndRank(cardIds: string[]): string[] {
  const idSet = new Set(cardIds);
  const inDeckOrder = DIFFERENTIATOR_CARDS.filter((c) => idSet.has(c.id)).map(
    (c) => c.id,
  );
  return inDeckOrder.slice(0, KEEP_CAP);
}

/* ──────────────────────────────────────────────────────────────────
 *  Step 3 · compliance evaluation for one card
 * ────────────────────────────────────────────────────────────────── */

export interface CardCompliance {
  /** The rule named by the card's own complianceFlag, or null. */
  staticRule: ComplianceRule | null;
  /** Every rule the lawyer's typed proof text triggers on its own. */
  textRules: ComplianceRule[];
  /** True when either the static rule or any text rule is a hard block. */
  blocked: boolean;
  /** Every rule in play, deduplicated by id, for display. */
  allRules: ComplianceRule[];
}

export function evaluateCardCompliance(
  card: DifferentiatorCard,
  proofText: string,
): CardCompliance {
  const staticRule = card.complianceFlag ? (getRule(card.complianceFlag) ?? null) : null;
  const textRules = rulesTriggeredBy(proofText);

  const byId = new Map<string, ComplianceRule>();
  if (staticRule) byId.set(staticRule.id, staticRule);
  for (const rule of textRules) byId.set(rule.id, rule);

  const allRules = Array.from(byId.values());
  const blocked = allRules.some((rule) => rule.verdict === "blocked");

  return { staticRule, textRules, blocked, allRules };
}

/**
 * Same check for free text that is not attached to a specific card (the
 * statement-builder slot values). No staticRule concept applies there.
 */
export function evaluateFreeText(text: string): {
  rules: ComplianceRule[];
  blocked: boolean;
} {
  const rules = rulesTriggeredBy(text);
  return { rules, blocked: rules.some((r) => r.verdict === "blocked") };
}

/* ──────────────────────────────────────────────────────────────────
 *  Step 3 · the three tests plus compliance, per card
 * ────────────────────────────────────────────────────────────────── */

export interface CardTestAnswers {
  provable: boolean;
  inDemand: boolean;
  unique: boolean;
}

export interface CardJudgment {
  card: DifferentiatorCard;
  claimText: string;
  proof: string;
  tests: CardTestAnswers;
  compliance: CardCompliance;
  survives: boolean;
  /** One line explaining why, only set when survives is false. */
  dropReason: string | null;
}

function judgeCard(
  card: DifferentiatorCard,
  inputValue: string | undefined,
  proof: string,
  tests: CardTestAnswers,
): CardJudgment {
  const claimText = renderClaim(card, inputValue);
  const compliance = evaluateCardCompliance(card, proof);
  const proofGiven = proof.trim().length > 0;
  const testsPassed = tests.provable && tests.inDemand && tests.unique;

  let survives = testsPassed && proofGiven && !compliance.blocked;
  let dropReason: string | null = null;

  if (!survives) {
    if (compliance.blocked) {
      const blockingRule = compliance.allRules.find((r) => r.verdict === "blocked");
      dropReason = blockingRule?.explanation ?? "This claim cannot be made as written.";
    } else if (!proofGiven) {
      dropReason = "No evidence was given, and a claim without evidence cannot be verified.";
    } else {
      dropReason = "It did not hold up against all three tests.";
    }
    survives = false;
  }

  return { card, claimText, proof, tests, compliance, survives, dropReason };
}

/**
 * Input shape the wizard and the API route both build: one entry per ranked
 * card, carrying whatever the lawyer typed for it.
 */
export interface CardWork {
  cardId: string;
  inputValue?: string;
  proof: string;
  tests: CardTestAnswers;
}

export interface SurvivorResult {
  survivors: CardJudgment[];
  dropped: CardJudgment[];
  /** survivors, in the deck's category order, for downstream display */
  survivorCategories: Category[];
}

export function computeSurvivors(work: CardWork[]): SurvivorResult {
  const judged = work
    .map((w) => {
      const card = getCard(w.cardId);
      if (!card) return null;
      return judgeCard(card, w.inputValue, w.proof, w.tests);
    })
    .filter((j): j is CardJudgment => j !== null);

  const survivors = judged.filter((j) => j.survives);
  const dropped = judged.filter((j) => !j.survives);

  return {
    survivors,
    dropped,
    survivorCategories: survivors.map((j) => j.card.category),
  };
}

/* ──────────────────────────────────────────────────────────────────
 *  Profile resolution
 * ────────────────────────────────────────────────────────────────── */

export function resolveProfileFromSurvivors(
  survivorCategories: Category[],
): PositioningProfile | null {
  return resolveProfile(survivorCategories);
}

/* ──────────────────────────────────────────────────────────────────
 *  Step 4 · statement assembly
 * ────────────────────────────────────────────────────────────────── */

/**
 * Renders one of the three statement patterns from ordered slot values.
 * Values are supplied in the same order as StatementPattern.slots; the final
 * slot in every pattern is the proof line (see compliance.ts's own comment
 * on STATEMENT_PATTERNS: slots always end with "Your proof line").
 *
 * The templates in compliance.ts are documentation for the pattern chooser,
 * not a machine interpolation format (their bracket wording varies pattern
 * to pattern), so each pattern gets its own literal formatter here, built to
 * match that pattern's `example` string exactly.
 */
export function buildStatement(patternId: string, values: string[]): string {
  const pattern = getPattern(patternId);
  if (!pattern) return "";
  const v = (i: number) => (values[i] ?? "").trim();

  switch (patternId) {
    case "P1": {
      // slots: [Firm name, The client, The matter focus, Your proof line]
      const [firm, client, matter, proof] = [v(0), v(1), v(2), v(3)];
      return `${firm} acts for ${client} on ${matter}. ${proof}`.trim();
    }
    case "P2": {
      // slots: [The client noun, The commitment, Your proof line]
      const [clientNoun, commitment, proof] = [v(0), v(1), v(2)];
      return `Every ${clientNoun} gets ${commitment}. ${proof}`.trim();
    }
    case "P3": {
      // slots: [What is in scope, Your proof line]
      const [inScope, proof] = [v(0), v(1)];
      return `If your matter is ${inScope}, this firm is built for it. If it is not, we say so and refer you. ${proof}`.trim();
    }
    default:
      return "";
  }
}

/** The index of the proof-line slot within a pattern's slots array. */
export function proofSlotIndex(patternId: string): number {
  const pattern = getPattern(patternId);
  if (!pattern) return -1;
  return pattern.slots.length - 1;
}

/* ──────────────────────────────────────────────────────────────────
 *  Brief assembly
 * ────────────────────────────────────────────────────────────────── */

export interface AlternativeSelection {
  id: string;
  otherText?: string;
}

export interface BriefInput {
  alternatives: AlternativeSelection[];
  work: CardWork[];
  patternId: string | null;
  statementValues: string[];
  firmName: string;
}

export interface BriefData {
  alternatives: Alternative[];
  alternativeOtherText: string | null;
  profile: PositioningProfile | null;
  survivors: CardJudgment[];
  dropped: CardJudgment[];
  statement: string;
  statementBlocked: boolean;
  firmName: string;
}

/**
 * Full server-side assembly from raw submitted data. This is what the API
 * route calls, and it is the single source of truth for what ends up in the
 * brief and the PDF: nothing the client sends is trusted past this point.
 */
export function assembleBrief(input: BriefInput): BriefData {
  const alternatives = ALTERNATIVES.filter((a) =>
    input.alternatives.some((sel) => sel.id === a.id),
  );
  const otherEntry = input.alternatives.find((sel) => sel.id === "other" && sel.otherText);
  const alternativeOtherText = otherEntry?.otherText?.trim() || null;

  const { survivors, dropped, survivorCategories } = computeSurvivors(input.work);
  const profile = resolveProfileFromSurvivors(survivorCategories);

  const statementCheck = evaluateFreeText(input.statementValues.join(" "));
  const statement =
    input.patternId && !statementCheck.blocked
      ? buildStatement(input.patternId, input.statementValues)
      : "";

  return {
    alternatives,
    alternativeOtherText,
    profile,
    survivors,
    dropped,
    statement,
    statementBlocked: statementCheck.blocked,
    firmName: input.firmName.trim(),
  };
}

/* ──────────────────────────────────────────────────────────────────
 *  Re-exports the UI layer needs alongside the engine
 * ────────────────────────────────────────────────────────────────── */

export { COMPLIANCE_RULES, STATEMENT_PATTERNS, PROFILES };
