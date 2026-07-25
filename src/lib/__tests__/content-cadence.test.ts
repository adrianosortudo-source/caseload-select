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

describe("DRG cadence: headline and intro state both states, never blended", () => {
  it("headline states what is published and what is still pending, no trailing punctuation (the .ccp-sq square is the period)", () => {
    const cadence = requireCadence();
    expect(cadence.headline).toBe("Sixteen assets a week. Fifteen published, one still to send");
    expect(cadence.headline.endsWith(".")).toBe(false);
    expect(cadence.headline.endsWith("!")).toBe(false);
    expect(cadence.headline.endsWith("?")).toBe(false);
  });

  it("intro separates the 15 published across 3 channels from the pending Minute and its 4th channel", () => {
    const cadence = requireCadence();
    expect(cadence.intro).toMatch(/16 deliverables/i);
    expect(cadence.intro).toMatch(/fifteen are published/i);
    expect(cadence.intro).toMatch(/not yet sent/i);
    expect(cadence.intro).toMatch(/fourth channel/i);
  });

  it("never claims the Minute reached anyone", () => {
    const cadence = requireCadence();
    const prose = [
      cadence.headline,
      cadence.intro,
      cadence.minute.intro,
      cadence.futureFormat.availabilityLabel,
    ].join(" ");
    expect(prose).not.toMatch(/minute (was|has been) (sent|delivered)/i);
    expect(prose).not.toMatch(/subscribers received/i);
  });
});

describe("DRG cadence: the earlier 13-deliverable week must never read as incomplete", () => {
  it("historical note states the 13-piece week is finished at that size, not missing pieces", () => {
    const cadence = requireCadence();
    expect(cadence.historicalNote.body).toMatch(/13-deliverable batch/i);
    expect(cadence.historicalNote.body).toMatch(/finished at that size/i);
    expect(cadence.historicalNote.body).toMatch(/not missing/i);
    expect(cadence.historicalNote.heading.length).toBeGreaterThan(0);
  });
});

describe("DRG cadence: two-column published/pending summary (never merged into one set of numbers)", () => {
  it("published column is exactly 15 published / 2 languages / 3 channels", () => {
    const cadence = requireCadence();
    const values = cadence.approve.current.metrics.map((m) => `${m.value} ${m.label}`);
    expect(values).toContain("15 published");
    expect(values).toContain("2 languages");
    expect(values).toContain("3 channels");
    expect(cadence.approve.current.metrics).toHaveLength(3);
  });

  it("pending column is exactly 16 deliverables / 2 languages / 4 channels", () => {
    const cadence = requireCadence();
    const values = cadence.approve.next.metrics.map((m) => `${m.value} ${m.label}`);
    expect(values).toContain("16 deliverables");
    expect(values).toContain("2 languages");
    expect(values).toContain("4 channels");
    expect(cadence.approve.next.metrics).toHaveLength(3);
  });

  it("the fourth channel is conditional on the Minute sending, never stated as already live", () => {
    const cadence = requireCadence();
    expect(cadence.approve.next.label).toMatch(/once the minute sends/i);
    expect(cadence.approve.current.metrics.find((m) => m.label === "channels")?.value).toBe("3");
  });

  it("carries the capacity-condition line: the sixteenth artifact is not a quota", () => {
    const cadence = requireCadence();
    expect(cadence.approve.capacityNote).toMatch(/not a quota/i);
    expect(cadence.approve.capacityNote).toMatch(/legal-review capacity/i);
  });
});

describe("DRG cadence: flow band is two lines, published then pending, never one blended line", () => {
  it("published line reads 1 weekly theme, 15 published, 3 channels", () => {
    const cadence = requireCadence();
    expect(cadence.promise.current.metrics.map((m) => m.value)).toEqual(["1", "15", "3"]);
    expect(cadence.promise.current.label).toMatch(/published now/i);
  });

  it("pending line reads 1 weekly theme, 16 deliverables, 4 channels, with the capacity-met note", () => {
    const cadence = requireCadence();
    expect(cadence.promise.next.metrics.map((m) => m.value)).toEqual(["1", "16", "4"]);
    expect(cadence.promise.next.label).toMatch(/once the minute sends/i);
    expect(cadence.promise.next.note).toMatch(/capacity and release requirements are met/i);
  });
});

