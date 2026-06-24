import { describe, it, expect } from "vitest";
import {
  groupByFormat,
  planProgress,
  computeOverview,
  type PlanDeliverable,
} from "../deliverables-pure";

function item(p: Partial<PlanDeliverable>): PlanDeliverable {
  return {
    id: p.id ?? "x",
    title: p.title ?? "t",
    kicker: p.kicker ?? null,
    status: p.status ?? "in_review",
    content_kind: p.content_kind ?? "text",
    format: p.format ?? null,
    period_id: p.period_id ?? null,
    publish_date: p.publish_date ?? null,
  };
}

describe("groupByFormat", () => {
  it("groups by format in first-appearance order (after date sort)", () => {
    const groups = groupByFormat([
      item({ id: "b", format: "Decision Tool", publish_date: "2026-06-25" }),
      item({ id: "a", format: "Counsel Note", publish_date: "2026-06-24" }),
      item({ id: "c", format: "Counsel Note", publish_date: "2026-06-26" }),
    ]);
    expect(groups.map((g) => g.format)).toEqual(["Counsel Note", "Decision Tool"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("sinks unfiled (null/blank format) to the end", () => {
    const groups = groupByFormat([
      item({ id: "u", format: null, publish_date: "2026-06-20" }),
      item({ id: "a", format: "Counsel Note", publish_date: "2026-06-24" }),
      item({ id: "u2", format: "  ", publish_date: "2026-06-21" }),
    ]);
    expect(groups.map((g) => g.format)).toEqual(["Counsel Note", null]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["u", "u2"]);
  });

  it("orders items within a group by publish date, undated last", () => {
    const groups = groupByFormat([
      item({ id: "late", format: "Counsel Note", publish_date: "2026-06-26" }),
      item({ id: "undated", format: "Counsel Note", publish_date: null }),
      item({ id: "early", format: "Counsel Note", publish_date: "2026-06-22" }),
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["early", "late", "undated"]);
  });
});

describe("planProgress", () => {
  it("counts approved over total", () => {
    expect(
      planProgress([
        { status: "approved" },
        { status: "in_review" },
        { status: "approved" },
        { status: "changes_requested" },
      ]),
    ).toEqual({ approved: 2, total: 4 });
  });

  it("is zero over zero for an empty set", () => {
    expect(planProgress([])).toEqual({ approved: 0, total: 0 });
  });
});

describe("computeOverview", () => {
  it("tallies statuses, weeks, formats, and the soonest unapproved publish", () => {
    const o = computeOverview([
      item({ id: "a", status: "approved", format: "Counsel Note", period_id: "p1", publish_date: "2026-06-24" }),
      item({ id: "b", status: "in_review", format: "Counsel Note", period_id: "p1", publish_date: "2026-06-26" }),
      item({ id: "c", status: "changes_requested", format: "Lead Magnet", period_id: "p2", publish_date: "2026-06-30" }),
      item({ id: "d", status: "draft", format: null, period_id: null, publish_date: null }),
    ]);
    expect(o.total).toBe(4);
    expect(o.approved).toBe(1);
    expect(o.pending).toBe(1);
    expect(o.changes).toBe(1);
    expect(o.draft).toBe(1);
    expect(o.weeks).toBe(2);
    expect(o.byFormat).toEqual([
      { format: "Counsel Note", count: 2 },
      { format: "Lead Magnet", count: 1 },
      { format: null, count: 1 },
    ]);
    // approved item (06-24) is excluded; soonest unapproved is b (06-26)
    expect(o.nextPublish).toEqual({ date: "2026-06-26", title: "t" });
  });

  it("has no nextPublish when every piece is approved or undated", () => {
    const o = computeOverview([
      item({ id: "a", status: "approved", publish_date: "2026-06-24" }),
      item({ id: "b", status: "in_review", publish_date: null }),
    ]);
    expect(o.nextPublish).toBeNull();
  });
});
