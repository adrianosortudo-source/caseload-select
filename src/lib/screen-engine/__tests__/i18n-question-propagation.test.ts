/**
 * Regression guard for the i18n question/option propagation contract
 * (DR-035 + DR-039), locked 2026-06-08.
 *
 * Surface: the DRG WhatsApp + web widget PT smoke test
 * ("quero abrir minha empresa no canada") was producing English
 * follow-up questions even though `state.language` was correctly set
 * to 'pt' by the LLM. Three layers of bug were closed together:
 *
 *   1. Layer 1 (propagation): `ScreenEnginePublicWidget.slotToItem`
 *      hardcoded `const language = "en"`; `channel-intake-processor`
 *      `formatDiscoveryQuestion` took no language parameter at all.
 *   2. Layer 2 (infrastructure): the `I18nBundle` interface had no
 *      `slot_questions` key; even with wiring, there was nowhere to
 *      look up translated question text.
 *   3. Layer 3 (data): the `BUNDLES` map only registered `en`; no
 *      `pt.json` existed.
 *
 * This file locks the engine-layer contracts. Widget-level + channel-
 * processor-level integration tests live in their own files.
 */
import { describe, it, expect } from "vitest";
import { getI18n } from "../i18n/loader";
import { getQuestionDisplayText, getOptionDisplayLabel } from "../i18n/display";
import type { SlotOption } from "../types";

describe("getQuestionDisplayText: language-aware question lookup", () => {
  it("returns the English question verbatim when language is 'en'", () => {
    const i18n = getI18n("en");
    expect(
      getQuestionDisplayText(
        "advisory_path",
        "Are you starting something new, or buying into an existing business?",
        "en",
        i18n,
      ),
    ).toBe("Are you starting something new, or buying into an existing business?");
  });

  it("returns the Portuguese translation when language is 'pt' and slot is in the bundle", () => {
    const i18n = getI18n("pt");
    const text = getQuestionDisplayText(
      "advisory_path",
      "Are you starting something new, or buying into an existing business?",
      "pt",
      i18n,
    );
    expect(text).toContain("Você está abrindo um novo negócio");
    expect(text).not.toContain("Are you starting");
  });

  it("falls back to English when the slot id is missing from the PT bundle", () => {
    // employment Phase B slots are intentionally NOT in the launch-week
    // PT scope. They MUST fall back to English so the engine keeps
    // working coherently while translation rolls out matter-type by
    // matter-type.
    const i18n = getI18n("pt");
    const text = getQuestionDisplayText(
      "tenure_band",
      "How long did you work for that employer?",
      "pt",
      i18n,
    );
    expect(text).toBe("How long did you work for that employer?");
  });

  it("falls back to English when bundle has empty string for that slot (defensive)", () => {
    // Guards against a translator delivering an empty string. The
    // helper uses `translated || englishQuestion` not `??` so empty
    // never reaches the lead.
    const fakeBundle = {
      slot_questions: { advisory_path: "" },
      slot_options: {},
      summary: {},
      summary_labels: {},
      prompts: {},
      bridge_text: {},
      chips: {},
    } as never;
    expect(
      getQuestionDisplayText(
        "advisory_path",
        "Are you starting something new, or buying into an existing business?",
        "pt",
        fakeBundle,
      ),
    ).toBe("Are you starting something new, or buying into an existing business?");
  });

  it("falls back to English for languages with no bundle registered", () => {
    // Spanish has no bundle; getI18n returns the English bundle.
    // getQuestionDisplayText sees language !== 'en' so it tries the
    // lookup, finds nothing PT/ES specific in the en bundle's
    // slot_questions (which is undefined / empty), and falls back to
    // the supplied English string.
    const i18n = getI18n("es");
    expect(
      getQuestionDisplayText(
        "advisory_path",
        "Are you starting something new, or buying into an existing business?",
        "es",
        i18n,
      ),
    ).toBe("Are you starting something new, or buying into an existing business?");
  });
});

describe("getOptionDisplayLabel: language-aware option lookup", () => {
  const advisoryOptions: SlotOption[] = [
    { value: "Starting a new business", label: "Starting a new business" },
    { value: "Buying into an existing business", label: "Buying into an existing business" },
    { value: "Not sure", label: "Not sure" },
  ];

  it("returns English labels when language is 'en'", () => {
    const i18n = getI18n("en");
    expect(getOptionDisplayLabel(advisoryOptions[0], "advisory_path", "en", i18n))
      .toBe("Starting a new business");
  });

  it("returns Portuguese labels when language is 'pt' and option is translated", () => {
    const i18n = getI18n("pt");
    expect(getOptionDisplayLabel(advisoryOptions[0], "advisory_path", "pt", i18n))
      .toBe("Abrindo um novo negócio");
    expect(getOptionDisplayLabel(advisoryOptions[1], "advisory_path", "pt", i18n))
      .toBe("Comprando participação em uma empresa existente");
    expect(getOptionDisplayLabel(advisoryOptions[2], "advisory_path", "pt", i18n))
      .toBe("Não tenho certeza");
  });

  it("preserves the canonical English option value regardless of language", () => {
    // The doctrine (DR-035): the slot's `value` stays English so
    // applyAnswer / engine state can interop with the matter packs
    // and the lawyer brief. ONLY the display label changes.
    const i18n = getI18n("pt");
    expect(advisoryOptions[0].value).toBe("Starting a new business");
    expect(getOptionDisplayLabel(advisoryOptions[0], "advisory_path", "pt", i18n))
      .not.toBe(advisoryOptions[0].value);
  });
});

describe("PT bundle DRG launch coverage", () => {
  // Smoke test: every slot in the documented DRG launch-week scope has
  // a PT translation. If a translator removes one or a refactor renames
  // a slot id, this test will surface it.
  it.each([
    "advisory_path",
    "co_owner_count",
    "advisory_concern",
    "signed_anything",
    "documents_exist",
    "advisory_actionability",
    "advisory_specific_task",
    "corporate_problem_type",
    "company_involvement",
    "client_role",
    "counterparty_type",
    "proof_of_ownership",
    "shareholder_agreement",
    "corporate_records_available",
    "amount_at_stake",
    "invoice_exists",
    "payment_status",
    "written_terms",
    "contract_exists",
    "vendor_type",
    "billing_dispute_reason",
    "reporter_role_money",
    "irregularity_type",
    "hiring_timeline",
    "other_counsel",
    "decision_authority",
    "client_name",
    "client_phone",
    "client_email",
  ])("slot '%s' has a Portuguese translation", (slotId) => {
    const i18n = getI18n("pt");
    expect(i18n.slot_questions[slotId]).toBeTruthy();
    expect(i18n.slot_questions[slotId].length).toBeGreaterThan(5);
  });
});
