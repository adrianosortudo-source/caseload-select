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

const declinedInput: NewLeadEmailInput = {
  ...baseInput,
  firstName: "Mike",
  matterType: "out_of_scope",
  practiceArea: "family",
  band: null,
  lifecycleStatus: "declined",
};

const bandDInput: NewLeadEmailInput = {
  ...baseInput,
  firstName: "Mike",
  matterType: "out_of_scope",
  practiceArea: "family",
  band: "D",
  lifecycleStatus: "triaging",
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

  it("renders the declined-state subject with [Auto-filtered] prefix + practice area", () => {
    expect(buildNewLeadSubject(declinedInput)).toBe(
      "[Auto-filtered] Mike · matter flagged as Family Law",
    );
  });

  it("renders the Band D 'Refer opportunity' subject for refer-eligible triaging leads", () => {
    expect(buildNewLeadSubject(bandDInput)).toBe(
      "Priority D — Mike · Refer opportunity · Family Law",
    );
  });

  it("Band D subject still appends channel suffix when non-web", () => {
    expect(
      buildNewLeadSubject({ ...bandDInput, channel: "whatsapp" }),
    ).toBe("Priority D — Mike · Refer opportunity · Family Law (via WhatsApp)");
  });

  it("defaults to triaging subject when lifecycleStatus is omitted", () => {
    const { lifecycleStatus, ...withoutStatus } = declinedInput;
    void lifecycleStatus; // suppress unused-var warning
    // The screened-leads label map renders 'out_of_scope' as
    // "Out of Scope · Forwarded" — see lib/screened-leads-labels.
    expect(buildNewLeadSubject(withoutStatus)).toBe(
      "New lead — Mike · Out of Scope · Forwarded",
    );
  });

  it("appends '(via WhatsApp)' to triaging subject when channel is whatsapp", () => {
    expect(buildNewLeadSubject({ ...baseInput, channel: "whatsapp" })).toBe(
      "Priority A — Sarah · Shareholder Dispute (via WhatsApp)",
    );
  });

  it("appends channel suffix to declined subject when channel is non-web", () => {
    expect(buildNewLeadSubject({ ...declinedInput, channel: "instagram" })).toBe(
      "[Auto-filtered] Mike · matter flagged as Family Law (via Instagram DM)",
    );
  });

  it("does not append channel suffix when channel is 'web'", () => {
    expect(buildNewLeadSubject({ ...baseInput, channel: "web" })).toBe(
      "Priority A — Sarah · Shareholder Dispute",
    );
  });

  it("does not append channel suffix when channel is null", () => {
    expect(buildNewLeadSubject({ ...baseInput, channel: null })).toBe(
      "Priority A — Sarah · Shareholder Dispute",
    );
  });

  it("does not append channel suffix when channel is omitted", () => {
    expect(buildNewLeadSubject(baseInput)).toBe(
      "Priority A — Sarah · Shareholder Dispute",
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

  it("renders the triaging eyebrow + 'Open the brief' CTA by default", () => {
    const html = buildNewLeadHtml({ ...baseInput, decisionDeadlineIso: deadline, now });
    expect(html).toContain("New lead in triage");
    expect(html).toContain("Open the brief");
    expect(html).toContain("Decision window");
  });

  it("renders the declined eyebrow + 'Review the brief' CTA when lifecycleStatus='declined'", () => {
    const html = buildNewLeadHtml({
      ...declinedInput,
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("Auto-filtered lead");
    expect(html).toContain("Review the brief");
    // Declined emails omit the decision-window line; this branch is dormant
    // intake-path-wise as of 2026-05-15 (reserved for future engine-spam).
    expect(html).not.toContain("Decision window");
  });

  it("renders the Band D 'refer-eligible' eyebrow + refer-aware copy", () => {
    const html = buildNewLeadHtml({
      ...bandDInput,
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("New refer-eligible lead");
    expect(html).toContain("Priority D");
    expect(html).toContain("Refer-eligible");
    expect(html).toContain("Open the brief");
    // The body mentions all three affordances.
    expect(html).toContain("Refer");
    expect(html).toContain("Take");
    expect(html).toContain("Pass");
    // Band D has a real decision window (96h default).
    expect(html).toContain("Decision window");
    // Band D is NOT auto-filtered.
    expect(html).not.toContain("Auto-filtered lead");
  });

  it("declined body explains override path so engine misclassifications can be corrected", () => {
    const html = buildNewLeadHtml({
      ...declinedInput,
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("out of scope");
    expect(html).toContain("If the engine got it wrong");
  });

  it("declined emails still surface the intake-language note for non-English contacts", () => {
    const html = buildNewLeadHtml({
      ...declinedInput,
      intakeLanguage: "pt",
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("Intake language");
    expect(html).toContain("Portuguese");
  });

  it("includes 'Inbound via' and the channel name in the body for non-web channels", () => {
    const html = buildNewLeadHtml({
      ...baseInput,
      channel: "whatsapp",
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("Inbound via");
    expect(html).toContain("WhatsApp");
  });

  it("omits the 'Inbound via' note when channel is 'web'", () => {
    const html = buildNewLeadHtml({
      ...baseInput,
      channel: "web",
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).not.toContain("Inbound via");
  });

  it("omits the 'Inbound via' note when channel is omitted", () => {
    const html = buildNewLeadHtml({
      ...baseInput,
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).not.toContain("Inbound via");
  });

  it("includes channel note in declined emails for non-web channels", () => {
    const html = buildNewLeadHtml({
      ...declinedInput,
      channel: "facebook",
      decisionDeadlineIso: deadline,
      now,
    });
    expect(html).toContain("Inbound via");
    expect(html).toContain("Facebook Messenger");
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