describe("DRG cadence: format breakdown covers the published 15, the Minute is never folded in", () => {
  it("has exactly 4 published formats, including the native LinkedIn Articles", () => {
    const cadence = requireCadence();
    expect(cadence.pieces).toHaveLength(4);
    expect(cadence.pieces.map((p) => p.kind)).toEqual([
      "Counsel Note · EN + PT",
      "Clause in the Margin · EN + PT",
      "Preparation Artifact · EN + PT",
      "Native LinkedIn Article · EN",
    ]);
  });

  it("no piece represents the Minute: it has not sent, so it is not a published format", () => {
    const cadence = requireCadence();
    expect(cadence.pieces.some((p) => p.icon === "minute")).toBe(false);
    expect(cadence.pieces.some((p) => /minute/i.test(p.name) || /minute/i.test(p.kind))).toBe(false);
  });

  it("the four piece tags sum to the 10 owned and social assets (the other 5 are GBP ads and the Minute)", () => {
    const cadence = requireCadence();
    const sum = cadence.pieces.reduce((n, p) => n + Number(p.tag.match(/^(\d+)/)?.[1] ?? 0), 0);
    expect(sum).toBe(10);
  });

  it("counts total exactly 8 + 2 + 2 + 3 + 1 = 16, matching the total line", () => {
    const cadence = requireCadence();
    const byLabel = Object.fromEntries(cadence.counts.map((c) => [c.l, c.n]));
    expect(byLabel["owned EN/PT assets"]).toBe("8");
    expect(byLabel["LinkedIn posts"]).toBe("2");
    expect(byLabel["native LinkedIn Articles"]).toBe("2");
    expect(byLabel["GBP decision ads"]).toBe("3");
    expect(byLabel["DRG Law Minute"]).toBe("1");
    expect(byLabel["deliverables"]).toBe("16");

    const parts = cadence.counts.filter((c) => c.l !== "deliverables");
    expect(parts.reduce((n, c) => n + Number(c.n), 0)).toBe(16);
  });
});

describe("DRG cadence: the Minute card stays structurally separate from the pieces list", () => {
  it("carries the required format copy", () => {
    const cadence = requireCadence();
    expect(cadence.futureFormat.name).toBe("The DRG Law Minute");
    expect(cadence.futureFormat.tag).toBe("1 English client newsletter");
    expect(cadence.futureFormat.desc).toBe(
      "Maintains DRG's judgment between matters through one useful weekly idea and a reply-or-forward relationship close.",
    );
  });

  it("is explicitly labelled as counted but not sent, with email not yet live", () => {
    const cadence = requireCadence();
    expect(cadence.futureFormat.eyebrow).toMatch(/not yet sent/i);
    expect(cadence.futureFormat.availabilityLabel).toMatch(/has not sent/i);
    expect(cadence.futureFormat.availabilityLabel).toMatch(/email is not a live channel/i);
  });
});

describe("DRG cadence: schedule shows only what actually publishes (3 days, 3 channels, no Minute)", () => {
  it("has exactly 3 days: Tuesday, Wednesday, Thursday", () => {
    const cadence = requireCadence();
    expect(cadence.days.map((d) => d.label)).toEqual(["Tuesday", "Wednesday", "Thursday"]);
  });

  it("has exactly 3 channel rows: website, linkedin, gbp, and no email row because email is not live", () => {
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

  it("the linkedin row carries four English-only cards: two companion posts and two native Articles", () => {
    const cadence = requireCadence();
    const row = cadence.rows.find((r) => r.channel === "linkedin");
    expect(row).toBeDefined();
    const allCards = row!.cells.flatMap((c) => c ?? []);
    expect(allCards).toHaveLength(4);
    for (const card of allCards) {
      expect(card.slot).toMatch(/EN/);
    }
    expect(allCards.filter((c) => /native article/i.test(c.slot))).toHaveLength(2);
  });

  it("no card anywhere in the schedule mentions the Minute, because it has not sent", () => {
    const cadence = requireCadence();
    const allCards = cadence.rows.flatMap((r) => r.cells.flatMap((c) => c ?? []));
    expect(allCards.some((c) => /minute/i.test(c.piece) || /minute/i.test(c.slot))).toBe(false);
  });

  it("the schedule card counts sum to the 15 published assets", () => {
    const cadence = requireCadence();
    const allCards = cadence.rows.flatMap((r) => r.cells.flatMap((c) => c ?? []));
    expect(allCards.reduce((n, c) => n + c.count, 0)).toBe(15);
  });
});

describe("DRG cadence: Minute operating-rules section restates that it has not sent", () => {
  it("has a section label wired for the numbered section title", () => {
    const cadence = requireCadence();
    expect(cadence.sectionLabels.minute.length).toBeGreaterThan(0);
  });

  it("intro states the Minute has reached no one and that email is not live until it does", () => {
    const cadence = requireCadence();
    expect(cadence.minute.intro).toMatch(/reached no one/i);
    expect(cadence.minute.intro).toMatch(/email is not a live channel/i);
    expect(cadence.minute.intro).toMatch(/no promotional or intake call to action/i);
  });

  it("rules cover Wednesday-only send timing gated on Tuesday link verification", () => {
    const cadence = requireCadence();
    expect(
      cadence.minute.rules.some((r) => /wednesday only/i.test(r) && /verified live/i.test(r)),
    ).toBe(true);
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

  it("readinessNote ties the count to being written and held, never to delivery, and keeps the full-stop gate", () => {
    const cadence = requireCadence();
    expect(cadence.minute.readinessNote).toMatch(
      /written and held, never because it was delivered/i,
    );
    expect(cadence.minute.readinessNote).toMatch(/does not send that week, full stop/i);
  });
});

describe("DRG cadence: transition and reference links", () => {
  it("transition describes capacity discipline", () => {
    const cadence = requireCadence();
    expect(cadence.transition.body).toMatch(/does not ship/i);
  });

  it("referenceLinks stays empty (overridden at the page level from firm_about.links)", () => {
    const cadence = requireCadence();
    expect(cadence.referenceLinks).toEqual([]);
  });
});
