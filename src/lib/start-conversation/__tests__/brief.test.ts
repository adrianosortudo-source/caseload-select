import { describe, it, expect } from "vitest";
import { buildBriefSubject, buildBriefHtml } from "../brief";
import type { ValidStartConversationSubmission } from "../validate";

function submission(overrides: Partial<ValidStartConversationSubmission> = {}): ValidStartConversationSubmission {
  return {
    answers: {
      practice_area: "employment",
      practice_area_other: null,
      firm_size: "just_me",
      prompt_reason: "too_few_inquiries",
      prompt_reason_other: null,
      decision_role: "i_do",
      timeline: "this_month",
    },
    contact: {
      name: "Jordan Lee",
      firm_name: "Lee Law",
      email: "jordan@leelaw.ca",
      province: "ON",
    },
    outcome: "booking",
    ...overrides,
  };
}

describe("buildBriefSubject", () => {
  it("carries name, firm, and timeline (section 2.6)", () => {
    const subject = buildBriefSubject(submission());
    expect(subject).toContain("Jordan Lee");
    expect(subject).toContain("Lee Law");
    expect(subject).toContain("This month");
  });
});

describe("buildBriefHtml", () => {
  it("lists the 'what prompted this' answer first among the seven", () => {
    const html = buildBriefHtml(submission());
    const promptIndex = html.indexOf("What prompted you to reach out now");
    const practiceIndex = html.indexOf("What kind of law does your firm practice");
    expect(promptIndex).toBeGreaterThan(-1);
    expect(practiceIndex).toBeGreaterThan(-1);
    expect(promptIndex).toBeLessThan(practiceIndex);
  });

  it("includes every one of the seven answers plus contact fields", () => {
    const html = buildBriefHtml(submission());
    expect(html).toContain("Jordan Lee");
    expect(html).toContain("Lee Law");
    expect(html).toContain("jordan@leelaw.ca");
    expect(html).toContain("Ontario");
    expect(html).toContain("Just me");
    expect(html).toContain("This month");
  });

  it("HTML-escapes a hostile free-text answer", () => {
    const html = buildBriefHtml(
      submission({
        answers: {
          practice_area: "something_else",
          practice_area_other: "<script>alert(1)</script>",
          firm_size: "just_me",
          prompt_reason: "too_few_inquiries",
          prompt_reason_other: null,
          decision_role: "i_do",
          timeline: "this_month",
        },
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("HTML-escapes a hostile contact name", () => {
    const html = buildBriefHtml(
      submission({ contact: { name: '"><img src=x onerror=alert(1)>', firm_name: "Lee Law", email: "jordan@leelaw.ca", province: "ON" } }),
    );
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("notes both outcomes distinctly (banding is internal, never a rejection)", () => {
    const booking = buildBriefHtml(submission({ outcome: "booking" }));
    const reply = buildBriefHtml(submission({ outcome: "reply" }));
    expect(booking).toContain("booking screen");
    expect(reply).toContain("reply-promise screen");
  });
});
