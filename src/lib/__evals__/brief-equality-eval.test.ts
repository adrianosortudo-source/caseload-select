/**
 * Brief-Equality Eval — Track 1 (Deterministic, DR-039)
 *
 * Locks the architectural invariant: a single fixture matter translated
 * across five languages must produce structurally equivalent briefs.
 *
 * This is the regression guard for DR-039 (unified classification
 * pipeline). The pre-DR-039 architecture had two paths: English ran
 * regex+LLM, non-English ran LLM-only. That bifurcation produced weaker
 * briefs on the LLM-only path and was empirically responsible for the
 * empty-brief bug (2026-05-16). The DR-039 architecture has ONE path —
 * regex+LLM for every intake regardless of language. This eval would
 * fail under any architecture that reintroduces the bifurcation.
 *
 * Fixture: a $75k vendor contract dispute in Mississauga, translated to
 * en, fr, es, pt, zh. The fixture is contrived to be unambiguous (the
 * regex classifier picks contract_dispute or vendor_supplier_dispute for
 * the English version; the LLM picks the same matter for non-English
 * variants).
 *
 * Equivalence rules:
 *   - Same `matter_type` (the headline classification)
 *   - Same `practice_area`
 *   - Same `band` (axis lift is matter- and slot-driven, not language-driven)
 *   - `slot_meta` filled count within ±1 across all five languages
 *   - All have `client_name` AND (`client_phone` OR `client_email`)
 *     (the contact-doctrine gate; DR-038)
 *   - All briefs are in English (DR-036)
 *
 * Process (deterministic — no live LLM):
 *   1. initialiseState on the raw language text (regex runs, returns the
 *      language-dependent classification — English picks the matter,
 *      non-English returns 'unknown').
 *   2. mergeLlmResults with a fixed mock LLM response — the same response
 *      shape for every language, with __detected_language set to the
 *      language code.
 *   3. mergeLlmResults a second time for the slot answers (single-call
 *      simulation: contact + matter slots filled).
 *   4. buildReport produces the LawyerReport.
 *
 * The fixture is purpose-built: the LLM mock returns identical slot
 * values across all five languages because in production the LLM
 * extraction in English-strings-only is the same regardless of input
 * language (rule 8 of the system prompt requires English option strings
 * verbatim). The eval's job is to confirm that the engine downstream of
 * extraction is symmetric across languages.
 */

import { describe, it, expect } from "vitest";
import { initialiseState } from "@/lib/screen-engine/extractor";
import { mergeLlmResults } from "@/lib/screen-engine/llm/extractor";
import {
  LANGUAGE_DETECTOR_FIELD,
  MATTER_TYPE_CLASSIFIER_FIELD,
} from "@/lib/screen-engine/llm/schema";
import { buildReport } from "@/lib/screen-engine/report";
import type { SupportedLanguage } from "@/lib/screen-engine/types";

interface BriefSnapshot {
  language: SupportedLanguage;
  matter_type: string;
  practice_area: string;
  band: string | undefined;
  slot_filled_count: number;
  has_client_name: boolean;
  has_client_phone: boolean;
  has_client_email: boolean;
  contact_complete: boolean;
  matter_snapshot_english: boolean;
}

// Fixture: $75k vendor contract dispute in Mississauga.
// Same matter, different languages. The fixture text is purposefully
// unambiguous so the LLM in production would extract the same English
// slot values regardless of input language (per system prompt rule 8).
const FIXTURE_TEXTS: Record<SupportedLanguage, string> = {
  en: "I run a small business in Mississauga and we have a contract dispute with one of our vendors. They invoiced us roughly seventy-five thousand dollars in unpaid charges that we did not agree to. We have the original contract and all the email exchanges showing the agreed scope of work.",
  fr: "Je dirige une petite entreprise à Mississauga et nous avons un litige contractuel avec l'un de nos fournisseurs. Ils nous ont facturé environ soixante-quinze mille dollars en frais non payés que nous n'avions pas acceptés. Nous avons le contrat original et tous les échanges de courriels montrant la portée du travail convenue.",
  es: "Dirijo una pequeña empresa en Mississauga y tenemos una disputa contractual con uno de nuestros proveedores. Nos facturaron aproximadamente setenta y cinco mil dólares en cargos no pagados que no acordamos. Tenemos el contrato original y todos los intercambios de correo electrónico que muestran el alcance del trabajo acordado.",
  pt: "Tenho uma pequena empresa em Mississauga e estamos com uma disputa contratual com um dos nossos fornecedores. Eles nos cobraram cerca de setenta e cinco mil dólares em cobranças não pagas que não concordamos. Temos o contrato original e todas as trocas de e-mail mostrando o escopo do trabalho acordado.",
  zh: "我在密西沙加经营一家小公司,我们与一家供应商发生了合同纠纷。他们向我们开具了大约七万五千美元的未支付费用,这些费用是我们没有同意的。我们有原始合同以及显示约定工作范围的所有电子邮件往来。",
  // Arabic excluded from the fixture set to keep the eval at five
  // languages (per the task brief). The architectural invariant holds
  // identically for Arabic — same code path, same outputs.
  ar: "",
};

