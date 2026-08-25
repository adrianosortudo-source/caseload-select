/**
 * Why Your Firm · Compliance Rules, Statement Patterns, and Wizard Copy
 *
 * THE COMPLIANCE FILTER IS THE POINT OF THIS TOOL
 *
 * No positioning tool for law firms exists in Canada or the United States, and
 * no tool anywhere checks marketing claims against law society advertising
 * rules before they are written. This file is that check.
 *
 * The framing in every visible string: the Law Society asks for claims that are
 * demonstrably true, accurate and verifiable. Good positioning asks for exactly
 * the same thing. A claim that cannot be proved does not persuade anyone
 * either. Compliance is presented as the discipline that makes a differentiator
 * work, never as a restriction imposed from outside.
 *
 * HOW THE RULES RUN
 * Rules are pure data, evaluated locally. Nothing is sent anywhere to be
 * checked. Each rule runs against two things:
 *   1. Cards whose complianceFlag names it (see _data differentiators.ts).
 *   2. Free text the lawyer types: proof lines and the statement fields.
 * R3 has no card carrier, because no card claim in the deck uses a superlative.
 * It exists entirely for what the lawyer types.
 *
 * VERDICTS
 *   converted  The claim can be made, in different words. The tool shows the
 *              compliant version and carries that version into the brief.
 *   blocked    The claim cannot be made. The card leaves the brief and appears
 *              in the "what you are not claiming" section with its reason.
 *
 * A blocked claim is never rendered into the brief in its original form.
 *
 * This file also carries every visible string in the tool. Copy lives here so
 * the component layer wires text without writing any, and so a copy review can
 * happen in one file.
 */

export type Verdict = "converted" | "blocked";

export interface ComplianceRule {
  id: string;
  /** Short name shown on the verdict chip */
  name: string;
  /** What sets the rule off, in plain terms, shown to the lawyer */
  trigger: string;
  verdict: Verdict;
  /** One line: why this cannot stand as written */
  explanation: string;
  /** The compliant equivalent. Null when the claim has no compliant form. */
  conversion: string | null;
  /**
   * Lower-case phrases that set the rule off in free text. Matched on word
   * boundaries, never as raw substrings: a substring match fires "leading" on
   * the word "misleading", and a tool that flags a lawyer for writing "our
   * marketing is never misleading" has destroyed its own credibility on the one
   * screen where credibility is the product.
   *
   * Kept deliberately small and literal. A false positive costs more than a
   * miss here, because the lawyer can always add a claim we did not catch, and
   * every flag they disagree with makes the next flag easier to ignore.
   */
  textTriggers: string[];
  /**
   * Phrases that look like a trigger but are the lawyer doing the right thing.
   * Checked before the triggers; any match suppresses the rule for that text.
   */
  exceptions: string[];
}

/* ──────────────────────────────────────────────────────────────────
 *  The five rules
 * ────────────────────────────────────────────────────────────────── */

