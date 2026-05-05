import { describe, it, expect } from "vitest";
import { resolveDecline, type DeclineCandidates, type DeclineTemplateRow } from "../decline-resolver-pure";

const FIRM_DEFAULT: DeclineTemplateRow = {
  practice_area: null,
  subject: "Sorry we cannot help",
  body: "We do not handle this kind of work. Best wishes.",
};

const PER_PA: DeclineTemplateRow = {
  practice_area: "real_estate",
  subject: "Real estate referral",
  body: "Real estate is not our focus. Please try a real estate lawyer.",
};

function candidates(overrides: Partial<DeclineCandidates> = {}): DeclineCandidates {
  return {
    perLeadOverride: null,
    perPaTemplate: null,
    firmDefaultTemplate: null,
    ...overrides,
  };
}

describe("resolveDecline — three-layer precedence", () => {
  it("layer 1: per-lead override wins over everything", () => {
    const out = resolveDecline(
      candidates({
        perLeadOverride: "Hi Jordan, I am unable to take this on personally but here is a referral.",
        perPaTemplate: PER_PA,
        firmDefaultTemplate: FIRM_DEFAULT,
      }),
      "lawyer_pass",
    );
    expect(out.source).toBe("per_lead_override");
    expect(out.body).toContain("Hi Jordan");
    expect(out.body).not.toContain("Real estate");
    expect(out.body).not.toContain("We do not handle");
  });

  it("layer 1: empty / whitespace status_note does not count as override", () => {
    const out = resolveDecline(
      candidates({
        perLeadOverride: "   ",
        firmDefaultTemplate: FIRM_DEFAULT,
      }),
      "lawyer_pass",
    );
    expect(out.source).toBe("firm_default");
    expect(out.body).toBe(FIRM_DEFAULT.body);
  });

  it("layer 2: per-PA template wins when no override and PA matches", () => {
    const out = resolveDecline(
      candidates({
        perPaTemplate: PER_PA,
        firmDefaultTemplate: FIRM_DEFAULT,
      }),
      "lawyer_pass",
    );
    expect(out.source).toBe("per_pa");
    expect(out.body).toBe(PER_PA.body);
    expect(out.subject).toBe(PER_PA.subject);
  });

  it("layer 3: firm default wins when no override and no PA match", () => {
    const out = resolveDecline(
      candidates({
        firmDefaultTemplate: FIRM_DEFAULT,
      }),
      "lawyer_pass",
    );
    expect(out.source).toBe("firm_default");
    expect(out.body).toBe(FIRM_DEFAULT.body);
    expect(out.subject).toBe(FIRM_DEFAULT.subject);
  });

  it("layer 4: system fallback when no candidates at all (lawyer_pass flavour)", () => {
    const out = resolveDecline(candidates(), "lawyer_pass");
    expect(out.source).toBe("system_fallback");
    expect(out.body).toMatch(/falls outside the matters/i);
    expect(out.body).not.toMatch(/Family law|family law/i);
  });

  it("layer 4: system fallback for OOS interpolates the practice area label", () => {
    const out = resolveDecline(candidates(), "oos", "family law");
    expect(out.source).toBe("system_fallback");
    expect(out.body).toContain("family law");
    expect(out.body).toMatch(/sits outside/i);
  });

  it("layer 4: system fallback for OOS without label uses generic phrasing", () => {
    const out = resolveDecline(candidates(), "oos");
    expect(out.source).toBe("system_fallback");
    expect(out.body).toContain("this practice area");
  });

  it("layer 4: system fallback for backstop is its own copy", () => {
    const out = resolveDecline(candidates(), "backstop");
    expect(out.source).toBe("system_fallback");
    expect(out.body).toMatch(/typical response window/i);
    expect(out.body).not.toMatch(/falls outside the matters/i);
  });
});

describe("resolveDecline — subject fallback", () => {
  it("falls back to 'Re: your inquiry' when a template has a null subject", () => {
    const out = resolveDecline(
      candidates({
        firmDefaultTemplate: { practice_area: null, subject: null, body: "Body only." },
      }),
      "lawyer_pass",
    );
    expect(out.subject).toBe("Re: your inquiry");
  });

  it("falls back when subject is just whitespace", () => {
    const out = resolveDecline(
      candidates({
        firmDefaultTemplate: { practice_area: null, subject: "   ", body: "Body only." },
      }),
      "lawyer_pass",
    );
    expect(out.subject).toBe("Re: your inquiry");
  });

  it("uses the per-lead override with the system subject (overrides do not carry a subject)", () => {
    const out = resolveDecline(
      candidates({ perLeadOverride: "Custom decline." }),
      "lawyer_pass",
    );
    expect(out.subject).toBe("Re: your inquiry");
    expect(out.body).toBe("Custom decline.");
  });
});

describe("resolveDecline — never returns banned vocabulary in fallbacks", () => {
  // Brand book: no em dashes, no italics, no AI vocabulary in copy.
  const banned = [
    "—",                            // em dash
    /<i[ >]/i, /<em[ >]/i,          // italics
    /\bdelve\b/i, /\btapestry\b/i,
    /\bvibrant\b/i, /\bmeticulous\b/i,
    /\bgarner\b/i, /\bvaluable\b/i,
  ];

  function check(body: string) {
    for (const b of banned) {
      if (typeof b === "string") expect(body.includes(b)).toBe(false);
      else expect(b.test(body)).toBe(false);
    }
  }

  it("system lawyer_pass fallback is brand-clean", () => {
    check(resolveDecline(candidates(), "lawyer_pass").body);
  });
  it("system oos fallback is brand-clean", () => {
    check(resolveDecline(candidates(), "oos", "family law").body);
  });
  it("system backstop fallback is brand-clean", () => {
    check(resolveDecline(candidates(), "backstop").body);
  });
});
