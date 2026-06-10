/**
 * Widget-level regression guard for the PT propagation fix
 * (2026-06-08). Tests the pure helper `slotToItem` against PT vs EN
 * states; if a future change reverts to hardcoded English, the widget
 * UI bug returns and this test fails loudly.
 */
import { describe, it, expect } from "vitest";
import { slotToItem } from "../ScreenEnginePublicWidget";
import { getI18n } from "@/lib/screen-engine/i18n/loader";
import { SLOT_REGISTRY } from "@/lib/screen-engine/slotRegistry";
import type { SlotDefinition } from "@/lib/screen-engine/types";

function findSlot(id: string): SlotDefinition {
  const slot = SLOT_REGISTRY.find((s) => s.id === id);
  if (!slot) throw new Error(`Slot not found: ${id}`);
  return slot;
}

describe("ScreenEnginePublicWidget.slotToItem: language-aware rendering", () => {
  it("renders 'advisory_path' in Portuguese when language is 'pt'", () => {
    // Reproduces the DRG PT smoke test path: user opener is in PT, LLM
    // sets state.language='pt', getNextStep returns advisory_path slot,
    // widget renders the card.
    const slot = findSlot("advisory_path");
    const i18n = getI18n("pt");
    const item = slotToItem(slot, "pt", i18n);

    expect(item.question).toContain("Você está abrindo um novo negócio");
    expect(item.question).not.toContain("Are you starting");

    const labels = item.options?.map((o) => o.label) ?? [];
    expect(labels).toContain("Abrindo um novo negócio");
    expect(labels).toContain("Comprando participação em uma empresa existente");
    expect(labels).toContain("Não tenho certeza");
    expect(labels).not.toContain("Starting a new business");
  });

  it("preserves canonical English option values regardless of language", () => {
    // The lawyer brief is always English (DR-036), so the engine's
    // slot.value MUST stay English even when the lead saw PT.
    const slot = findSlot("advisory_path");
    const i18n = getI18n("pt");
    const item = slotToItem(slot, "pt", i18n);

    const values = item.options?.map((o) => o.value) ?? [];
    expect(values).toContain("Starting a new business");
    expect(values).toContain("Buying into an existing business");
    expect(values).toContain("Not sure");
  });

  it("renders 'advisory_path' in English when language is 'en'", () => {
    // Baseline: nothing changes for English leads.
    const slot = findSlot("advisory_path");
    const i18n = getI18n("en");
    const item = slotToItem(slot, "en", i18n);

    expect(item.question).toBe(
      "Are you starting something new, or buying into an existing business?",
    );
    const labels = item.options?.map((o) => o.label) ?? [];
    expect(labels).toContain("Starting a new business");
  });

  it("falls back to English when a PT lead hits an out-of-scope matter type", () => {
    // Employment Phase B is intentionally NOT in the launch-week PT
    // scope; a PT lead with a wrongful_dismissal classification gets
    // English question text. Tested via 'tenure_band' (wrongful_
    // dismissal slot, not in pt.json).
    const slot = findSlot("tenure_band");
    const i18n = getI18n("pt");
    const item = slotToItem(slot, "pt", i18n);

    // Question text falls back to the English source from slotRegistry.
    expect(item.question).toBe(slot.question);
    expect(item.question).not.toContain("Você");
  });
});

describe("Kickoff localization (initialLang hint, 2026-06-08)", () => {
  // The kickoff screen renders before the engine detects language, so it
  // reads the PT bundle's widget_strings via the embedding page's
  // ?lang=pt hint. These keys MUST exist in pt.json or a PT embed shows
  // English kickoff copy (the bug this guards against). The widget reads
  // them through ws(key, englishFallback); EN intentionally has no keys
  // and uses the fallbacks.
  const KICKOFF_KEYS = [
    "kickoff_heading",
    "kickoff_helper",
    "kickoff_placeholder",
    "kickoff_submit",
    "kickoff_examples_label",
    "kickoff_example_1",
    "kickoff_example_2",
    "kickoff_example_3",
  ];

  it("pt bundle carries every kickoff_* widget string", () => {
    const pt = getI18n("pt");
    for (const key of KICKOFF_KEYS) {
      expect(pt.widget_strings?.[key], `pt.json missing widget_strings.${key}`).toBeTruthy();
    }
  });

  it("pt kickoff strings are actually Portuguese, not English passthrough", () => {
    const pt = getI18n("pt");
    expect(pt.widget_strings?.["kickoff_heading"]).toContain("advogado");
    expect(pt.widget_strings?.["kickoff_submit"]).toContain("revisão");
    expect(pt.widget_strings?.["kickoff_examples_label"]).toContain("começar");
  });

  it("en bundle has no kickoff keys (uses inline English fallbacks)", () => {
    // EN intentionally relies on the ws() fallback literals in the
    // component, keeping en.json free of widget_strings. If someone adds
    // EN kickoff keys later this is not a failure, but the widget must
    // still render, so we only assert the bundle resolves.
    const en = getI18n("en");
    expect(en).toBeTruthy();
  });
});
