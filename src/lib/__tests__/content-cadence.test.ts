import { describe, it, expect } from "vitest";
import { getContentCadence, type ContentCadence } from "@/lib/content-cadence";

const DRG_FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

function requireCadence(): ContentCadence {
  const cadence = getContentCadence(DRG_FIRM_ID);
  if (!cadence) throw new Error("expected DRG cadence to be configured");
  return cadence;
}

/** Every piece of prose the panel renders, for the whole-panel guards below. */
function allProse(cadence: ContentCadence): string {
  return [
    cadence.eyebrow,
    cadence.headline,
    cadence.intro,
    cadence.historicalNote?.heading ?? "",
    cadence.historicalNote?.body ?? "",
    cadence.approve.current.label,
    cadence.approve.next?.label ?? "",
    cadence.approve.capacityNote,
    cadence.promise.current.label,
    cadence.promise.next?.label ?? "",
    cadence.promise.next?.note ?? "",
    ...Object.values(cadence.sectionLabels),
    cadence.summaryCta,
    ...cadence.pieces.flatMap((p) => [p.kind, p.name, p.desc, p.tag]),
    ...cadence.counts.map((c) => c.l),
    cadence.futureFormat.eyebrow,
    cadence.futureFormat.name,
    cadence.futureFormat.desc,
    cadence.futureFormat.availabilityLabel,
    ...cadence.rows.flatMap((r) => r.cells.flatMap((c) => (c ?? []).flatMap((k) => [k.slot, k.piece, k.detail]))),
    cadence.magnet.heading,
    cadence.magnet.body,
    ...cadence.magnet.steps.flatMap((s) => [s.title, s.desc]),
    cadence.minute.heading,
    cadence.minute.intro,
    ...cadence.minute.rules,
    cadence.minute.readinessNote,
    cadence.transition.heading,
    cadence.transition.body,
  ].join("\n");
}

