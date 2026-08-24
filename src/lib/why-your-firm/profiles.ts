/**
 * Why Your Firm · Positioning Profiles and Competitive Alternatives
 *
 * TWO SETS OF COPY LIVE HERE
 *
 * 1. ALTERNATIVES (step 1). The wizard opens by asking what a prospective
 *    client does when they do not hire this firm. April Dunford's competitive
 *    alternatives framing: uniqueness only means something measured against
 *    what the client would otherwise do, and for a small firm the real rival is
 *    usually delay or self-help rather than the firm down the street. Every
 *    later test reads against the lawyer's answer here, and the brief opens
 *    with it.
 *
 *    The clientCost line describes what the alternative costs the CLIENT. It
 *    never claims what this firm would achieve instead. That distinction keeps
 *    the copy inside LSO Rule 4.2-1: describing a known feature of a choice is
 *    fair comment, promising a better result is not.
 *
 * 2. PROFILES (step 5). One profile per card category. The lawyer's profile is
 *    the category holding the most surviving cards, ties broken by the fixed
 *    priority order in TIE_BREAK_ORDER.
 *
 *    Profile names are identities, not grades. There is no score anywhere in
 *    this tool: a positioning score cannot be made verifiable, and the audience
 *    is the one most likely to distrust an invented number. The honest
 *    quantitative content of the brief is which cards survived which test.
 *
 *    The watchout line is framed as upside. It names what would make the
 *    position stronger, never what the firm lacks.
 */

import type { Category } from "./differentiators";

/* ──────────────────────────────────────────────────────────────────
 *  Competitive alternatives · step 1
 * ────────────────────────────────────────────────────────────────── */

export interface Alternative {
  id: string;
  /** Card face, in the client's terms */
  label: string;
  /** What this choice costs the client. Never a claim about this firm's results. */
  clientCost: string;
}

export const ALTERNATIVES: Alternative[] = [
  {
    id: "do_nothing",
    label: "Wait, and hope it settles itself",
    clientCost:
      "Time passes and the range of choices narrows. Some options close on a date nobody told them about.",
  },
  {
    id: "self_represent",
    label: "Handle it themselves",
    clientCost:
      "They learn the process on their own matter, and any misstep lands on the file they cannot start over.",
  },
  {
    id: "cheapest_online",
    label: "The cheapest firm they find online",
    clientCost:
      "Price is the only thing they can compare before signing, so price decides.",
  },
  {
    id: "large_firm",
    label: "A large downtown firm",
    clientCost:
      "They retain the firm's name, and meet the lawyer who will actually run the file later.",
  },
  {
    id: "lawyer_they_know",
    label: "A lawyer they already know",
    clientCost:
      "Familiarity settles it before anyone asks whether the work matches the lawyer.",
  },
];

/** The optional free-text answer at step 1. */
export const ALTERNATIVE_OTHER_ID = "other";

export function getAlternative(id: string): Alternative | undefined {
  return ALTERNATIVES.find((a) => a.id === id);
}

/* ──────────────────────────────────────────────────────────────────
 *  Positioning profiles · step 5
 * ────────────────────────────────────────────────────────────────── */

export interface PositioningProfile {
  id: Category;
  /** The headline identity, 2 to 4 words */
  name: string;
  /** One line under the name */
  oneLiner: string;
  /** Two sentences on what this position does when it is working */
  strength: string;
  /** One sentence, framed as upside, on what would make it stronger */
  watchout: string;
}

