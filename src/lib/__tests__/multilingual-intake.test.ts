/**
 * Tests for the multilingual screen engine build (CRM Bible DR-036).
 *
 * Coverage:
 *   1. intake-language-label utility — code → label mapping
 *   2. GHL webhook envelope — intake_language field presence
 *   3. Notification email — language note for non-English leads
 *   4. Brief HTML renderer — language callout for non-English
 *   5. Prompt builder — multilingual rule present in system prompt
 *
 * Fixtures mirror the four build-prompt scenarios:
 *   PT: "quero abrir uma empresa no canada"
 *   ES: "Necesito ayuda con un caso de divorcio"
 *   ZH: "我需要在加拿大注册公司"
 *   EN: "hi"
 */

import { describe, it, expect } from "vitest";
import { intakeLanguageLabel } from "../intake-language-label";
import {
  buildTakenPayload,
  buildDeclinedOosPayload,
  type LeadFacts,
} from "../ghl-webhook-pure";
import {
  buildNewLeadSubject,
  buildNewLeadHtml,
  type NewLeadEmailInput,
} from "../lead-notify-pure";
import { buildSystemPrompt } from "../screen-engine/llm/prompt";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURES = {
  pt: { code: "pt", label: "Portuguese", input: "quero abrir uma empresa no canada" },
  es: { code: "es", label: "Spanish",    input: "Necesito ayuda con un caso de divorcio" },
  zh: { code: "zh", label: "Mandarin Chinese", input: "我需要在加拿大注册公司" },
  ar: { code: "ar", label: "Arabic",      input: "أحتاج إلى محامٍ للهجرة إلى كندا" },
  fr: { code: "fr", label: "French",      input: "Je cherche un avocat en droit du travail" },
  en: { code: "en", label: null,          input: "hi" },
} as const;

const HOUR = 3_600_000;

function baseFacts(overrides: Partial<LeadFacts> = {}): LeadFacts {
  return {
    lead_id: "L-2026-05-12-A1B",
    firm_id: "1f5a2391-85d8-45a2-b427-90441e78a93c",
    band: "B",
    matter_type: "business_setup_advisory",
    practice_area: "corporate",
    submitted_at: "2026-05-12T10:00:00.000Z",
    contact_name: "Test Lead",
    contact_email: "test@example.com",
    contact_phone: "+14165550000",
    ...overrides,
  };
}

function baseEmailInput(overrides: Partial<NewLeadEmailInput> = {}): NewLeadEmailInput {
  return {
    firmName: "Hartwell Law PC",
    firstName: "Test",
    matterType: "business_setup_advisory",
    practiceArea: "corporate",
    band: "B",
    decisionDeadlineIso: new Date(Date.now() + 24 * HOUR).toISOString(),
    whaleNurture: false,
    briefUrl: "https://app.caseloadselect.ca/portal/firm-x/triage/L-2026-05-12-A1B",
    ...overrides,
  };
}

// ─── 1. intake-language-label ────────────────────────────────────────────────

