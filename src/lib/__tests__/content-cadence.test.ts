import { describe, it, expect } from "vitest";
import { getContentCadence, type ContentCadence } from "@/lib/content-cadence";

const DRG_FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

function requireCadence(): ContentCadence {
  const cadence = getContentCadence(DRG_FIRM_ID);
  if (!cadence) throw new Error("expected DRG cadence to be configured");
  return cadence;
}

describe("getContentCadence", () => {
  it("returns null for a firm with no configured cadence", () => {
    expect(getContentCadence("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("returns the DRG cadence for the DRG firm id", () => {
    expect(getContentCadence(DRG_FIRM_ID)).not.toBeNull();
  });
});

describe("DRG cadence — headline and intro state both tiers, never blended", () => {
  it("headline states both the completed-now count and the going-forward ceiling, no trailing period (the .ccp-sq square is the period)", () => {
    const cadence = requireCadence();
    expect(cadence.headline).toBe("Thirteen completed assets now. Up to fourteen going forward");
    expect(cadence.headline.endsWith(".")).toBe(false);
    expect(cadence.headline.endsWith("!")).toBe(false);
    expect(cadence.headline.endsWith("?")).toBe(false);
  });

  it("intro separates the historical backlog (3 channels) from the future model (4th channel: email)", () => {
    const cadence = requireCadence();
    expect(cadence.intro).toMatch(/13-deliverable batches/i);
    expect(cadence.intro).toMatch(/current publication backlog/i);
    expect(cadence.intro).toMatch(/next new weekly theme/i);
    expect(cadence.intro).toMatch(/fourteenth artifact/i);
    expect(cadence.intro).toMatch(/fourth channel: email/i);
  });
});

describe("DRG cadence — historical note", () => {
  it("preserves the required historical-backlog callout text and does not tie the new model to The Renewal Clause", () => {
    const cadence = requireCadence();
    expect(cadence.historicalNote.body).toBe(
      "The completed 13-deliverable weeks are the current backlog. Starting with the next new weekly theme, DRG's capacity-controlled model may include the DRG Law Minute as a fourteenth artifact across four channels.",
    );
    expect(cadence.historicalNote.body).not.toMatch(/Renewal Clause/);
    expect(cadence.historicalNote.heading.length).toBeGreaterThan(0);
  });
});

describe("DRG cadence — two-column current/next summary (never merged into one set of numbers)", () => {
  it("current backlog column is exactly 13 deliverables / 2 languages / 3 channels", () => {
    const cadence = requireCadence();
    const values = cadence.approve.current.metrics.map((m) => `${m.value} ${m.label}`);
    expect(values).toContain("13 deliverables");
    expect(values).toContain("2 languages");
    expect(values).toContain("3 channels");
    expect(cadence.approve.current.metrics).toHaveLength(3);
  });

  it("next model column is exactly Up to 14 artifacts / 2 languages / 4 channels", () => {
    const cadence = requireCadence();
    const values = cadence.approve.next.metrics.map((m) => `${m.value} ${m.label}`);
    expect(values).toContain("Up to 14 artifacts");
    expect(values).toContain("2 languages");
    expect(values).toContain("4 channels");
    expect(cadence.approve.next.metrics).toHaveLength(3);
  });

  it("carries the exact capacity-condition line: up to is not a quota", () => {
    const cadence = requireCadence();
    expect(cadence.approve.capacityNote).toBe(
      "“Up to” is not a quota. It depends on Damaris's available legal-review capacity and every applicable quality, legal-safety, consent, route, asset, and release requirement.",
    );
  });
});

describe("DRG cadence — flow band: two lines, current then next, never one blended line", () => {
  it("current line reads 1 weekly theme, 13 deliverables, 3 channels", () => {
    const cadence = requireCadence();
    const values = cadence.promise.current.metrics.map((m) => m.value);
    expect(values).toEqual(["1", "13", "3"]);
    expect(cadence.promise.current.label).toMatch(/current backlog/i);
  });

  it("next line reads 1 weekly theme, up to 14 artifacts, 4 channels, with the capacity-met note", () => {
    const cadence = requireCadence();
    const values = cadence.promise.next.metrics.map((m) => m.value);
    expect(values).toEqual(["1", "Up to 14", "4"]);
    expect(cadence.promise.next.label).toMatch(/next model/i);
    expect(cadence.promise.next.note).toMatch(/capacity and release requirements are met/i);
  });
});

describe("DRG cadence — format breakdown is historical-only, the Minute is never folded in", () => {
  it("has exactly 3 pieces: Counsel Note, Clause in the Margin, Preparation Artifact", () => {
    const cadence = requireCadence();
    expect(cadence.pieces).toHaveLength(3);
    expect(cadence.pieces.map((p) => p.kind)).toEqual([
      "Counsel Note · EN + PT",
      "Clause in the Margin · EN + PT",
      "Preparation Artifact · EN + PT",
    ]);
  });

  it("no piece represents the Minute", () => {
    const cadence = requireCadence();
    expect(cadence.pieces.some((p) => p.icon === "minute")).toBe(false);
    expect(cadence.pieces.some((p) => /minute/i.test(p.name) || /minute/i.test(p.kind))).toBe(false);
  });

  it("counts total exactly 8 + 2 + 3 = 13, matching the required total line", () => {
    const cadence = requireCadence();
    const byLabel = Object.fromEntries(cadence.counts.map((c) => [c.l, c.n]));
    expect(byLabel["owned EN/PT assets"]).toBe("8");
    expect(byLabel["LinkedIn posts"]).toBe("2");
    expect(byLabel["GBP decision ads"]).toBe("3");
    expect(byLabel["deliverables"]).toBe("13");
  });
});

describe("DRG cadence — future-only Minute card, structurally separate from `pieces`", () => {
  it("carries the exact required future-format copy", () => {
    const cadence = requireCadence();
    expect(cadence.futureFormat.eyebrow).toBe("Future relationship format");
    expect(cadence.futureFormat.name).toBe("The DRG Law Minute");
    expect(cadence.futureFormat.tag).toBe("1 English client newsletter");
    expect(cadence.futureFormat.desc).toBe(
      "Maintains DRG's judgment between matters through one useful weekly idea and a reply-or-forward relationship close.",
    );
  });

  it("is explicitly labelled as not part of the existing 13-deliverable backlog", () => {
    const cadence = requireCadence();
    expect(cadence.futureFormat.availabilityLabel).toMatch(/next new weekly theme/i);
    expect(cadence.futureFormat.availabilityLabel).toMatch(/not part of the existing 13-deliverable backlog/i);
  });
});

describe("DRG cadence — schedule reflects only the historical 13-piece backlog (3 days, 3 channels, no Minute)", () => {
  it("has exactly 3 days: Tuesday, Wednesday, Thursday", () => {
    const cadence = requireCadence();
    expect(cadence.days.map((d) => d.label)).toEqual(["Tuesday", "Wednesday", "Thursday"]);
  });

  it("has exactly 3 channel rows: website, linkedin, gbp -- no email row", () => {
    const cadence = requireCadence();
    expect(cadence.rows.map((r) => r.channel)).toEqual(["website", "linkedin", "gbp"]);
    expect(cadence.rows.some((r) => r.channel === "email")).toBe(false);
  });

  it("every row's cells array is aligned 1:1 with days (length 3)", () => {
    const cadence = requireCadence();
    for (const row of cadence.rows) {
      expect(row.cells).toHaveLength(3);
    }
  });

  it("the linkedin row carries two English-only native posts (matches the real Renewal Clause data: both en-CA)", () => {
    const cadence = requireCadence();
    const row = cadence.rows.find((r) => r.channel === "linkedin");
    expect(row).toBeDefined();
    const allCards = row!.cells.flatMap((c) => c ?? []);
    expect(allCards).toHaveLength(2);
    for (const card of allCards) {
      expect(card.slot).toMatch(/EN/);
    }
  });

  it("no card anywhere in the schedule mentions the Minute", () => {
    const cadence = requireCadence();
    const allCards = cadence.rows.flatMap((r) => r.cells.flatMap((c) => c ?? []));
    expect(allCards.some((c) => /minute/i.test(c.piece) || /minute/i.test(c.slot))).toBe(false);
  });
});

describe("DRG cadence — Minute operating-rules section restates it is future-only", () => {
  it("has a section label wired for the numbered section title", () => {
    const cadence = requireCadence();
    expect(cadence.sectionLabels.minute.length).toBeGreaterThan(0);
  });

  it("intro states the Minute is not part of the existing backlog and not added retroactively", () => {
    const cadence = requireCadence();
    expect(cadence.minute.intro).toMatch(/not part of the existing 13-deliverable backlog/i);
    expect(cadence.minute.intro).toMatch(/not added to it retroactively/i);
    expect(cadence.minute.intro).toMatch(/no promotional or intake call to action/i);
  });

  it("rules cover Wednesday-only send timing gated on Tuesday link verification", () => {
    const cadence = requireCadence();
    expect(cadence.minute.rules.some((r) => /wednesday only/i.test(r) && /verified live/i.test(r))).toBe(
      true,
    );
  });

  it("rules cover the consent-audit gate: active consent, no unsubscribe, valid sending basis", () => {
    const cadence = requireCadence();
    expect(
      cadence.minute.rules.some(
        (r) => /consent/i.test(r) && /unsubscribe/i.test(r) && /consent audit/i.test(r),
      ),
    ).toBe(true);
  });

  it("rules cover sender identity: Damaris Guimaraes / DRG Law, reply-to info@drglaw.ca, team-triaged", () => {
    const cadence = requireCadence();
    expect(
      cadence.minute.rules.some(
        (r) => /damaris guimaraes/i.test(r) && /info@drglaw\.ca/i.test(r) && /triaged/i.test(r),
      ),
    ).toBe(true);
  });

  it("rules cover live-link verification before every send", () => {
    const cadence = requireCadence();
    expect(cadence.minute.rules.some((r) => /verified live before the note goes out/i.test(r))).toBe(
      true,
    );
  });

  it("readinessNote states it cannot be represented as an actual deliverable until the schema decision is approved", () => {
    const cadence = requireCadence();
    expect(cadence.minute.readinessNote).toMatch(
      /cannot be represented as an actual deliverable until the schema and data-model decision is approved/i,
    );
    expect(cadence.minute.readinessNote).toMatch(/does not send that week, full stop/i);
  });
});

describe("DRG cadence — transition and reference links", () => {
  it("transition describes capacity discipline", () => {
    const cadence = requireCadence();
    expect(cadence.transition.body).toMatch(/does not ship/i);
  });

  it("referenceLinks stays empty (overridden at the page level from firm_about.links)", () => {
    const cadence = requireCadence();
    expect(cadence.referenceLinks).toEqual([]);
  });
});
