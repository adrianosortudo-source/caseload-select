import { describe, it, expect } from "vitest";
import {
  rowMatchesQuery,
  applyQueueFilters,
  buildChipCounts,
  type FilterableQueueRow,
} from "../triage-queue-filter";

function row(overrides: Partial<FilterableQueueRow> = {}): FilterableQueueRow {
  return {
    lead_id: "L-2026-05-26-AAA",
    band: "A",
    matter_type: "shareholder_dispute",
    contact_name: "Sarah Patel",
    contact_phone: "(647) 555-9999",
    contact_email: "sarah.patel@example.com",
    contact_postal_code: "M5T 1B3",
    slot_answers: { channel: "facebook" },
    ...overrides,
  };
}

describe("rowMatchesQuery", () => {
  it("empty query matches every row", () => {
    expect(rowMatchesQuery(row(), "")).toBe(true);
    expect(rowMatchesQuery(row(), "   ")).toBe(true);
  });

  it("matches lead name case-insensitively", () => {
    expect(rowMatchesQuery(row(), "sarah")).toBe(true);
    expect(rowMatchesQuery(row(), "PATEL")).toBe(true);
    expect(rowMatchesQuery(row(), "Sarah Patel")).toBe(true);
  });

  it("matches partial name (substring)", () => {
    expect(rowMatchesQuery(row(), "atel")).toBe(true);
  });

  it("matches email substring", () => {
    expect(rowMatchesQuery(row(), "example.com")).toBe(true);
    expect(rowMatchesQuery(row(), "sarah.patel@")).toBe(true);
  });

  it("matches phone with formatting differences (digits-only normalisation)", () => {
    expect(rowMatchesQuery(row(), "6475559999")).toBe(true);
    expect(rowMatchesQuery(row(), "647-555-9999")).toBe(true);
    expect(rowMatchesQuery(row(), "(647) 555 9999")).toBe(true);
    expect(rowMatchesQuery(row(), "555")).toBe(true);
  });

  it("matches postal code with or without whitespace", () => {
    expect(rowMatchesQuery(row(), "M5T 1B3")).toBe(true);
    expect(rowMatchesQuery(row(), "M5T1B3")).toBe(true);
    expect(rowMatchesQuery(row(), "m5t")).toBe(true);
  });

  it("matches lead ref short code", () => {
    expect(rowMatchesQuery(row(), "L-2026-05-26-AAA")).toBe(true);
    expect(rowMatchesQuery(row(), "26-AAA")).toBe(true);
    expect(rowMatchesQuery(row(), "AAA")).toBe(true);
  });

  it("matches matter type display label, not the enum string", () => {
    // The enum is shareholder_dispute; display label is "Shareholder Dispute".
    expect(rowMatchesQuery(row(), "Shareholder Dispute")).toBe(true);
    expect(rowMatchesQuery(row(), "shareholder")).toBe(true);
    expect(rowMatchesQuery(row({ matter_type: "wrongful_dismissal" }), "Wrongful Dismissal")).toBe(true);
    expect(rowMatchesQuery(row({ matter_type: "wrongful_dismissal" }), "dismissal")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(rowMatchesQuery(row(), "rajiv")).toBe(false);
    expect(rowMatchesQuery(row(), "@gmail.com")).toBe(false);
    expect(rowMatchesQuery(row(), "M9R 2X1")).toBe(false);
  });

  it("tolerates null contact fields", () => {
    const naked = row({ contact_name: null, contact_phone: null, contact_email: null, contact_postal_code: null });
    // Search still works against lead_id + matter type label.
    expect(rowMatchesQuery(naked, "AAA")).toBe(true);
    expect(rowMatchesQuery(naked, "shareholder")).toBe(true);
    expect(rowMatchesQuery(naked, "patel")).toBe(false);
  });

  it("phone query under 3 digits does not false-positive on text content", () => {
    // "6" alone should NOT match the row purely on the basis of being in the
    // phone — too noisy. Substring text match still works.
    const r = row({
      contact_name: "Anna",
      contact_phone: "(647) 555-9999",
      contact_email: "a@x.com",
      contact_postal_code: null,
      lead_id: "L-001",
      matter_type: "unknown",
    });
    // Two-digit numeric query bails out of the digits-only match path.
    expect(rowMatchesQuery(r, "64")).toBe(false);
  });
});

describe("applyQueueFilters", () => {
  const rows: FilterableQueueRow[] = [
    row({ lead_id: "L-001", band: "A", contact_name: "Sarah Patel", slot_answers: { channel: "facebook" } }),
    row({ lead_id: "L-002", band: "B", contact_name: "Anna Lee", slot_answers: { channel: "whatsapp" } }),
    row({ lead_id: "L-003", band: "C", contact_name: "Marcus Chen", slot_answers: { channel: "voice" } }),
    row({ lead_id: "L-004", band: "D", contact_name: "Diane Wu", slot_answers: { channel: "web" } }),
    row({ lead_id: "L-005", band: "A", contact_name: "Eli Patel", slot_answers: { channel: "instagram" } }),
  ];

  it("no filters returns all rows", () => {
    const out = applyQueueFilters(rows, { query: "", bands: [], channels: [] });
    expect(out.length).toBe(5);
  });

  it("band filter scopes to selected bands", () => {
    const out = applyQueueFilters(rows, { query: "", bands: ["A"], channels: [] });
    expect(out.map((r) => r.lead_id)).toEqual(["L-001", "L-005"]);
  });

  it("multi-band filter (A + B)", () => {
    const out = applyQueueFilters(rows, { query: "", bands: ["A", "B"], channels: [] });
    expect(out.map((r) => r.lead_id)).toEqual(["L-001", "L-002", "L-005"]);
  });

  it("channel filter scopes to selected channels", () => {
    const out = applyQueueFilters(rows, { query: "", bands: [], channels: ["whatsapp", "voice"] });
    expect(out.map((r) => r.lead_id)).toEqual(["L-002", "L-003"]);
  });

  it("combines query + band + channel filters", () => {
    const out = applyQueueFilters(rows, {
      query: "patel",
      bands: ["A"],
      channels: ["facebook", "instagram"],
    });
    // Both Patels are band A; facebook + instagram both included → both pass.
    expect(out.map((r) => r.lead_id).sort()).toEqual(["L-001", "L-005"]);
  });

  it("returns empty array when nothing matches", () => {
    const out = applyQueueFilters(rows, { query: "rajiv", bands: [], channels: [] });
    expect(out).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const before = rows.map((r) => r.lead_id).join(",");
    applyQueueFilters(rows, { query: "patel", bands: ["A"], channels: [] });
    const after = rows.map((r) => r.lead_id).join(",");
    expect(after).toBe(before);
  });
});

describe("buildChipCounts", () => {
  it("counts per band and per channel from the full queue", () => {
    const rows: FilterableQueueRow[] = [
      row({ band: "A", slot_answers: { channel: "facebook" } }),
      row({ band: "A", slot_answers: { channel: "whatsapp" } }),
      row({ band: "B", slot_answers: { channel: "whatsapp" } }),
      row({ band: "C", slot_answers: { channel: "web" } }),
      row({ band: "D", slot_answers: { channel: "voice" } }),
      row({ band: null, slot_answers: { channel: "web" } }),
    ];
    const { bandCounts, channelCounts } = buildChipCounts(rows);
    expect(bandCounts).toEqual({ A: 2, B: 1, C: 1, D: 1 });
    expect(channelCounts).toEqual({ facebook: 1, whatsapp: 2, web: 2, voice: 1 });
  });

  it("handles empty input", () => {
    const { bandCounts, channelCounts } = buildChipCounts([]);
    expect(bandCounts).toEqual({ A: 0, B: 0, C: 0, D: 0 });
    expect(channelCounts).toEqual({});
  });

  it("handles rows missing a channel", () => {
    const rows: FilterableQueueRow[] = [
      row({ band: "A", slot_answers: null }),
      row({ band: "B", slot_answers: {} }),
      row({ band: "C", slot_answers: { channel: "voice" } }),
    ];
    const { bandCounts, channelCounts } = buildChipCounts(rows);
    expect(bandCounts).toEqual({ A: 1, B: 1, C: 1, D: 0 });
    expect(channelCounts).toEqual({ voice: 1 });
  });
});