describe("intakeLanguageLabel", () => {
  it("returns null for English (no callout needed)", () => {
    expect(intakeLanguageLabel("en")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(intakeLanguageLabel(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(intakeLanguageLabel(undefined)).toBeNull();
  });

  it("returns Portuguese label for pt", () => {
    expect(intakeLanguageLabel("pt")).toBe("Portuguese");
  });

  it("returns Spanish label for es", () => {
    expect(intakeLanguageLabel("es")).toBe("Spanish");
  });

  it("returns Mandarin Chinese label for zh", () => {
    expect(intakeLanguageLabel("zh")).toBe("Mandarin Chinese");
  });

  it("returns French label for fr", () => {
    expect(intakeLanguageLabel("fr")).toBe("French");
  });

  it("returns Arabic label for ar", () => {
    expect(intakeLanguageLabel("ar")).toBe("Arabic");
  });

  it("falls back to uppercase code for unknown language", () => {
    expect(intakeLanguageLabel("sw")).toBe("SW");
  });

  it.each(Object.values(FIXTURES).filter(f => f.code !== "en"))(
    "returns a non-null label for fixture language $code",
    ({ code, label }) => {
      expect(intakeLanguageLabel(code)).toBe(label);
    },
  );
});

// ─── 2. GHL webhook envelope — intake_language ────────────────────────────────

describe("GHL webhook — intake_language in envelope", () => {
  it("includes intake_language in taken payload for English lead", () => {
    const payload = buildTakenPayload({
      facts: baseFacts({ intake_language: "en" }),
      statusChangedAt: new Date("2026-05-12T10:12:00.000Z"),
      statusChangedBy: "lawyer",
      feeEstimate: "$5,000–$25,000",
      matterSnapshot: "Starting a business with a partner",
    });
    expect(payload.intake_language).toBe("en");
  });

  it.each(["pt", "es", "zh", "fr", "ar"] as const)(
    "includes intake_language = %s in taken payload for non-English lead",
    (code) => {
      const payload = buildTakenPayload({
        facts: baseFacts({ intake_language: code }),
        statusChangedAt: new Date("2026-05-12T10:12:00.000Z"),
        statusChangedBy: "lawyer",
        feeEstimate: null,
        matterSnapshot: null,
      });
      expect(payload.intake_language).toBe(code);
    },
  );

  it("defaults intake_language to 'en' when not provided in LeadFacts", () => {
    const payload = buildTakenPayload({
      facts: baseFacts(),  // no intake_language
      statusChangedAt: new Date("2026-05-12T10:12:00.000Z"),
      statusChangedBy: "lawyer",
      feeEstimate: null,
      matterSnapshot: null,
    });
    expect(payload.intake_language).toBe("en");
  });

  it("includes intake_language in declined_oos payload", () => {
    const payload = buildDeclinedOosPayload({
      facts: baseFacts({ intake_language: "pt", band: null }),
      statusChangedAt: new Date("2026-05-12T10:00:00.000Z"),
      declineSubject: "Re: sua consulta",
      declineBody: "Obrigado por entrar em contato.",
      declineSource: "system_fallback",
      detectedAreaLabel: "family law",
    });
    expect(payload.intake_language).toBe("pt");
  });

  it("intake_language is present at the top level of the envelope", () => {
    const payload = buildTakenPayload({
      facts: baseFacts({ intake_language: "zh" }),
      statusChangedAt: new Date(),
      statusChangedBy: "lawyer",
      feeEstimate: null,
      matterSnapshot: null,
    });
    // Must be a direct property of the payload, not nested
    expect(Object.prototype.hasOwnProperty.call(payload, "intake_language")).toBe(true);
  });
});

// ─── 3. Notification email — language note ────────────────────────────────────

describe("Notification email — language note for non-English leads", () => {
  it("does not include language note for English leads", () => {
    const html = buildNewLeadHtml(baseEmailInput({ intakeLanguage: "en" }));
    expect(html).not.toContain("Intake language");
  });

  it("does not include language note when intakeLanguage is null", () => {
    const html = buildNewLeadHtml(baseEmailInput({ intakeLanguage: null }));
    expect(html).not.toContain("Intake language");
  });

  it("does not include language note when intakeLanguage is omitted", () => {
    const html = buildNewLeadHtml(baseEmailInput());
    expect(html).not.toContain("Intake language");
  });

  it.each(["pt", "es", "zh", "fr"] as const)(
    "includes language note for %s intake",
    (code) => {
      const html = buildNewLeadHtml(baseEmailInput({ intakeLanguage: code }));
      expect(html).toContain("Intake language");
      expect(html).toContain(intakeLanguageLabel(code)!);
    },
  );

  it("Portuguese intake renders 'Portuguese' in the email body", () => {
    const html = buildNewLeadHtml(baseEmailInput({ intakeLanguage: "pt" }));
    expect(html).toContain("Portuguese");
    expect(html).toContain("Brief translated to English");
  });

  it("Spanish intake renders 'Spanish' in the email body", () => {
    const html = buildNewLeadHtml(baseEmailInput({ intakeLanguage: "es" }));
    expect(html).toContain("Spanish");
  });

  it("Mandarin Chinese intake renders correctly", () => {
    const html = buildNewLeadHtml(baseEmailInput({ intakeLanguage: "zh" }));
    expect(html).toContain("Mandarin Chinese");
  });

  it("language note does not break the subject line", () => {
    const subject = buildNewLeadSubject(baseEmailInput({ intakeLanguage: "pt" }));
    // Subject derives from matterType and band; language doesn't appear there
    expect(subject).toBe("Priority B — Test · Business Setup Advisory");
  });
});

// ─── 4. Prompt builder — multilingual rule ────────────────────────────────────

describe("buildSystemPrompt — multilingual rule", () => {
  const prompt = buildSystemPrompt();

  it("contains rule 8 MULTILINGUAL INPUT heading", () => {
    expect(prompt).toContain("8. MULTILINGUAL INPUT");
  });

  it("instructs to keep single-select values in English verbatim", () => {
    expect(prompt).toContain("Single-select option values MUST still be the English strings");
  });

  it("instructs to translate free-text fields to English", () => {
    expect(prompt).toContain("Free-text fields should be returned in");
    expect(prompt).toContain("English (translate if needed)");
  });

  it("references the __detected_language field", () => {
    expect(prompt).toContain("__detected_language");
  });

  it("names all five non-English supported languages", () => {
    expect(prompt).toContain("'fr' for French");
    expect(prompt).toContain("'pt' for Portuguese");
    expect(prompt).toContain("'zh' for Mandarin");
    expect(prompt).toContain("'es' for Spanish");
    expect(prompt).toContain("'ar' for Arabic");
  });

  it("still contains the original NULL RULE (rule 0)", () => {
    expect(prompt).toContain("0. THE NULL RULE");
  });

  it("still contains the dollar amount mapping rule (rule 5)", () => {
    expect(prompt).toContain("5. CRITICAL");
    expect(prompt).toContain("Dollar amount mapping");
  });
});