export const COMPLIANCE_RULES: ComplianceRule[] = [
  {
    id: "R1",
    name: "Outcome promise",
    trigger:
      "A promised result, a refund tied to a result, or a success rate.",
    verdict: "blocked",
    explanation:
      "No lawyer can promise how a matter ends, and Rule 4.2-1 treats a claim about results as one a client cannot verify in advance.",
    conversion:
      "State what you control instead. A response window, a fee agreed before work starts, or stages the client can see are all commitments you can keep on every file regardless of how it ends.",
    // Examples that set this off: "we win", "guaranteed result", "or your money
    // back", "98% success rate", "we get charges dropped".
    textTriggers: [
      "guarantee",
      "guaranteed",
      "we win",
      "success rate",
      "money back",
      "charges dropped",
      "always win",
    ],
    // A lawyer disclaiming guarantees is complying, not breaching.
    exceptions: ["no guarantee", "no outcome guarantee", "cannot guarantee", "never guarantee"],
  },
  {
    id: "R2",
    name: "Specialist language",
    trigger:
      "Describing the firm as a specialist or an expert.",
    verdict: "converted",
    explanation:
      "In Ontario, specialist is a designation from the Law Society's Certified Specialist Program. Using it without the designation is a rule problem, and expert carries the same difficulty.",
    conversion:
      "Say what is true about the work instead: the practice is focused on this, or this is most of what the firm handles. Focus is provable from your own files, and it reads as more concrete than a label.",
    // Examples that set this off: "specialist in employment law", "our experts",
    // "expert immigration lawyer".
    textTriggers: [
      "specialist",
      "specialists",
      "specialize",
      "specializes",
      "specialise",
      "specializing",
      "expert",
      "experts",
      "expertise",
    ],
    // Naming the Law Society's own designation is the compliant use.
    exceptions: ["certified specialist program", "certified specialist in"],
  },
  {
    id: "R3",
    name: "Superlative",
    trigger:
      "Best, top, leading, premier, number one, or any similar ranking word.",
    verdict: "blocked",
    explanation:
      "A superlative asks the reader to accept a ranking nobody measured. Rule 4.2-1 treats these as unverifiable, and a reader discounts them for the same reason.",
    conversion: null,
    // Examples that set this off: "best family lawyer in Toronto", "top-rated
    // firm", "Toronto's leading practice", "premier service", "#1 choice".
    textTriggers: [
      "best",
      "top-rated",
      "top rated",
      "leading",
      "premier",
      "number one",
      "unmatched",
      "unrivalled",
      "unrivaled",
      "most trusted",
      "finest",
    ],
    // "misleading" is caught by word-boundary matching, not by this list.
    // "best practice" describes a method rather than ranking the firm.
    exceptions: ["best practice", "best practices", "best interests", "best efforts"],
  },
  {
    id: "R4",
    name: "Claim about other firms",
    trigger:
      "A comparison against other lawyers or firms with nothing behind it.",
    verdict: "converted",
    explanation:
      "A comparative claim requires a basis you could produce on request, and you have no access to another firm's files or response times.",
    conversion:
      "Make the claim about your own firm alone and let the reader do the comparing. A stated fact about how you work is stronger than an assertion about how others do.",
    // Examples that set this off: "unlike other firms", "faster than other
    // lawyers", "we care more than the big firms".
    textTriggers: [
      "unlike other",
      "unlike most",
      "better than",
      "faster than",
      "cheaper than",
      "more than other",
      "big firms",
      "large firms",
      "other firms",
    ],
    // Referring work out, or naming what the firm does not do, is not a comparative claim.
    exceptions: ["refer to other firms", "other firms handle", "send to other firms"],
  },
  {
    id: "R5",
    name: "Unverifiable amount",
    trigger:
      "Hundreds of clients, countless matters, years of experience, or any other quantity without a number.",
    verdict: "converted",
    explanation:
      "A vague quantity reads as a claim but cannot be checked, and it is the phrase every firm uses, so it separates you from nobody.",
    conversion:
      "Name the actual figure and the actual matter type. A number you can stand behind is both verifiable and more persuasive than the phrase it replaces.",
    // Examples that set this off: "hundreds of clients", "countless cases",
    // "years of experience", "decades of practice", "thousands served".
    textTriggers: [
      "hundreds of",
      "thousands of",
      "countless",
      "years of experience",
      "decades of",
      "numerous",
      "many years",
      "extensive experience",
    ],
    exceptions: [],
  },
];

export function getRule(id: string): ComplianceRule | undefined {
  return COMPLIANCE_RULES.find((r) => r.id === id);
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the phrase appears in the text as a whole word or whole phrase.
 * Word boundaries are applied only at ends that begin or end with a letter or
 * digit, so a phrase like "top-rated" still matches while "leading" does not
 * fire inside "misleading".
 */
function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = escapeForRegex(phrase);
  const openBoundary = /^[a-z0-9]/.test(phrase) ? "\\b" : "";
  const closeBoundary = /[a-z0-9]$/.test(phrase) ? "\\b" : "";
  return new RegExp(`${openBoundary}${escaped}${closeBoundary}`).test(haystack);
}

