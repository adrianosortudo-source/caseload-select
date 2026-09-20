import { describe, it, expect } from "vitest";
import {
  buildScreens,
  questionNumber,
  passOneKey,
  testKey,
  SCREEN_KEY_ALTERNATIVES,
  SCREEN_KEY_KEEP,
  SCREEN_KEY_STATEMENT,
  SCREEN_KEY_RESULTS,
  type WizardData,
} from "../screens";
import { CATEGORIES, DIFFERENTIATOR_CARDS, KEEP_CAP, getCard } from "../differentiators";
import { copy } from "../compliance";
import { customIdFor } from "../engine";

/** The eleven screens that exist on every run, before any card is kept. */
const FIXED_SCREEN_COUNT = 1 + CATEGORIES.length + 1 + 1;

function wizard(overrides: Partial<WizardData> = {}): WizardData {
  return {
    screenKey: SCREEN_KEY_ALTERNATIVES,
    visitedKeys: [],
    alternativeIds: [],
    alternativeOther: "",
    passOneIds: [],
    passTwoIds: [],
    customClaims: {},
    cardEntries: {},
    anchorCardId: null,
    patternId: null,
    statementValues: [],
    firmName: "",
    ...overrides,
  };
}

describe("buildScreens: sequence", () => {
  it("with nothing kept, runs alternatives, eight groups, keep, statement, results", () => {
    const screens = buildScreens(wizard());
    expect(screens).toHaveLength(FIXED_SCREEN_COUNT + 1);
    expect(screens.map((s) => s.key)).toEqual([
      SCREEN_KEY_ALTERNATIVES,
      ...CATEGORIES.map((c) => passOneKey(c.id)),
      SCREEN_KEY_KEEP,
      SCREEN_KEY_STATEMENT,
      SCREEN_KEY_RESULTS,
    ]);
  });

  it("with one kept card, inserts exactly one test screen before the statement", () => {
    const screens = buildScreens(wizard({ passTwoIds: ["single_area_depth"] }));
    expect(screens).toHaveLength(FIXED_SCREEN_COUNT + 2);

    const keys = screens.map((s) => s.key);
    expect(keys).toContain(testKey("single_area_depth"));
    expect(keys.indexOf(testKey("single_area_depth"))).toBeGreaterThan(
      keys.indexOf(SCREEN_KEY_KEEP),
    );
    expect(keys.indexOf(testKey("single_area_depth"))).toBeLessThan(
      keys.indexOf(SCREEN_KEY_STATEMENT),
    );
  });

  it("with six kept cards, inserts six test screens in capAndRank order", () => {
    const six = DIFFERENTIATOR_CARDS.slice(0, KEEP_CAP).map((c) => c.id);
    const screens = buildScreens(wizard({ passTwoIds: [...six].reverse() }));
    expect(screens).toHaveLength(FIXED_SCREEN_COUNT + 1 + KEEP_CAP);

    const testScreens = screens.filter((s) => s.kind === "test");
    expect(testScreens.map((s) => s.cardId)).toEqual(six);
  });

  it("never exceeds the cap even when the state carries more than six ids", () => {
    const eight = DIFFERENTIATOR_CARDS.slice(0, 8).map((c) => c.id);
    const screens = buildScreens(wizard({ passTwoIds: eight }));
    expect(screens.filter((s) => s.kind === "test")).toHaveLength(KEEP_CAP);
  });
});

