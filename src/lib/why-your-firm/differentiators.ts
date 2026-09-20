/**
 * Why Your Firm · Differentiator Cards
 *
 * Thirty-eight cards across eight categories. The lawyer picks what is true of
 * the firm today (pass one), then keeps only what could be proved to a stranger
 * (pass two), capped at six.
 *
 * WHY THE CARDS READ THIS WAY
 * Every claim is written in the firm's own voice, first person plural, as a
 * sentence the lawyer could put on a website today. Every card carries a
 * proofPrompt, because a differentiator without evidence is an assertion, and
 * both the positioning literature and LSO Rule 4.2-1 apply the same test:
 * demonstrably true, accurate, verifiable.
 *
 * THE TWO FLAG SYSTEMS
 *   crowdFlag      This claim appears on most firm websites. Picking it is not
 *                  forbidden; the tool warns that a common claim differentiates
 *                  only when unusual proof sits behind it. Five cards carry it,
 *                  and they are the cards lawyers reach for first.
 *   complianceFlag The claim's natural phrasing trips a Law Society rule. The
 *                  tool shows the rule and the compliant version inline, so the
 *                  lawyer sees why the wording changed. Four cards carry one;
 *                  R3 (superlatives) has no card carrier by design, because no
 *                  card claim written here uses a superlative. R3 runs against
 *                  the lawyer's own typed proof lines and statement text.
 *                  See _data/compliance.ts.
 *
 * INPUT LABELS, AND THE TWO WAYS THEY ARE USED
 * Sixteen cards carry an inputLabel: a short fact the wizard collects so the
 * brief can speak in the lawyer's own terms rather than in categories.
 *
 *   Five of those cards also carry the [slot] token inside the claim itself
 *   (a community, an industry, a language, a year, and the referral profession).
 *   For these, renderClaim substitutes the lawyer's word into the sentence, so
 *   the claim reads as their own. Use renderClaim, never card.claim, anywhere a
 *   claim is displayed.
 *
 *   The other eleven have no token in the claim. Their collected value sharpens
 *   the proof line and feeds the statement builder, where the lawyer needs the
 *   specific price, window, interval or role to fill a pattern slot. renderClaim
 *   returns those claims unchanged, which is correct and not a bug.
 *
 * Both uses exist because the sentence sometimes needs the fact and sometimes
 * only the evidence does. Collect on every card that has an inputLabel.
 *
 * Card copy is final register. Do not paraphrase in the UI layer.
 */

export type Category =
  | "practice_focus"
  | "client_niche"
  | "language_culture"
  | "fees_clarity"
  | "responsiveness"
  | "intake_experience"
  | "credentials_history"
  | "process_follow_through";

export interface CategoryMeta {
  id: Category;
  /** Group heading shown above the cards in that step */
  label: string;
  /** One line under the heading, telling the lawyer what this group is asking */
  prompt: string;
}

export interface DifferentiatorCard {
  id: string;
  category: Category;
  /** Card face, 2 to 5 words */
  label: string;
  /** The claim in the firm's voice, first person plural */
  claim: string;
  /** What evidence would make the claim verifiable to someone who does not know the firm */
  proofPrompt: string;
  /**
   * Short field label for a fact the wizard collects on this card, or null when
   * the card needs nothing. When the claim also carries [slot], the value is
   * substituted into the sentence by renderClaim; otherwise it sharpens the
   * proof line and fills a statement-pattern slot. See the header note.
   */
  inputLabel: string | null;
  /** Rule id from _data/compliance.ts, or null */
  complianceFlag: string | null;
  /** True when most firm websites already make this claim */
  crowdFlag: boolean;
  /** Shown with the convergence warning on crowd cards, naming what would make this one land */
  crowdNote?: string;
}

/* ──────────────────────────────────────────────────────────────────
 *  Category metadata
 * ────────────────────────────────────────────────────────────────── */

export const CATEGORIES: CategoryMeta[] = [
  {
    id: "practice_focus",
    label: "Practice focus",
    prompt: "What the firm works on, and what it turns away.",
  },
  {
    id: "client_niche",
    label: "Client niche",
    prompt: "Who the firm acts for, described precisely enough to picture.",
  },
  {
    id: "language_culture",
    label: "Language and culture",
    prompt: "How a client is served when English is not the first language.",
  },
  {
    id: "fees_clarity",
    label: "Fees and clarity",
    prompt: "What a client knows about cost, and when they know it.",
  },
  {
    id: "responsiveness",
    label: "Reaching the firm",
    prompt: "What happens between a client's question and the firm's answer.",
  },
  {
    id: "intake_experience",
    label: "How a matter starts",
    prompt: "What the first days of the relationship look like from the client's side.",
  },
  {
    id: "credentials_history",
    label: "Record and background",
    prompt: "What the firm brings that took years to build.",
  },
  {
    id: "process_follow_through",
    label: "How the work runs",
    prompt: "What the client can count on once the matter is open.",
  },
];