/**
 * Returns every rule set off by a piece of free text.
 *
 * Case-insensitive, word-boundary matching, exceptions checked first. Pure and
 * local: nothing about the lawyer's wording leaves the browser to be assessed.
 */
export function rulesTriggeredBy(text: string): ComplianceRule[] {
  const haystack = text.toLowerCase();
  return COMPLIANCE_RULES.filter((rule) => {
    if (rule.exceptions.some((phrase) => containsPhrase(haystack, phrase))) {
      return false;
    }
    return rule.textTriggers.some((phrase) => containsPhrase(haystack, phrase));
  });
}

/* ──────────────────────────────────────────────────────────────────
 *  Statement patterns · step 4
 * ────────────────────────────────────────────────────────────────── */

export interface StatementPattern {
  id: string;
  /** Shown on the pattern chooser */
  name: string;
  /** One line on when this pattern is the right shape */
  whenToUse: string;
  /** The shape, with [bracketed] slots the lawyer fills */
  template: string;
  /** A filled example, so the lawyer can see the shape working */
  example: string;
  /** Field labels for the slots, in template order */
  slots: string[];
}

export const STATEMENT_PATTERNS: StatementPattern[] = [
  {
    id: "P1",
    name: "Focus",
    whenToUse:
      "Use this when the strongest thing about the firm is who it acts for and what it works on.",
    template: "[firm] acts for [client] on [matter focus]. [proof]",
    example:
      "Hale Law acts for restaurant owners on lease disputes. Eleven of the fourteen matters we opened last year were commercial leases.",
    slots: ["Firm name", "The client", "The matter focus", "Your proof line"],
  },
  {
    id: "P2",
    name: "Commitment",
    whenToUse:
      "Use this when the strongest thing about the firm is how it works, on every file.",
    template: "Every [client noun] gets [commitment]. [proof]",
    example:
      "Every client gets a written estimate before signing anything. It lists the fixed fee, what it covers, and what would change it.",
    slots: ["The client noun", "The commitment", "Your proof line"],
  },
  {
    id: "P3",
    name: "Fit",
    whenToUse:
      "Use this when the firm's edge is knowing exactly which matters belong here and which do not.",
    template:
      "If your matter is [in scope], this firm is built for it. If it is not, we say so and refer you. [proof]",
    example:
      "If your matter is a residential purchase in Peel Region, this firm is built for it. If it is not, we say so and refer you. We referred nine matters out last year and closed sixty-one.",
    slots: ["What is in scope", "Your proof line"],
  },
];

export function getPattern(id: string): StatementPattern | undefined {
  return STATEMENT_PATTERNS.find((p) => p.id === id);
}

/* ──────────────────────────────────────────────────────────────────
 *  Every visible string
 * ────────────────────────────────────────────────────────────────── */

