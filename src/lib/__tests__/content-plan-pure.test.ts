import { describe, it, expect } from "vitest";
import {
  groupByFormat,
  planProgress,
  computeOverview,
  displayStatusLabel,
  filterAwaitingSignoff,
  PRE_APPROVED_LABEL,
  STATUS_LABELS,
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
    requires_individual_review: p.requires_individual_review ?? false,
  };
}

describe("groupByFormat", () => {
  it("groups by format; an unlisted format sinks after the named ones by first appearance", () => {
    const groups = groupByFormat([
      item({ id: "b", format: "Decision Tool", publish_date: "2026-06-25" }),
      item({ id: "a", format: "Counsel Note", publish_date: "2026-06-24" }),
      item({ id: "c", format: "Counsel Note", publish_date: "2026-06-26" }),
    ]);
    expect(groups.map((g) => g.format)).toEqual(["Counsel Note", "Decision Tool"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("orders panels by fixed editorial complexity, not publish date (locked 2026-07-06)", () => {
    const groups = groupByFormat([
      item({ id: "gbp", format: "Google Business Profile", publish_date: "2026-06-20" }),
      item({ id: "lm", format: "Lead Magnet", publish_date: "2026-06-21" }),
      item({ id: "citm", format: "Clause in the Margin", publish_date: "2026-06-22" }),
      item({ id: "li", format: "LinkedIn", publish_date: "2026-06-23" }),
      item({ id: "cn", format: "Counsel Note", publish_date: "2026-06-24" }),
    ]);
    // All items are dated earliest-to-latest in the opposite order of the
    // expected panel order, so this only passes under fixed-priority sort.
    expect(groups.map((g) => g.format)).toEqual([
      "Counsel Note",
      "LinkedIn",
      "Clause in the Margin",
      "Lead Magnet",
      "Google Business Profile",
    ]);
  });

  it("pins DRG Law Minute after the other named formats (v5.2 cadence model, 4th channel)", () => {
    const groups = groupByFormat([
      item({ id: "minute", format: "DRG Law Minute", publish_date: "2026-07-14" }),
      item({ id: "gbp", format: "Google Business Profile", publish_date: "2026-07-15" }),
      item({ id: "cn", format: "Counsel Note", publish_date: "2026-07-16" }),
      item({ id: "unfiled", format: null, publish_date: "2026-07-13" }),
      item({ id: "unknown", format: "Decision Tool", publish_date: "2026-07-17" }),
    ]);
    expect(groups.map((g) => g.format)).toEqual([
      "Counsel Note",
      "Google Business Profile",
      "DRG Law Minute",
      "Decision Tool",
      null,
    ]);
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

  it("DR-107: with standingAuthActive omitted, preapproved stays 0 and pending is byte-identical to before DR-107", () => {
    const o = computeOverview([
      item({ id: "a", status: "in_review" }),
      item({ id: "b", status: "in_review", requires_individual_review: true }),
    ]);
    expect(o.pending).toBe(2);
    expect(o.preapproved).toBe(0);
  });

  it("DR-107: with standingAuthActive true, an unflagged in_review item counts as preapproved, not pending", () => {
    const o = computeOverview(
      [
        item({ id: "a", status: "in_review" }),
        item({ id: "b", status: "in_review", requires_individual_review: true }),
        item({ id: "c", status: "changes_requested" }),
      ],
      { standingAuthActive: true },
    );
    expect(o.preapproved).toBe(1);
    expect(o.pending).toBe(1);
    expect(o.changes).toBe(1);
  });
});

describe("displayStatusLabel (DR-107)", () => {
  it("returns Pre-approved only for in_review + standingAuthActive + not flagged", () => {
    expect(
      displayStatusLabel("in_review", { standingAuthActive: true, requiresIndividualReview: false }),
    ).toBe(PRE_APPROVED_LABEL);
  });

  it("returns the plain label when standing authorization is off", () => {
    expect(displayStatusLabel("in_review", { standingAuthActive: false })).toBe(
      STATUS_LABELS.in_review,
    );
  });

  it("returns the plain label when standing authorization is on but the version is flagged", () => {
    expect(
      displayStatusLabel("in_review", { standingAuthActive: true, requiresIndividualReview: true }),
    ).toBe(STATUS_LABELS.in_review);
  });

  it("returns the plain label with no opts at all", () => {
    expect(displayStatusLabel("in_review")).toBe(STATUS_LABELS.in_review);
  });

  it("never relabels any status other than in_review, even with standingAuthActive true", () => {
    for (const status of ["draft", "changes_requested", "approved", "archived"] as const) {
      expect(displayStatusLabel(status, { standingAuthActive: true })).toBe(STATUS_LABELS[status]);
    }
  });
});

describe("filterAwaitingSignoff (DR-107)", () => {
  function row(p: {
    id: string;
    status: "in_review" | "changes_requested" | "draft" | "approved" | "archived";
    firm_id?: string;
    current_version_id?: string | null;
  }) {
    return {
      id: p.id,
      status: p.status,
      firm_id: p.firm_id ?? "firm-1",
      current_version_id: p.current_version_id ?? "v1",
    };
  }

  it("changes_requested always counts, regardless of auth state", () => {
    const rows = [row({ id: "a", status: "changes_requested" })];
    expect(filterAwaitingSignoff(rows, {}, {}).map((r) => r.id)).toEqual(["a"]);
    expect(filterAwaitingSignoff(rows, { "firm-1": true }, {}).map((r) => r.id)).toEqual(["a"]);
  });

  it("non in_review, non changes_requested statuses never count", () => {
    const rows = [
      row({ id: "a", status: "draft" }),
      row({ id: "b", status: "approved" }),
      row({ id: "c", status: "archived" }),
    ];
    expect(filterAwaitingSignoff(rows, {}, {})).toEqual([]);
  });

  it("in_review counts when the firm's authorization is off", () => {
    const rows = [row({ id: "a", status: "in_review", firm_id: "firm-1" })];
    expect(filterAwaitingSignoff(rows, { "firm-1": false }, {}).map((r) => r.id)).toEqual(["a"]);
    expect(filterAwaitingSignoff(rows, {}, {}).map((r) => r.id)).toEqual(["a"]);
  });

  it("in_review is excluded when auth is on and the current version is not flagged", () => {
    const rows = [row({ id: "a", status: "in_review", firm_id: "firm-1", current_version_id: "v1" })];
    expect(filterAwaitingSignoff(rows, { "firm-1": true }, { v1: false })).toEqual([]);
  });

  it("in_review is kept when auth is on and the current version IS flagged", () => {
    const rows = [row({ id: "a", status: "in_review", firm_id: "firm-1", current_version_id: "v1" })];
    expect(filterAwaitingSignoff(rows, { "firm-1": true }, { v1: true }).map((r) => r.id)).toEqual([
      "a",
    ]);
  });

  it("in_review with no current version and auth on does not count (nothing to sign)", () => {
    const rows = [row({ id: "a", status: "in_review", firm_id: "firm-1", current_version_id: null })];
    expect(filterAwaitingSignoff(rows, { "firm-1": true }, {})).toEqual([]);
  });

  it("in_review with no current version and auth off still counts", () => {
    const rows = [row({ id: "a", status: "in_review", firm_id: "firm-1", current_version_id: null })];
    expect(filterAwaitingSignoff(rows, { "firm-1": false }, {}).map((r) => r.id)).toEqual(["a"]);
  });
});
