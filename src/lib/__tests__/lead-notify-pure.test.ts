import { describe, it, expect } from "vitest";
import {
  buildNewLeadSubject,
  buildNewLeadHtml,
  deriveFirstName,
  type NewLeadEmailInput,
} from "../lead-notify-pure";

const HOUR = 3_600_000;

const baseInput: NewLeadEmailInput = {
  firmName: "Hartwell Law PC",
  firstName: "Sarah",
  matterType: "shareholder_dispute",
  practiceArea: "corporate",
  band: "A",
  decisionDeadlineIso: new Date(Date.now() + 12 * HOUR).toISOString(),
  whaleNurture: false,
  briefUrl: "https://app.caseloadselect.ca/portal/firm-x/triage/L-2026-05-06-001",
};

describe("buildNewLeadSubject", () => {
  it("prefixes with priority band when band is known", () => {
    expect(buildNewLeadSubject(baseInput)).toBe(
      "Priority A — Sarah · Shareholder Dispute",
    );
  });

  it("falls back to 'New lead' when band is null", () => {
    expect(buildNewLeadSubject({ ...baseInput, band: null })).toBe(
      "New lead — Sarah · Shareholder Dispute",
    );
  });

  it("uses raw matter id when label is unknown", () => {
    expect(buildNewLeadSubject({ ...baseInput, matterType: "novel_thing" })).toBe(
      "Priority A — Sarah · novel_thing",
    );
  });

  it("renders 'this lead' when first name is missing", () => {
    expect(buildNewLeadSubject({ ...baseInput, firstName: "this lead" })).toBe(
      "Priority A — this lead · Shareholder Dispute",
    );
  });
});

describe("buildNewLeadHtml", () => {
  const now = new Date("2026-05-06T12:00:00Z");
  const deadline = new Date("2026-05-06T20:00:00Z").toISOString(); // +8h

  it("includes the firm name in the header band", () => {
    const html = buildNewLeadHtml({
      ...baseInput,
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("Hartwell Law PC");
  });

  it("renders the relative deadline label", () => {
    const html = buildNewLeadHtml({
      ...baseInput,
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("8h");
  });

  it("includes a Take/Pass CTA link to the brief", () => {
    const html = buildNewLeadHtml({
      ...baseInput,
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain('href="https://app.caseloadselect.ca/portal/firm-x/triage/L-2026-05-06-001"');
    expect(html).toContain("Open the brief");
  });

  it("shows the priority band line when known", () => {
    const html = buildNewLeadHtml({
      ...baseInput,
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("Priority A");
  });

  it("shows 'Awaiting band' when band is null", () => {
    const html = buildNewLeadHtml({
      ...baseInput,
      band: null,
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("Awaiting band");
  });

  it("surfaces the whale-nurture flag when set", () => {
    const html = buildNewLeadHtml({
      ...baseInput,
      whaleNurture: true,
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("whale nurture flag");
  });

  it("omits the whale-nurture line when flag is false", () => {
    const html = buildNewLeadHtml({
      ...baseInput,
      whaleNurture: false,
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).not.toContain("whale nurture flag");
  });

  it("escapes HTML in the firm name", () => {
    const html = buildNewLeadHtml({
      ...baseInput,
      firmName: "Smith & Co <Esq>",
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("Smith &amp; Co &lt;Esq&gt;");
    expect(html).not.toContain("Smith & Co <Esq>");
  });
});

describe("deriveFirstName", () => {
  it("returns 'this lead' when name is missing or blank", () => {
    expect(deriveFirstName(null)).toBe("this lead");
    expect(deriveFirstName(undefined)).toBe("this lead");
    expect(deriveFirstName("")).toBe("this lead");
    expect(deriveFirstName("   ")).toBe("this lead");
  });

  it("takes the first whitespace-separated token", () => {
    expect(deriveFirstName("Sarah Khan")).toBe("Sarah");
    expect(deriveFirstName("Mary Jane Smith")).toBe("Mary");
    expect(deriveFirstName("  Jordan  ")).toBe("Jordan");
  });

  it("normalises ALL-CAPS shouting names", () => {
    expect(deriveFirstName("SARAH KHAN")).toBe("Sarah");
    expect(deriveFirstName("JOHN")).toBe("John");
  });

  it("preserves single-letter or normal-case names", () => {
    expect(deriveFirstName("J Smith")).toBe("J");
    expect(deriveFirstName("Anne-Marie")).toBe("Anne-Marie");
  });
});