export const copy = {
  tool: {
    eyebrow: "Free tool, about three minutes",
    name: "Why Your Firm",
    /** Landing paragraph, shown above the first step */
    intro:
      "A client choosing a lawyer sees a row of firms saying the same things. This tool works out what your firm can say that the others cannot, checks each claim against the Law Society's advertising rules, and gives you a positioning brief you can hand to whoever writes your website.",
    /**
     * Second landing paragraph, privacy posture, for the GATED modes:
     * accurate only when an email is collected and a PDF is sent. Dormant
     * while GATE_MODE is no_gate; kept for the future public launch.
     */
    privacy:
      "Your answers stay in this browser until you clear them. Nothing is stored on our servers. When you ask for the PDF, the brief is rendered, emailed to you, and not kept.",
    /**
     * The no_gate equivalent, and the one that ships today. Nothing is
     * collected and no request is ever made, so the claim is stronger and
     * simpler. Do not merge these two strings: a privacy claim that
     * overstates by one clause is the kind of thing this whole tool exists
     * to teach lawyers not to write.
     */
    privacyNoGate:
      "Your answers stay in this browser until you clear them. Nothing is sent to our servers and nothing is stored. Use your browser's print option if you want a copy to keep.",
    start: "Start",
    resume: "You have a brief in progress in this browser.",
    resumeAction: "Pick up where you left off",
    restartAction: "Start again",
    stepLabel: "Step",
    stepOf: "of",
    back: "Back",
    next: "Continue",
  },

  step1: {
    title: "What happens when they do not hire you.",
    prompt:
      "When someone with a matter you could handle decides against your firm, what do they usually do instead? Pick everything you see.",
    helper:
      "This is the real competition. For most small firms it is delay or self-help far more often than the office down the street, and a differentiator only counts if it beats what the client would otherwise do.",
    otherLabel: "Something else they do",
    otherPlaceholder: "In your own words",
    empty: "Pick at least one before continuing.",
  },

  step2: {
    titlePassOne: "What is true of your firm today.",
    promptPassOne:
      "Work through the groups and pick every claim that is already true. Nothing here is a commitment; the next screen is where the cutting happens.",
    helperPassOne:
      "Pick generously. It is easier to cut a long list than to remember what you left out.",
    titlePassTwo: "What you could prove to a stranger.",
    promptPassTwo:
      "Now keep only the claims you could support if a prospective client asked you to. Keep up to six.",
    helperPassTwo:
      "A claim you cannot evidence is one the reader discounts, and the Law Society asks the same question: could you demonstrate this if someone asked?",
    counterLabel: "selected",
    capReached:
      "That is six. Six is the working limit, because a position a client can repeat is a short one. Remove one to add another.",
    rankPrompt:
      "More than six survived. Put them in order and the top six carry through.",
    crowdWarning: "Most firm websites already say this.",
    crowdWarningBody:
      "A common claim separates you from nobody on its own. It works when the proof behind it is unusual, which is what the next step asks for.",
    emptyPassOne: "Pick at least one claim before continuing.",
    emptyPassTwo:
      "Nothing kept. You can go back and pick again, or continue and the brief will tell you what that result means.",
  },

  step3: {
    title: "Which of these hold up.",
    prompt:
      "Each claim gets three questions and one rule check. Answer honestly; a claim that fails here would have failed in front of a client.",
    testProvable: "Could you show evidence if asked?",
    testDemand: "Do the clients you want actually care about this?",
    testUnique:
      "If the firm down the street put this on their site, would it still be true?",
    testUniqueHelper:
      "If the answer is yes, the claim describes the profession rather than your firm.",
    proofPromptLabel: "Your evidence",
    proofPlaceholder: "One line. A number, a name, or a process.",
    ruleCheckLabel: "Rule check",
    ruleConvertedLabel: "Reworded to hold up",
    ruleBlockedLabel: "Cannot be claimed",
    ruleKeepMine: "Keep my wording",
    ruleUseConversion: "Use this version",
    survived: "Held up",
    dropped: "Dropped",
  },

  step4: {
    title: "Say it in one sentence.",
    prompt:
      "Pick the shape that fits what survived, then fill it in. This is the sentence that goes at the top of your website and comes out of your mouth at a networking event.",
    helper:
      "Write it the way you would say it out loud. If it sounds like a brochure, it will read like one.",
    patternLabel: "Choose a shape",
    exampleLabel: "Filled in, this reads:",
    livePreviewLabel: "Your statement",
    substitutionCheck:
      "Read it once with a competitor's name in place of yours. If it still reads true, it is not finished.",
  },

  gate: {
    /** Used in teaser_then_gate mode, under the ungated profile and statement */
    teaserTitle: "Where should we send your brief?",
    teaserBody:
      "The full brief carries your evidence against each claim, the ones that did not survive and why, the four places to use the statement, and a PDF you can keep.",
    /** Used in gate_before_brief mode */
    directTitle: "Where should we send your positioning brief?",
    directBody:
      "Your brief is ready. It carries your position, the evidence behind each claim, what did not survive, and where to use the statement.",
    firstName: "First name",
    firmName: "Firm name",
    email: "Email",
    emailHelper: "The brief arrives as a PDF. We do not send anything else unless you ask.",
    submit: "Send my brief",
    sending: "Sending",
    delivered: "Your brief is on its way.",
    deliveredBody:
      "It should arrive within a minute. The same brief is below, so you can read it now.",
    failed:
      "The email did not go out. Your brief is below and the PDF link still works.",
  },

  brief: {
    title: "Firm Positioning Brief",
    profileEyebrow: "Your position",
    sectionAlternatives: "Who you are really up against",
    sectionAlternativesIntro:
      "Everything below is measured against these, because these are what a client picks when they do not pick you.",
    sectionDifferentiators: "What you can say that others cannot",
    combinationLine:
      "Any one of these could be claimed by another firm. The combination is what belongs to you, and it is the combination a client remembers.",
    sectionDropped: "What you are not claiming, and why",
    sectionDroppedIntro:
      "This section matters as much as the one above it. Knowing what you will not say is what keeps the rest credible.",
    sectionStatement: "Your positioning statement",
    sectionSurfaces: "Where to use it",
    surfaces: [
      {
        name: "Your website",
        line: "The statement goes above the fold on the home page, in your words, before any description of services.",
      },
      {
        name: "Your Google Business Profile",
        line: "The description field is the version a client reads before they ever reach your site. Use the same sentence.",
      },
      {
        name: "Your intake",
        line: "The first question a prospective client answers should follow from the position, so the matters that fit reach you first.",
      },
      {
        name: "Referral conversations",
        line: "This is the sentence you say when another professional asks what you do. Say it the same way every time.",
      },
    ],
    sectionHomework: "Test it this week",
    homework:
      "Read your statement out loud to someone who is not a lawyer. Ask them to tell you back what makes your firm different from any other. If they cannot, the sentence is not finished, and what they say instead is usually the better version. Positions get sharper by being spoken before they get sharper by being edited.",
    sectionBridge: "What this changes about the work you take",
    bridge:
      "A position decides which matters you want more of. It only pays once the matters that fit reach you first, ahead of the ones that do not. That is what the CaseLoad Screen does with an inquiry before you read a word of it: it applies the definition you just wrote to everything that arrives.",
    bridgeThreeWay:
      "Use this brief yourself, hand it to whoever runs your marketing, or walk through it with us.",
    bridgeCta: "See how the Screen reads an inquiry",
    footerMark: "Evidence-led marketing. No outcome guarantees.",
    noSurvivors:
      "Nothing survived both passes, and that is a finding rather than a failure. It usually means the firm is running on claims every practice makes. The cards you dropped, and the reasons beside them, are the shortest route to the one thing worth building.",
  },

  email: {
    subject: "Your Firm Positioning Brief",
    /** Cover note above the PDF link. Kept short; the brief is the content. */
    body:
      "Your positioning brief is attached. It carries the claims that held up, the evidence you gave for each, the claims that did not survive and why, and the sentence you built from them.\n\nThe one thing worth doing this week is in the brief: read your statement out loud to someone who is not a lawyer, and listen to how they say it back.",
    signoff: "CaseLoad Select",
  },

  pdf: {
    coverTitle: "Firm Positioning Brief",
    preparedFor: "Prepared for",
    dateLabel: "Prepared",
    footerMark: "Evidence-led marketing. No outcome guarantees.",
  },
} as const;