export const PROFILES: PositioningProfile[] = [
  {
    id: "practice_focus",
    name: "The Narrow Practice",
    oneLiner: "The firm is known for the work it does, and for the work it declines.",
    strength:
      "A client with the matter you focus on can tell within a sentence that they have found the right office. Referral sources learn the boundary quickly, and the files that arrive need less sorting.",
    watchout:
      "The position gets sharper the moment you attach a number to the focus, because a share of files is something a stranger can weigh.",
  },
  {
    id: "client_niche",
    name: "The Defined Client",
    oneLiner: "The firm is built around a client it can describe precisely.",
    strength:
      "When the client is named this clearly, everything downstream gets easier to write: the website, the intake questions, the first meeting. The people who send you work know exactly who to send.",
    watchout:
      "Naming what that client needs that a general practice would miss turns a description into a reason to choose you.",
  },
  {
    id: "language_culture",
    name: "The Open Door",
    oneLiner: "A client can bring the problem in the language they think in.",
    strength:
      "Language at the door decides who ever becomes a client, long before legal merit enters the picture. A firm that removes that barrier reaches matters other offices never hear about.",
    watchout:
      "The position carries further when you name which parts of the matter run in that language, since a first call and a full file are different promises.",
  },
  {
    id: "fees_clarity",
    name: "The Known Price",
    oneLiner: "The client knows what this costs before they are committed.",
    strength:
      "Fee uncertainty is the reason many people wait too long to call a lawyer. Publishing the number removes the reason to hesitate and filters for clients who are ready to proceed.",
    watchout:
      "Putting the actual figure where a client can read it without asking is what separates this position from a promise of fairness.",
  },
  {
    id: "responsiveness",
    name: "The Reachable Firm",
    oneLiner: "The client can get an answer, and knows when to expect it.",
    strength:
      "Most complaints about lawyers are about silence rather than outcomes. A firm that answers predictably keeps clients calm and keeps matters moving on the schedule the file needs.",
    watchout:
      "Because every firm claims this, your version lands on the specifics: the window, the channel, and how you know you are meeting it.",
  },
  {
    id: "intake_experience",
    name: "The Prepared Start",
    oneLiner: "The matter is organized before the first meeting begins.",
    strength:
      "A client who arrives with the situation already written down gets a first meeting about their problem rather than about paperwork. The lawyer starts with context instead of assembling it live.",
    watchout:
      "Naming what you collect before that meeting lets a prospective client picture their own first week with you.",
  },
  {
    id: "credentials_history",
    name: "The Long Record",
    oneLiner: "The firm brings something that took years to build.",
    strength:
      "Background is the one differentiator a competitor cannot decide to copy next quarter. When it connects directly to the client's situation, it does more work than any description of service.",
    watchout:
      "The record persuades hardest when you draw the line yourself, from the background to the thing it lets you do faster or better on the client's file.",
  },
  {
    id: "process_follow_through",
    name: "The Managed Matter",
    oneLiner: "The client knows where the matter stands, and what happens next.",
    strength:
      "A defined process turns a legal matter from an anxious wait into a sequence the client can follow. It also makes the firm easier to run, because the next step is never a question.",
    watchout:
      "Showing the stages themselves, in the client's words, makes this position visible to someone who has not retained you yet.",
  },
];

/**
 * Tie-break order when two categories hold the same number of surviving cards.
 * Fixed and deliberate: the categories are ordered by how hard they are for a
 * competitor to copy, so a tie resolves toward the more defensible position.
 */
export const TIE_BREAK_ORDER: Category[] = [
  "practice_focus",
  "client_niche",
  "language_culture",
  "fees_clarity",
  "responsiveness",
  "intake_experience",
  "credentials_history",
  "process_follow_through",
];

export function getProfile(id: Category): PositioningProfile | undefined {
  return PROFILES.find((p) => p.id === id);
}

/**
 * Resolves the profile from the surviving cards' categories.
 * Highest count wins; ties resolve by TIE_BREAK_ORDER. Returns null when no
 * cards survive, which the wizard handles as its own outcome rather than
 * inventing a profile from nothing.
 */
export function resolveProfile(
  survivingCategories: Category[],
): PositioningProfile | null {
  if (survivingCategories.length === 0) return null;

  const counts = new Map<Category, number>();
  for (const category of survivingCategories) {
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  let winner: Category | null = null;
  let winnerCount = 0;

  for (const category of TIE_BREAK_ORDER) {
    const count = counts.get(category) ?? 0;
    if (count > winnerCount) {
      winner = category;
      winnerCount = count;
    }
  }

  return winner ? (getProfile(winner) ?? null) : null;
}
