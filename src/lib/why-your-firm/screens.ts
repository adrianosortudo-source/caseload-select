/**
 * Why Your Firm · Screen sequence
 *
 * Pure functions only, same contract as engine.ts: no React, no fetch, no
 * localStorage, no Date.now(), no Math.random(). Data in, data out.
 *
 * ONE QUESTION PER SCREEN
 * The wizard asks a single thing at a time. That turns the old five-step
 * shape into a derived sequence, because the number of screens is not fixed:
 * every claim the lawyer keeps earns its own test screen, so a run with two
 * kept claims is shorter than a run with six. The counter reports the run the
 * lawyer is actually on rather than a constant that would be a lie for most
 * of them.
 *
 * THE SEQUENCE
 *   alternatives            one screen
 *   passone:<category>      eight screens, CATEGORIES order
 *   keep                    one screen
 *   test:<cardId>           one per kept card, capAndRank order
 *   statement               one screen
 *   results                 one screen, outside the count
 *
 * Eleven fixed screens plus the kept cards, so the denominator moves between
 * eleven and seventeen. Results carries no question number: it is the answer,
 * not a question, and numbering it would claim the lawyer had one more thing
 * to fill in.
 *
 * WHY WizardData LIVES HERE AND NOT IN THE COMPONENT
 * The screen sequence is derived from wizard state, so the sequence builder
 * needs the state's type. Keeping that type in the component would force this
 * library file to import from src/components, inverting the dependency and
 * dragging React into a pure module. The shape is declared here and the
 * component imports it, which is the direction that holds.
 */

import { CATEGORIES, type Category } from "./differentiators";
import { copy } from "./compliance";
import { capAndRank, isCustomId, materializeCard } from "./engine";

/* ──────────────────────────────────────────────────────────────────
 *  Wizard state
 * ────────────────────────────────────────────────────────────────── */

/** Everything the lawyer typed against one kept card. */
export interface CardEntry {
  inputValue: string;
  proof: string;
  tests: { provable: boolean; inDemand: boolean; unique: boolean };
}

export interface WizardData {
  screenKey: string;
  visitedKeys: string[];
  alternativeIds: string[];
  alternativeOther: string;
  /** Pass one selections. May include "custom:<category>". */
  passOneIds: string[];
  /** Pass two selections, capped at KEEP_CAP. May include "custom:<category>". */
  passTwoIds: string[];
  customClaims: Partial<Record<Category, string>>;
  cardEntries: Record<string, CardEntry>;
  anchorCardId: string | null;
  patternId: string | null;
  statementValues: string[];
  firmName: string;
}

/* ──────────────────────────────────────────────────────────────────
 *  Screens
 * ────────────────────────────────────────────────────────────────── */

export type ScreenKind =
  | "alternatives"
  | "passone"
  | "keep"
  | "test"
  | "statement"
  | "results";

export interface WizardScreen {
  /** Stable identity, and what WizardData.screenKey holds. */
  key: string;
  kind: ScreenKind;
  /** Set on passone screens only. */
  category?: Category;
  /** Set on test screens only. */
  cardId?: string;
  /** The line the side menu shows for this screen. */
  menuLabel: string;
  /** The side menu heading this screen sits under. */
  group: string;
}

export const SCREEN_KEY_ALTERNATIVES = "alternatives";
export const SCREEN_KEY_KEEP = "keep";
export const SCREEN_KEY_STATEMENT = "statement";
export const SCREEN_KEY_RESULTS = "results";

export function passOneKey(category: Category): string {
  return `passone:${category}`;
}

export function testKey(cardId: string): string {
  return `test:${cardId}`;
}

/**
 * The full sequence for the run this state describes.
 *
 * The test screens come from capAndRank rather than from passTwoIds directly,
 * so the order a lawyer sees their claims tested in is the same order the
 * brief will rank them, and so a client that somehow submitted more than the
 * cap does not get extra screens out of it.
 */
export function buildScreens(data: WizardData): WizardScreen[] {
  const screens: WizardScreen[] = [
    {
      key: SCREEN_KEY_ALTERNATIVES,
      kind: "alternatives",
      menuLabel: copy.nav.labelAlternatives,
      group: copy.nav.groupAlternatives,
    },
  ];

  for (const category of CATEGORIES) {
    screens.push({
      key: passOneKey(category.id),
      kind: "passone",
      category: category.id,
      menuLabel: category.label,
      group: copy.nav.groupDifferentiators,
    });
  }

  screens.push({
    key: SCREEN_KEY_KEEP,
    kind: "keep",
    menuLabel: copy.nav.labelKeep,
    group: copy.nav.groupKeep,
  });

  for (const cardId of capAndRank(data.passTwoIds)) {
    screens.push({
      key: testKey(cardId),
      kind: "test",
      cardId,
      menuLabel: testMenuLabel(cardId, data.customClaims),
      group: copy.nav.groupTests,
    });
  }

  screens.push({
    key: SCREEN_KEY_STATEMENT,
    kind: "statement",
    menuLabel: copy.nav.labelStatement,
    group: copy.nav.groupStatement,
  });

  screens.push({
    key: SCREEN_KEY_RESULTS,
    kind: "results",
    menuLabel: copy.nav.labelResults,
    group: copy.nav.groupBrief,
  });

  return screens;
}

/**
 * A kept card can be in the sequence before its text exists, because keeping
 * and writing are separate screens. The custom label stands in until the
 * claim is written, so the menu never shows a raw id.
 */
function testMenuLabel(
  cardId: string,
  customClaims: Partial<Record<Category, string>>,
): string {
  const card = materializeCard(cardId, customClaims);
  if (card) return card.label;
  return isCustomId(cardId) ? copy.custom.label : cardId;
}

/**
 * Position of a screen in the counted run: x of y, one-based.
 *
 * Results is excluded from both numerator and denominator, so the last
 * question a lawyer answers reads as the last one. Returns null for the
 * results key and for any key not in this run's sequence.
 */
export function questionNumber(
  screens: WizardScreen[],
  key: string,
): { x: number; y: number } | null {
  if (key === SCREEN_KEY_RESULTS) return null;

  const counted = screens.filter((s) => s.key !== SCREEN_KEY_RESULTS);
  const index = counted.findIndex((s) => s.key === key);
  if (index === -1) return null;

  return { x: index + 1, y: counted.length };
}