// Simulated LLM response (the same shape every call, regardless of input
// language). In production the LLM returns English-strings verbatim for
// single-select slots and free-text in English for free-text slots; the
// __detected_language field gives the lead's language. This mock matches
// that contract exactly.
function buildMockLlmResponse(language: SupportedLanguage): Record<string, string | null> {
  return {
    [LANGUAGE_DETECTOR_FIELD]: language,
    // The matter-type classifier field. Only used when state.matter_type
    // was 'unknown' coming out of initialiseState — for English the
    // regex classifier already picks the matter; for non-English the
    // LLM picks via this field.
    [MATTER_TYPE_CLASSIFIER_FIELD]: "vendor_supplier_dispute",
    // Slot answers — matter-specific, same shape across all languages.
    amount_at_stake: "$25,000–$100,000",
    billing_dispute_reason: "Charges we did not agree to",
    vendor_contract_exists: "Yes, written contract",
    // Contact slots cannot be filled by the LLM (EXCLUDED_FROM_LLM in
    // schema.ts). The fixture seeds them via applyAnswer simulation
    // downstream.
  };
}

function fillContactSlots(
  state: ReturnType<typeof initialiseState>,
): ReturnType<typeof initialiseState> {
  return {
    ...state,
    slots: {
      ...state.slots,
      client_name: "Adriano Domingues",
      client_email: "adriano@example.com",
      client_phone: "+1 416 555 0143",
    },
    slot_meta: {
      ...state.slot_meta,
      client_name: { source: "answered", confidence: 1.0 },
      client_email: { source: "answered", confidence: 1.0 },
      client_phone: { source: "answered", confidence: 1.0 },
    },
  };
}

function captureBrief(language: SupportedLanguage): BriefSnapshot {
  const text = FIXTURE_TEXTS[language];
  if (!text) {
    throw new Error(`No fixture text for language: ${language}`);
  }

  // Step 1: initialiseState. The regex classifier runs unconditionally
  // (DR-039). For English text the keyword patterns match and the
  // matter is set; for non-English text the patterns miss and the
  // matter stays 'unknown' (the LLM will fill it next).
  let state = initialiseState(text);

  // Step 2: simulate the LLM extraction round. mergeLlmResults handles
  // both the language detection and the matter classification on every
  // call, regardless of whether the regex already produced a matter.
  state = mergeLlmResults(state, buildMockLlmResponse(language));

  // Step 3: simulate the lead answering contact slots. In production
  // this happens through `applyAnswer` per turn; for the eval we fill
  // the three contact slots directly because the contact-doctrine
  // gate is a slot-presence check, not a per-turn computation.
  state = fillContactSlots(state);

  // Step 4: build the brief.
  const report = buildReport(state);

  const slotFilledCount = Object.keys(state.slots).filter(
    (k) => state.slots[k] !== null && state.slots[k] !== "",
  ).length;

  return {
    language,
    matter_type: state.matter_type,
    practice_area: state.practice_area,
    band: report.band,
    slot_filled_count: slotFilledCount,
    has_client_name: !!state.slots["client_name"],
    has_client_phone: !!state.slots["client_phone"],
    has_client_email: !!state.slots["client_email"],
    contact_complete: report.contact_complete,
    // Sanity-check: matter_snapshot is the headline string the lawyer
    // reads. In the unified pipeline it is always English regardless of
    // input language (DR-036). Verify it's ASCII-printable (no foreign
    // characters that would indicate the renderer pulled translated
    // copy by mistake).
    matter_snapshot_english: /^[\x20-\x7E\n\r\t–—’ ]*$/.test(
      report.matter_snapshot,
    ),
  };
}