/* ──────────────────────────────────────────────────────────────────
 *  Practice focus · 4 cards
 * ────────────────────────────────────────────────────────────────── */

const PRACTICE_FOCUS: DifferentiatorCard[] = [
  {
    id: "single_area_depth",
    category: "practice_focus",
    label: "One area of law",
    claim: "We work in one area of law and take nothing outside it.",
    proofPrompt:
      "What share of your files last year were in this one area? Name the number.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "narrow_matter_type",
    category: "practice_focus",
    label: "One kind of matter",
    claim:
      "Most of our work is one kind of matter, and we have run it many times.",
    proofPrompt:
      "Name the matter type and roughly how many you have handled in the last two years.",
    inputLabel: "The matter type",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "declines_out_of_scope",
    category: "practice_focus",
    label: "We turn work away",
    claim:
      "We decline matters outside our lane and send them to someone who runs them daily.",
    proofPrompt:
      "Name a matter you turned away this year and where you sent it.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "sub_area_focus",
    category: "practice_focus",
    label: "A narrow question",
    claim:
      "Inside our practice area, one narrow question is most of what we handle.",
    proofPrompt:
      "Name the question and what makes it come back file after file.",
    inputLabel: "The question",
    complianceFlag: "R2",
    crowdFlag: false,
  },
];

/* ──────────────────────────────────────────────────────────────────
 *  Client niche · 6 cards
 * ────────────────────────────────────────────────────────────────── */

const CLIENT_NICHE: DifferentiatorCard[] = [
  {
    id: "named_community",
    category: "client_niche",
    label: "A named community",
    claim:
      "We act mainly for [slot], and our intake, materials and referrals follow from that.",
    proofPrompt:
      "Name the community and how clients from it usually reach you.",
    inputLabel: "The community",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "named_industry",
    category: "client_niche",
    label: "A named industry",
    claim:
      "We act for businesses in [slot] and know how that industry runs.",
    proofPrompt:
      "Name one thing about the industry's contracts or regulation you deal with most weeks.",
    inputLabel: "The industry",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "owner_operators",
    category: "client_niche",
    label: "Owner-operated businesses",
    claim:
      "Our clients are owner-operators, not in-house legal departments.",
    proofPrompt:
      "What share of your business clients sign their own retainers?",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "newcomers",
    category: "client_niche",
    label: "Newcomers to Canada",
    claim:
      "Many of our clients are dealing with Canadian process for the first time.",
    proofPrompt:
      "Name what you do differently for a client who has never seen this process before.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "referral_source_niche",
    category: "client_niche",
    label: "A defined referral route",
    claim:
      "A defined group of professionals sends us work because we handle their clients the way they need.",
    proofPrompt:
      "Name the profession and how many files came from it last year.",
    inputLabel: "The profession",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "defined_stage",
    category: "client_niche",
    label: "One point in the story",
    claim:
      "We act at one point in a client's life or business, and we know what comes next.",
    proofPrompt:
      "Name the stage and the two questions clients always ask at it.",
    inputLabel: "The stage",
    complianceFlag: null,
    crowdFlag: false,
  },
];

/* ──────────────────────────────────────────────────────────────────
 *  Language and culture · 3 cards
 * ────────────────────────────────────────────────────────────────── */