describe("getContentCadence", () => {
  it("returns null for a firm with no configured cadence", () => {
    expect(getContentCadence("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("returns the DRG cadence for the DRG firm id", () => {
    expect(getContentCadence(DRG_FIRM_ID)).not.toBeNull();
  });
});

describe("DRG cadence: the panel explains the method, never the current state", () => {
  it("carries no publication or approval status anywhere in its prose", () => {
    const prose = allProse(requireCadence());
    // Status belongs to the deliverables list rendered below this panel.
    // The bare verbs "published" and "approved" are legitimate when they
    // describe the method ("published across the website", "the approved
    // follow-up path"); what is banned is language that reports where a
    // particular week has got to.
    for (const banned of [
      /\b\d+\s+(published|approved|remaining|outstanding)\b/i,
      /\b(published|approved)\s+(now|so far|to date|already)\b/i,
      /\bnot yet (sent|published|approved)\b/i,
      /\b(has|have) not (sent|published|shipped)\b/i,
      /\bstill to (send|publish|approve)\b/i,
      /\bawaiting\b/i,
      /\bbacklog\b/i,
      /\bcurrently\b/i,
      /\bright now\b/i,
      /\bthis week's progress\b/i,
    ]) {
      expect(prose, `banned status language ${banned} appears in the explainer`).not.toMatch(banned);
    }
  });

  it("states no count of completed or outstanding work", () => {
    const prose = allProse(requireCadence());
    expect(prose).not.toMatch(/\b\d+\s+of\s+\d+\b/i);
    expect(prose).not.toMatch(/\bfifteen\b/i);
  });

  it("describes the settled weekly model, so it renders one state and not two", () => {
    const cadence = requireCadence();
    expect(cadence.approve.next).toBeUndefined();
    expect(cadence.promise.next).toBeUndefined();
    expect(cadence.historicalNote).toBeUndefined();
  });
});

describe("DRG cadence: headline and intro describe the weekly package", () => {
  it("headline states the weekly shape, with no trailing punctuation (the .ccp-sq square is the period)", () => {
    const cadence = requireCadence();
    expect(cadence.headline).toBe("Sixteen assets every week, four channels");
    expect(cadence.headline.endsWith(".")).toBe(false);
    expect(cadence.headline.endsWith("!")).toBe(false);
    expect(cadence.headline.endsWith("?")).toBe(false);
  });

  it("intro names the sixteen deliverables, two languages, and all four channels", () => {
    const cadence = requireCadence();
    expect(cadence.intro).toMatch(/sixteen deliverables/i);
    expect(cadence.intro).toMatch(/two languages/i);
    for (const channel of [/website/i, /linkedin/i, /google business profile/i, /email/i]) {
      expect(cadence.intro).toMatch(channel);
    }
  });
});

describe("DRG cadence: no orphan words", () => {
  // A lone final word is banned. CSS text-wrap balance/pretty is the runtime
  // guard; this catches copy that would orphan even without that support, by
  // rejecting a very short last word after a long run of text.
  function lastWordIsStranded(text: string): boolean {
    const words = text.trim().split(/\s+/);
    return words.length > 6 && words[words.length - 1].replace(/[^\p{L}\p{N}]/gu, "").length <= 3;
  }

  it("headline does not end on a stray short word", () => {
    expect(lastWordIsStranded(requireCadence().headline)).toBe(false);
  });

  it("no piece name or section label ends on a stray short word", () => {
    const cadence = requireCadence();
    for (const text of [...cadence.pieces.map((p) => p.name), ...Object.values(cadence.sectionLabels)]) {
      expect(lastWordIsStranded(text), `stranded last word in: ${text}`).toBe(false);
    }
  });
});

describe("DRG cadence: the weekly package at a glance", () => {
  it("is exactly 16 deliverables / 2 languages / 4 channels", () => {
    const cadence = requireCadence();
    const values = cadence.approve.current.metrics.map((m) => `${m.value} ${m.label}`);
    expect(values).toContain("16 deliverables");
    expect(values).toContain("2 languages");
    expect(values).toContain("4 channels");
    expect(cadence.approve.current.metrics).toHaveLength(3);
  });

  it("the flow band reads 1 legal theme, 16 deliverables, 4 channels", () => {
    const cadence = requireCadence();
    expect(cadence.promise.current.metrics.map((m) => m.value)).toEqual(["1", "16", "4"]);
  });

  it("frames the package as a shape rather than a guaranteed quota", () => {
    const cadence = requireCadence();
    expect(cadence.approve.capacityNote).toMatch(/not a quota/i);
    expect(cadence.approve.capacityNote).toMatch(/legal-review capacity/i);
  });
});

describe("DRG cadence: format breakdown", () => {
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

  it("keeps the Minute out of the piece cards: it has its own card and section", () => {
    const cadence = requireCadence();
    expect(cadence.pieces.some((p) => p.icon === "minute")).toBe(false);
    expect(cadence.pieces.some((p) => /minute/i.test(p.name) || /minute/i.test(p.kind))).toBe(false);
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

describe("DRG cadence: schedule covers all four channels of the model", () => {
  it("has exactly 3 days: Tuesday, Wednesday, Thursday", () => {
    const cadence = requireCadence();
    expect(cadence.days.map((d) => d.label)).toEqual(["Tuesday", "Wednesday", "Thursday"]);
  });

  it("has all four channel rows, email included", () => {
    const cadence = requireCadence();
    expect(cadence.rows.map((r) => r.channel)).toEqual(["website", "linkedin", "gbp", "email"]);
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

  it("the email row places the Minute on Wednesday only", () => {
    const cadence = requireCadence();
    const row = cadence.rows.find((r) => r.channel === "email");
    expect(row).toBeDefined();
    expect(row!.cells[0]).toBeNull();
    expect(row!.cells[2]).toBeNull();
    expect(row!.cells[1]).toHaveLength(1);
    expect(row!.cells[1]![0].piece).toMatch(/DRG Law Minute/);
  });

  it("the schedule card counts sum to all 16 deliverables", () => {
    const cadence = requireCadence();
    const allCards = cadence.rows.flatMap((r) => r.cells.flatMap((c) => c ?? []));
    expect(allCards.reduce((n, c) => n + c.count, 0)).toBe(16);
  });
});

describe("DRG cadence: the Minute's operating rules are part of the method", () => {
  it("has a section label wired for the numbered section title", () => {
    const cadence = requireCadence();
    expect(cadence.sectionLabels.minute.length).toBeGreaterThan(0);
  });

  it("intro describes what the Minute is and who it goes to", () => {
    const cadence = requireCadence();
    expect(cadence.minute.intro).toMatch(/already said yes/i);
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

  it("readinessNote keeps the full-stop send gate as a standing rule", () => {
    const cadence = requireCadence();
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
