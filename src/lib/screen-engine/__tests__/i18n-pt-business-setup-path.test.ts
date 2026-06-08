/**
 * Path-level guard for the business_setup_advisory PT coverage (2026-06-08).
 *
 * Field-reported gap: a PT lead's 3rd question reverted to English
 * because the engine selector ranks by priority+tier and the
 * higher-priority slots beyond advisory_path / co_owner_count /
 * advisory_concern fall through to English when their `slot_questions`
 * or `slot_options` entries are missing from pt.json.
 *
 * This test discovers every slot with
 * `applies_to.includes('business_setup_advisory')` directly from the
 * SLOT_REGISTRY (so it doesn't go stale when new slots are added),
 * and asserts BOTH the question AND every option have PT entries.
 * A free_text slot has no options, so only the question is checked.
 *
 * What this catches:
 *  - New business_setup_advisory slot added without PT translation
 *  - Slot option renamed in slotRegistry without updating pt.json
 *  - PT bundle key drift (typo, accidental removal)
 *
 * What this does NOT catch:
 *  - Translation quality (a wrong-but-present PT string passes)
 *  - Slots outside business_setup_advisory (those are explicit out-of-
 *    scope today; covered by their own per-matter-type FOLLOWUPS)
 */
import { describe, it, expect } from "vitest";
import { SLOT_REGISTRY } from "../slotRegistry";
import { getI18n } from "../i18n/loader";
import type { SlotDefinition } from "../types";

const businessSetupSlots: SlotDefinition[] = SLOT_REGISTRY.filter((s) =>
  s.applies_to.includes("business_setup_advisory" as never),
);

const i18nPt = getI18n("pt");

describe("PT coverage for the full business_setup_advisory path", () => {
  it("discovered the expected slot count (sanity check)", () => {
    // If this number changes, slotRegistry added or dropped a
    // business_setup_advisory slot. Update the constant + verify
    // pt.json + every it.each below picks up the new slot.
    expect(businessSetupSlots.length).toBeGreaterThanOrEqual(15);
  });

  it.each(businessSetupSlots.map((s) => [s.id, s] as const))(
    "slot '%s' has a Portuguese question translation",
    (slotId, _slot) => {
      const translated = i18nPt.slot_questions?.[slotId];
      expect(translated, `Missing PT slot_questions['${slotId}'] in pt.json`).toBeTruthy();
      expect(translated!.length).toBeGreaterThan(5);
      // Defensive: PT should differ from the canonical English source.
      // Catches the case where a translator pastes the EN string by accident.
      const englishQuestion = _slot.question;
      expect(translated).not.toBe(englishQuestion);
    },
  );

  it.each(
    businessSetupSlots
      .filter((s) => s.options && s.options.length > 0)
      .flatMap((s) => s.options!.map((opt) => [s.id, opt.value, opt.label] as const)),
  )(
    "slot '%s' option '%s' has a Portuguese label",
    (slotId, optValue, optLabel) => {
      const slotMap = i18nPt.slot_options?.[slotId];
      expect(slotMap, `Missing PT slot_options['${slotId}'] entry in pt.json`).toBeTruthy();
      const translated = slotMap![optValue];
      expect(
        translated,
        `Missing PT slot_options['${slotId}']['${optValue}'] in pt.json`,
      ).toBeTruthy();
      expect(translated.length).toBeGreaterThan(0);
      // Defensive: PT label should differ from the EN label except for
      // identifier-style strings (proper nouns, currency tokens) where
      // a direct copy is correct. We allow the exception by skipping
      // when the EN label is <= 3 chars or contains only digits + $.
      if (optLabel.length > 3 && !/^[$\d\s,.\-]+$/.test(optLabel)) {
        expect(
          translated,
          `PT label for '${slotId}'.'${optValue}' is identical to English; likely a copy-paste miss`,
        ).not.toBe(optLabel);
      }
    },
  );

  it("the free-text fallback affordance has a PT label", () => {
    // The synthetic "Something else (I will explain)" option that
    // DecisionCard renders when allowFreeText is true. Wired through
    // ScreenItem.freeTextLabel + widget_strings.free_text_other_label.
    expect(i18nPt.widget_strings?.["free_text_other_label"]).toBeTruthy();
    expect(i18nPt.widget_strings?.["free_text_other_label"]).not.toContain(
      "Something else",
    );
  });
});

describe("PT review screen coverage for business_setup_advisory", () => {
  // buildLeadSummaryI18n reads from i18n.summary[matter_type] for the
  // intro + closing strings, and from i18n.summary_labels for the
  // recap point labels. Without these, a PT lead's review screen
  // falls back to the English originals via the cascade and the user
  // sees a mixed-language recap.

  const summaryBlock = i18nPt.summary?.["business_setup_advisory"];

  it("has summary intro variants for every advisory_subtrack the engine emits", () => {
    expect(summaryBlock).toBeTruthy();
    expect(summaryBlock!["intro_default"]).toBeTruthy();
    expect(summaryBlock!["intro_partner_setup"]).toBeTruthy();
    expect(summaryBlock!["intro_solo_setup"]).toBeTruthy();
    expect(summaryBlock!["intro_buy_in"]).toBeTruthy();
  });

  it("has a closing string for the business_setup_advisory summary", () => {
    expect(summaryBlock!["closing"]).toBeTruthy();
    expect(summaryBlock!["closing"].length).toBeGreaterThan(20);
  });

  it.each([
    "what_you_do",
    "where_you_are",
    "business_location",
    "revenue_expectation",
    "hiring_plans",
    "regulated_area",
    "clients_outside_canada",
    "ip_protection",
  ])("recap label '%s' is translated", (labelKey) => {
    expect(i18nPt.summary_labels?.[labelKey]).toBeTruthy();
  });
});

describe("PT widget chrome coverage", () => {
  // Every UI chrome string the widget renders post-language-detection
  // must be translated so the visible flow stays Portuguese end-to-end.
  it.each([
    "shell_round_about_your_case",
    "shell_round_your_details",
    "shell_round_submitted",
    "shell_round_review",
    "shell_back",
    "shell_skip",
    "loading_reading",
    "loading_preparing",
    "insight_heading",
    "insight_cta",
    "contact_heading",
    "contact_sub",
    "contact_field_name_label",
    "contact_field_phone_label",
    "contact_field_email_label",
    "contact_submit",
    "done_heading",
    "done_body_template",
    "status_submitted",
    "free_text_other_label",
  ])("widget_strings has key '%s'", (key) => {
    expect(i18nPt.widget_strings?.[key]).toBeTruthy();
  });

  it("done_body_template contains the firmName placeholder", () => {
    // Widget injects the firm name via .replace(/\{firmName\}/g, ...).
    // If the placeholder is missing the live name never appears.
    expect(i18nPt.widget_strings!["done_body_template"]).toContain("{firmName}");
  });
});
