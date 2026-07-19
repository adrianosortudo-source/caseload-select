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

describe("DRG cadence v5.2 model — headline and lede", () => {
  it("headline communicates the up-to-14 ceiling and carries no trailing period (the .ccp-sq square is the period)", () => {
    const cadence = requireCadence();
    expect(cadence.headline).toMatch(/up to 14/i);
    expect(cadence.headline.endsWith(".")).toBe(false);
    expect(cadence.headline.endsWith("!")).toBe(false);
    expect(cadence.headline.endsWith("?")).toBe(false);
  });

  it("lede frames capacity as a per-theme ceiling, not a fixed weekly quota", () => {
    const cadence = requireCadence();
    expect(cadence.lede).toMatch(/ceiling/i);
    expect(cadence.lede).toMatch(/not a fixed weekly quota/i);
    expect(cadence.lede).toMatch(/does not ship/i);
  });
});

describe("DRG cadence v5.2 model — historical note", () => {
  it("preserves the required historical-backlog callout text", () => {
    const cadence = requireCadence();
    expect(cadence.historicalNote.body).toBe(
      "Previously completed 13-deliverable batches remain the current backlog. Starting with The Renewal Clause, new releases use the updated model.",
    );
    expect(cadence.historicalNote.heading.length).toBeGreaterThan(0);
  });
});

describe("DRG cadence v5.2 model — metrics", () => {
  it("approve.metrics carries the four-part 14/2/4/Tue-Wed shape", () => {
    const cadence = requireCadence();
    expect(cadence.approve.metrics).toHaveLength(4);
    const values = cadence.approve.metrics.map((m) => m.value);
    const labels = cadence.approve.metrics.map((m) => m.label);
    expect(values).toContain("14");
    expect(values).toContain("2");
    expect(values).toContain("4");
    expect(labels.some((l) => /channel/i.test(l))).toBe(true);
    expect(labels.some((l) => /language/i.test(l))).toBe(true);
    expect(labels.some((l) => /release window/i.test(l))).toBe(true);
    // The fourth metric is the non-numeric Tuesday-Wednesday release window.
    const windowMetric = cadence.approve.metrics.find((m) => m.label === "release window");
    expect(windowMetric?.value).toMatch(/tue.*wed/i);
  });

  it("promise.metrics states the up-to-14 ceiling across 4 channels", () => {
    const cadence = requireCadence();
    const values = cadence.promise.metrics.map((m) => m.value);
    expect(values).toContain("14");
    expect(values).toContain("4");
    expect(cadence.promise.label).toMatch(/up to 14/i);
    expect(cadence.promise.label).toMatch(/4 channels/i);
  });
});

describe("DRG cadence v5.2 model — pieces (4 artifact families including the Minute)", () => {
  it("has exactly 4 pieces", () => {
    const cadence = requireCadence();
    expect(cadence.pieces).toHaveLength(4);
  });

  it("carries the four content jobs as `kind`: Explain / Examine / Prepare / Maintain relationship", () => {
    const cadence = requireCadence();
    expect(cadence.pieces.map((p) => p.kind)).toEqual([
      "Explain",
      "Examine",
      "Prepare",
      "Maintain relationship",
    ]);
  });

  it("includes The DRG Law Minute as the 4th piece with the minute icon", () => {
    const cadence = requireCadence();
    const minutePiece = cadence.pieces[3];
    expect(minutePiece.name).toBe("The DRG Law Minute");
    expect(minutePiece.icon).toBe("minute");
    expect(minutePiece.kind).toBe("Maintain relationship");
  });

  it("keeps the historical Counsel Note / Clause in the Margin / Preparation Artifact families intact", () => {
    const cadence = requireCadence();
    expect(cadence.pieces[0].name).toBe("Counsel Note · EN + PT");
    expect(cadence.pieces[1].name).toBe("Clause in the Margin · EN + PT");
    expect(cadence.pieces[2].name).toBe("Preparation Artifact · EN + PT");
  });
});

describe("DRG cadence v5.2 model — schedule (2 days, 4 channel rows)", () => {
  it("has exactly 2 days: Tuesday then Wednesday", () => {
    const cadence = requireCadence();
    expect(cadence.days.map((d) => d.label)).toEqual(["Tuesday", "Wednesday"]);
  });

  it("has exactly 4 channel rows: website, linkedin, gbp, email", () => {
    const cadence = requireCadence();
    expect(cadence.rows.map((r) => r.channel)).toEqual(["website", "linkedin", "gbp", "email"]);
  });

  it("every row's cells array is aligned 1:1 with days (length 2)", () => {
    const cadence = requireCadence();
    for (const row of cadence.rows) {
      expect(row.cells).toHaveLength(2);
    }
  });

  it("website, linkedin, and gbp rows carry Tuesday content and a null Wednesday cell", () => {
    const cadence = requireCadence();
    for (const channel of ["website", "linkedin", "gbp"] as const) {
      const row = cadence.rows.find((r) => r.channel === channel);
      expect(row).toBeDefined();
      expect(row!.cells[0]).not.toBeNull();
      expect(row!.cells[0]!.length).toBeGreaterThan(0);
      expect(row!.cells[1]).toBeNull();
    }
  });

  it("the email row is Wednesday-only: null Tuesday cell, one card sending after link verification", () => {
    const cadence = requireCadence();
    const emailRow = cadence.rows.find((r) => r.channel === "email");
    expect(emailRow).toBeDefined();
    expect(emailRow!.cells[0]).toBeNull();
    expect(emailRow!.cells[1]).not.toBeNull();
    expect(emailRow!.cells[1]).toHaveLength(1);
    const card = emailRow!.cells[1]![0];
    expect(card.piece).toBe("The DRG Law Minute");
    expect(card.count).toBe(1);
    expect(card.detail).toMatch(/verify live/i);
  });
});

describe("DRG cadence v5.2 model — minute section (section 4)", () => {
  it("has a section label wired for the numbered section 4 title", () => {
    const cadence = requireCadence();
    expect(cadence.sectionLabels.minute.length).toBeGreaterThan(0);
  });

  it("states the Minute is English-only, relationship-purpose, with no promotional or intake CTA", () => {
    const cadence = requireCadence();
    expect(cadence.minute.intro).toMatch(/english-only/i);
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

  it("readinessNote states the edition simply does not send when a requirement is unmet", () => {
    const cadence = requireCadence();
    expect(cadence.minute.readinessNote).toBe(
      "If any requirement is unmet, the edition does not send that week, full stop.",
    );
  });
});

describe("DRG cadence v5.2 model — transition and reference links", () => {
  it("transition describes capacity discipline instead of the old backlog-first framing", () => {
    const cadence = requireCadence();
    expect(cadence.transition.body).not.toMatch(/backlog/i);
    expect(cadence.transition.body).toMatch(/does not ship/i);
  });

  it("referenceLinks stays empty (overridden at the page level from firm_about.links)", () => {
    const cadence = requireCadence();
    expect(cadence.referenceLinks).toEqual([]);
  });
});