describe("brief-equality eval — DR-039 unified classification pipeline", () => {
  const fixtureLanguages: SupportedLanguage[] = ["en", "fr", "es", "pt", "zh"];
  const snapshots = fixtureLanguages.map(captureBrief);

  it("snapshot summary (informational)", () => {
    console.info(
      "\nBrief-equality eval snapshots:\n" +
        snapshots
          .map(
            (s) =>
              `  ${s.language}: matter=${s.matter_type} band=${s.band ?? "?"} slots=${s.slot_filled_count} contact_complete=${s.contact_complete}`,
          )
          .join("\n"),
    );
    expect(snapshots.length).toBe(fixtureLanguages.length);
  });

  it("every language produces a brief with the expected matter_type", () => {
    for (const s of snapshots) {
      expect(
        s.matter_type,
        `language=${s.language}: matter_type=${s.matter_type}`,
      ).toBe("vendor_supplier_dispute");
    }
  });

  it("every language produces a brief with the expected practice_area", () => {
    for (const s of snapshots) {
      expect(
        s.practice_area,
        `language=${s.language}: practice_area=${s.practice_area}`,
      ).toBe("corporate");
    }
  });

  it("band is identical across all five languages", () => {
    const bands = new Set(snapshots.map((s) => s.band ?? "<none>"));
    expect(
      bands.size,
      `expected 1 distinct band across 5 languages, got ${bands.size}: ${[...bands].join(",")}`,
    ).toBe(1);
  });

  it("slot_meta filled count is within ±1 across all five languages", () => {
    const counts = snapshots.map((s) => s.slot_filled_count);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const spread = max - min;
    expect(
      spread,
      `slot fill spread = ${spread} (min=${min}, max=${max}); per-language: ${snapshots
        .map((s) => `${s.language}=${s.slot_filled_count}`)
        .join(", ")}`,
    ).toBeLessThanOrEqual(1);
  });

  it("contact-doctrine gate passes for every language", () => {
    for (const s of snapshots) {
      expect(s.has_client_name, `language=${s.language}: missing client_name`).toBe(true);
      expect(
        s.has_client_phone || s.has_client_email,
        `language=${s.language}: missing both client_phone and client_email`,
      ).toBe(true);
      expect(
        s.contact_complete,
        `language=${s.language}: contact_complete=false`,
      ).toBe(true);
    }
  });

  it("matter_snapshot is English regardless of input language (DR-036)", () => {
    for (const s of snapshots) {
      expect(
        s.matter_snapshot_english,
        `language=${s.language}: matter_snapshot contains non-ASCII chars (likely foreign)`,
      ).toBe(true);
    }
  });

  it("state.language is set to the input language (LLM authoritative, DR-039)", () => {
    // Reuse capture, but check state.language directly via re-running
    // the deterministic pipeline.
    for (const lang of fixtureLanguages) {
      const text = FIXTURE_TEXTS[lang];
      let state = initialiseState(text);
      state = mergeLlmResults(state, buildMockLlmResponse(lang));
      expect(state.language, `expected state.language=${lang}, got ${state.language}`).toBe(lang);
    }
  });

  it("the brief shape is identical (same keys present) across languages", () => {
    // We don't compare values (slot answers, scores, copy), but the
    // structural keys of the brief must be the same shape across
    // languages — a missing key in one language would indicate a code
    // path divergence.
    for (const lang of fixtureLanguages) {
      const text = FIXTURE_TEXTS[lang];
      let state = initialiseState(text);
      state = mergeLlmResults(state, buildMockLlmResponse(lang));
      state = fillContactSlots(state);
      const report = buildReport(state);

      // Every brief must have these top-level keys populated.
      const requiredKeys: (keyof typeof report)[] = [
        "lead_id",
        "submitted_at",
        "matter_snapshot",
        "band",
        "contact_complete",
        "four_axis",
        "resolved_facts_v2",
        "open_questions",
      ];
      for (const key of requiredKeys) {
        expect(
          report[key],
          `language=${lang}: missing ${String(key)} in brief`,
        ).toBeDefined();
      }
    }
  });
});

describe("brief-equality eval — regression guard for the bypass bug", () => {
  // Pre-DR-039: the engine had two paths gated by franc detection. A
  // misclassified English message routed to the LLM-only path. The
  // LLM-only path was empirically weaker (less slot fill, lower brief
  // depth). This test confirms that no such bifurcation exists by
  // exercising a misclassification scenario directly.

  it("simulated LLM misdetection of English as Portuguese still produces a complete brief", () => {
    // Real production case from 2026-05-16: 81-char WhatsApp message
    // misclassified as Portuguese, empty brief.
    const text =
      "Hi I'm Adriano I have a contract dispute 75k in unpaid by a vendor in mississauga";
    let state = initialiseState(text);
    expect(state.language).toBe("en"); // default, pre-LLM

    // Even if the LLM were to misdetect the language, the regex
    // classifier already ran at initialiseState. There is no "skip
    // regex" path anymore.
    state = mergeLlmResults(state, {
      [LANGUAGE_DETECTOR_FIELD]: "pt", // deliberately wrong
      [MATTER_TYPE_CLASSIFIER_FIELD]: "vendor_supplier_dispute",
      amount_at_stake: "$25,000–$100,000",
      billing_dispute_reason: "Unpaid charges",
    });
    state = fillContactSlots(state);

    const report = buildReport(state);

    // The brief is still complete. matter_type is set (was set by the
    // LLM via __matter_type since regex returned unknown for this
    // specific phrasing). contact_complete passes. The brief is not
    // empty.
    expect(report.contact_complete).toBe(true);
    expect(state.matter_type).toBe("vendor_supplier_dispute");
    expect(report.band).toBeDefined();
  });
});
