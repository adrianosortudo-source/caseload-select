import { describe, it, expect } from "vitest";
import { sortTriageRows, compareTriageRows, type TriageSortable } from "../triage-sort";

function row(band: "A" | "B" | "C" | null, hoursAhead: number, label = ""): TriageSortable & { label: string } {
  const deadline = new Date(Date.now() + hoursAhead * 3_600_000).toISOString();
  return { band, decision_deadline: deadline, label };
}

describe("compareTriageRows", () => {
  it("Band A ranks before Band B", () => {
    expect(compareTriageRows(row("A", 48), row("B", 1))).toBeLessThan(0);
  });

  it("Band B ranks before Band C", () => {
    expect(compareTriageRows(row("B", 48), row("C", 1))).toBeLessThan(0);
  });

  it("null band ranks last", () => {
    expect(compareTriageRows(row("C", 48), row(null, 1))).toBeLessThan(0);
  });

  it("within same band, earlier deadline ranks first", () => {
    expect(compareTriageRows(row("A", 1), row("A", 48))).toBeLessThan(0);
    expect(compareTriageRows(row("B", 6), row("B", 24))).toBeLessThan(0);
  });
});

describe("sortTriageRows", () => {
  it("orders Band A → B → C with deadline tiebreaker", () => {
    const rows = [
      row("C", 1,  "c-soonest"),
      row("A", 48, "a-latest"),
      row("B", 12, "b-middle"),
      row("A", 2,  "a-soonest"),
      row("B", 6,  "b-soonest"),
    ];
    const sorted = sortTriageRows(rows);
    expect(sorted.map((r) => r.label)).toEqual([
      "a-soonest",
      "a-latest",
      "b-soonest",
      "b-middle",
      "c-soonest",
    ]);
  });

  it("does not mutate the input array", () => {
    const original = [row("C", 1, "x"), row("A", 1, "y")];
    const before = original.map((r) => r.label).join(",");
    sortTriageRows(original);
    const after = original.map((r) => r.label).join(",");
    expect(after).toBe(before);
  });

  it("handles an empty input", () => {
    expect(sortTriageRows([])).toEqual([]);
  });
});