const LANGUAGE_CULTURE: DifferentiatorCard[] = [
  {
    id: "second_language_service",
    category: "language_culture",
    label: "The whole matter in another language",
    claim:
      "We run matters end to end in [slot], not only the first call.",
    proofPrompt:
      "Name which documents and meetings you handle in that language.",
    inputLabel: "The language",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "multilingual_intake",
    category: "language_culture",
    label: "Intake in any language",
    claim:
      "A client can describe the problem in their own language at first contact.",
    proofPrompt:
      "Name how intake handles a language nobody at the firm speaks.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "cultural_context",
    category: "language_culture",
    label: "Context that changes the advice",
    claim:
      "We understand the family and business patterns our clients bring, and it changes what we advise.",
    proofPrompt:
      "Name one situation where that context changed your advice.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
];

/* ──────────────────────────────────────────────────────────────────
 *  Fees and clarity · 5 cards
 * ────────────────────────────────────────────────────────────────── */

const FEES_CLARITY: DifferentiatorCard[] = [
  {
    id: "fixed_fee_consult",
    category: "fees_clarity",
    label: "One price for the first meeting",
    claim: "The first meeting has one price, published before you book it.",
    proofPrompt: "Name the price and where a client can read it.",
    inputLabel: "The price",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "flat_fee_matters",
    category: "fees_clarity",
    label: "Flat fees on defined matters",
    claim:
      "Defined matters carry a flat fee, agreed before the work starts.",
    proofPrompt: "Name the matter types and the fee range.",
    inputLabel: "The matter types",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "written_estimate",
    category: "fees_clarity",
    label: "A written estimate first",
    claim:
      "Every client sees a written estimate before signing anything.",
    proofPrompt: "Name what the estimate covers and when it goes out.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "no_surprise_billing",
    category: "fees_clarity",
    label: "No surprise on the bill",
    claim: "Clients hear from us before the bill moves, not after.",
    proofPrompt:
      "Name the amount or the trigger that prompts that call.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "payment_schedule",
    category: "fees_clarity",
    label: "Fees paid across the matter",
    claim:
      "Fees can be paid across the matter on a schedule set at the start.",
    proofPrompt:
      "Name the arrangement and roughly what share of clients use it.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
];

/* ──────────────────────────────────────────────────────────────────
 *  Reaching the firm · 5 cards (2 crowd-flagged)
 * ────────────────────────────────────────────────────────────────── */

const RESPONSIVENESS: DifferentiatorCard[] = [
  {
    id: "same_day_response",
    category: "responsiveness",
    label: "A reply the same day",
    claim: "Inquiries get a reply the same business day.",
    proofPrompt:
      "What is your median reply time, and how do you know the number?",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: true,
    crowdNote:
      "Almost every firm site promises fast replies. A measured median time, taken from your own records, turns the promise into a fact.",
  },
  {
    id: "named_response_window",
    category: "responsiveness",
    label: "A stated response window",
    claim:
      "We answer within a stated window, and clients are told what it is.",
    proofPrompt:
      "Name the window and what happens on the occasions it is missed.",
    inputLabel: "The window",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "direct_lawyer_contact",
    category: "responsiveness",
    label: "The lawyer answers",
    claim:
      "Clients reach the lawyer running the file, not a message taker.",
    proofPrompt:
      "Name how a client reaches you between scheduled meetings.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: true,
    crowdNote:
      "Every solo practice says this. It lands when you name the channel and the hours, because then a client can test it before they retain you.",
  },
  {
    id: "outside_hours",
    category: "responsiveness",
    label: "Evenings or weekends",
    claim:
      "We meet outside business hours because our clients work during them.",
    proofPrompt:
      "Name the hours and roughly how many meetings land there in a month.",
    inputLabel: "The hours",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "personal_service",
    category: "responsiveness",
    label: "Personal attention",
    claim:
      "Every client gets personal attention from the lawyer on the file.",
    proofPrompt:
      "Name one thing a client gets from you that a client of a large firm would not.",
    inputLabel: null,
    complianceFlag: "R4",
    crowdFlag: true,
    crowdNote:
      "This is the most common claim in legal marketing, which is what makes it weak on its own. The proof has to be something a client can point at.",
  },
];

/* ──────────────────────────────────────────────────────────────────
 *  How a matter starts · 4 cards
 * ────────────────────────────────────────────────────────────────── */

const INTAKE_EXPERIENCE: DifferentiatorCard[] = [
  {
    id: "structured_intake",
    category: "intake_experience",
    label: "The situation in writing first",
    claim:
      "By the first call we already have the situation in writing.",
    proofPrompt:
      "Name what you collect before that call, and how a client sends it.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "client_portal",
    category: "intake_experience",
    label: "One place for the file",
    claim:
      "Documents, messages and status sit in one place the client can open.",
    proofPrompt: "Name what the client sees there and when they get access.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "plain_language_retainer",
    category: "intake_experience",
    label: "An engagement letter you can read",
    claim:
      "Our engagement letters are written to be read once and understood.",
    proofPrompt:
      "Name what you rewrote or removed to get there.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "document_checklist",
    category: "intake_experience",
    label: "The document list up front",
    claim:
      "Clients get the full document list at the start, not in pieces.",
    proofPrompt:
      "Name the matter type and what sits on its list.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
];

/* ──────────────────────────────────────────────────────────────────
 *  Record and background · 6 cards (1 crowd-flagged, 2 rule-flagged)
 * ────────────────────────────────────────────────────────────────── */

const CREDENTIALS_HISTORY: DifferentiatorCard[] = [
  {
    id: "years_called",
    category: "credentials_history",
    label: "Years in this work",
    claim: "We have run this work since [slot].",
    proofPrompt:
      "Name the year of call and the year this focus started. They are often different.",
    inputLabel: "The year",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "prior_career",
    category: "credentials_history",
    label: "A career before law",
    claim:
      "Before law, we worked in the industry our clients work in.",
    proofPrompt:
      "Name the role, the years, and what it lets you skip past in a first meeting.",
    inputLabel: "The role",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "teaching_published",
    category: "credentials_history",
    label: "Teaching or writing",
    claim:
      "We teach or publish on the question our clients bring us.",
    proofPrompt:
      "Name the course, publication or talk, and where it can be found.",
    inputLabel: "Where it can be found",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "community_roles",
    category: "credentials_history",
    label: "A role in the community",
    claim:
      "We hold a role in the community we act for, and it predates the practice.",
    proofPrompt: "Name the organization and the role.",
    inputLabel: "The organization",
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "experience_claim",
    category: "credentials_history",
    label: "Years of experience",
    claim: "We have years of experience with matters like yours.",
    proofPrompt:
      "Name the exact number of years and the exact matter type.",
    inputLabel: null,
    complianceFlag: "R5",
    crowdFlag: true,
    crowdNote:
      "Every firm has years of experience. The number and the matter type are what a client can weigh; the phrase on its own is not.",
  },
  {
    id: "past_results",
    category: "credentials_history",
    label: "What past matters achieved",
    claim:
      "We have obtained good outcomes for clients in matters like this one.",
    proofPrompt:
      "Name what you actually control in a matter, whatever the outcome turns out to be.",
    inputLabel: null,
    complianceFlag: "R1",
    crowdFlag: false,
  },
];

/* ──────────────────────────────────────────────────────────────────
 *  How the work runs · 5 cards (1 crowd-flagged)
 * ────────────────────────────────────────────────────────────────── */

const PROCESS_FOLLOW_THROUGH: DifferentiatorCard[] = [
  {
    id: "defined_stages",
    category: "process_follow_through",
    label: "Stages the client can see",
    claim:
      "Every matter runs through stages the client is shown at the start.",
    proofPrompt: "Name the stages for your most common matter.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "proactive_updates",
    category: "process_follow_through",
    label: "Updates without being asked",
    claim:
      "Clients hear from us on a schedule, whether or not something moved.",
    proofPrompt:
      "Name the interval, and what the update says on a week when nothing moved.",
    inputLabel: "The interval",
    complianceFlag: null,
    crowdFlag: true,
    crowdNote:
      "Communication promises are everywhere, and most firms mean them. The interval and the empty-week update are what make yours checkable.",
  },
  {
    id: "post_matter_followup",
    category: "process_follow_through",
    label: "Contact after closing",
    claim:
      "We check in after the file closes, on a date set when it closed.",
    proofPrompt: "Name the interval and what you check.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "referral_network",
    category: "process_follow_through",
    label: "A name for what we decline",
    claim:
      "When a matter is not ours, we name the person who should have it.",
    proofPrompt:
      "Name two professionals you refer to and how often it happens.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
  {
    id: "one_owner",
    category: "process_follow_through",
    label: "One person owns the file",
    claim:
      "One person owns the file from open to close, and the client knows who.",
    proofPrompt: "Name who that is on a typical matter.",
    inputLabel: null,
    complianceFlag: null,
    crowdFlag: false,
  },
];

/* ──────────────────────────────────────────────────────────────────
 *  The deck
 * ────────────────────────────────────────────────────────────────── */

export const DIFFERENTIATOR_CARDS: DifferentiatorCard[] = [
  ...PRACTICE_FOCUS,
  ...CLIENT_NICHE,
  ...LANGUAGE_CULTURE,
  ...FEES_CLARITY,
  ...RESPONSIVENESS,
  ...INTAKE_EXPERIENCE,
  ...CREDENTIALS_HISTORY,
  ...PROCESS_FOLLOW_THROUGH,
];

/** The slot token replaced by the lawyer's own word when a card carries inputLabel. */
export const INPUT_SLOT = "[slot]";

export function getCard(cardId: string): DifferentiatorCard | undefined {
  return DIFFERENTIATOR_CARDS.find((c) => c.id === cardId);
}

export function cardsInCategory(category: Category): DifferentiatorCard[] {
  return DIFFERENTIATOR_CARDS.filter((c) => c.category === category);
}

/**
 * Renders a card claim with the lawyer's own word in the slot. When the card
 * carries no slot, the claim is returned unchanged. When the card carries a slot
 * and the lawyer left it empty, the inputLabel is rendered in lower case so the
 * sentence still reads, and the wizard flags the card as needing an answer.
 */
export function renderClaim(card: DifferentiatorCard, value?: string): string {
  if (!card.claim.includes(INPUT_SLOT)) return card.claim;
  const filled = value?.trim();
  const fallback = card.inputLabel ? card.inputLabel.toLowerCase() : "this";
  return card.claim.replace(INPUT_SLOT, filled && filled.length > 0 ? filled : fallback);
}

/** Maximum cards carried out of pass two and into the statement builder. */
export const KEEP_CAP = 6;