describe("buildScreens: labels and groups", () => {
  it("labels the fixed screens from copy.nav", () => {
    const screens = buildScreens(wizard());
    const byKey = new Map(screens.map((s) => [s.key, s]));

    expect(byKey.get(SCREEN_KEY_ALTERNATIVES)?.menuLabel).toBe(copy.nav.labelAlternatives);
    expect(byKey.get(SCREEN_KEY_ALTERNATIVES)?.group).toBe(copy.nav.groupAlternatives);
    expect(byKey.get(SCREEN_KEY_KEEP)?.menuLabel).toBe(copy.nav.labelKeep);
    expect(byKey.get(SCREEN_KEY_KEEP)?.group).toBe(copy.nav.groupKeep);
    expect(byKey.get(SCREEN_KEY_STATEMENT)?.menuLabel).toBe(copy.nav.labelStatement);
    expect(byKey.get(SCREEN_KEY_STATEMENT)?.group).toBe(copy.nav.groupStatement);
    expect(byKey.get(SCREEN_KEY_RESULTS)?.menuLabel).toBe(copy.nav.labelResults);
    expect(byKey.get(SCREEN_KEY_RESULTS)?.group).toBe(copy.nav.groupBrief);
  });

  it("labels each pass-one screen with its category label and carries the category", () => {
    const screens = buildScreens(wizard()).filter((s) => s.kind === "passone");
    expect(screens.map((s) => s.category)).toEqual(CATEGORIES.map((c) => c.id));
    expect(screens.map((s) => s.menuLabel)).toEqual(CATEGORIES.map((c) => c.label));
    expect(screens.every((s) => s.group === copy.nav.groupDifferentiators)).toBe(true);
  });

  it("labels a deck test screen with the card's own label", () => {
    const screens = buildScreens(wizard({ passTwoIds: ["single_area_depth"] }));
    const test = screens.find((s) => s.kind === "test");
    expect(test?.menuLabel).toBe(getCard("single_area_depth")?.label);
    expect(test?.group).toBe(copy.nav.groupTests);
  });

  it("labels a custom test screen with the custom label, written or not", () => {
    const id = customIdFor("fees_clarity");

    const written = buildScreens(
      wizard({
        passTwoIds: [id],
        customClaims: { fees_clarity: "We publish every fee on the website." },
      }),
    ).find((s) => s.kind === "test");
    expect(written?.menuLabel).toBe(copy.custom.label);

    const blank = buildScreens(wizard({ passTwoIds: [id] })).find((s) => s.kind === "test");
    expect(blank?.menuLabel).toBe(copy.custom.label);
  });
});

describe("questionNumber", () => {
  it("counts eleven questions on a run with nothing kept", () => {
    const screens = buildScreens(wizard());
    expect(questionNumber(screens, SCREEN_KEY_ALTERNATIVES)).toEqual({ x: 1, y: 11 });
    expect(questionNumber(screens, SCREEN_KEY_STATEMENT)).toEqual({ x: 11, y: 11 });
  });

  it("counts seventeen on a full run, and numbers the screens in order", () => {
    const six = DIFFERENTIATOR_CARDS.slice(0, KEEP_CAP).map((c) => c.id);
    const screens = buildScreens(wizard({ passTwoIds: six }));

    expect(questionNumber(screens, SCREEN_KEY_ALTERNATIVES)).toEqual({ x: 1, y: 17 });
    expect(questionNumber(screens, passOneKey(CATEGORIES[0].id))).toEqual({ x: 2, y: 17 });
    expect(questionNumber(screens, SCREEN_KEY_KEEP)).toEqual({ x: 10, y: 17 });
    expect(questionNumber(screens, testKey(six[0]))).toEqual({ x: 11, y: 17 });
    expect(questionNumber(screens, testKey(six[5]))).toEqual({ x: 16, y: 17 });
    expect(questionNumber(screens, SCREEN_KEY_STATEMENT)).toEqual({ x: 17, y: 17 });
  });

  it("returns null for the results screen", () => {
    expect(questionNumber(buildScreens(wizard()), SCREEN_KEY_RESULTS)).toBeNull();
  });

  it("returns null for a key that is not in this run", () => {
    const screens = buildScreens(wizard());
    expect(questionNumber(screens, testKey("single_area_depth"))).toBeNull();
    expect(questionNumber(screens, "not_a_screen")).toBeNull();
  });

  it("the denominator grows by one per kept card, and never counts results", () => {
    for (let kept = 0; kept <= KEEP_CAP; kept += 1) {
      const ids = DIFFERENTIATOR_CARDS.slice(0, kept).map((c) => c.id);
      const screens = buildScreens(wizard({ passTwoIds: ids }));
      expect(questionNumber(screens, SCREEN_KEY_ALTERNATIVES)?.y).toBe(11 + kept);
      expect(screens).toHaveLength(11 + kept + 1);
    }
  });
});
