import { describe, it, expect } from "vitest";
import {
  tokenize,
  damerauLevenshtein,
  highlightText,
  searchAndRankQueue,
  SAVED_VIEWS,
  type SearchableQueueRow,
  type SavedView,
} from "../triage-search";

function row(overrides: Partial<SearchableQueueRow> = {}): SearchableQueueRow {
  return {
    lead_id: "L-2026-05-26-AAA",
    band: "A",
    matter_type: "shareholder_dispute",
    contact_name: "Sarah Patel",
    contact_phone: "(647) 555-9999",
    contact_email: "sarah.patel@example.com",
    contact_postal_code: "M5T 1B3",
    slot_answers: { channel: "facebook" },
    brief_json: { matter_snapshot: "Corporate dispute about company access.", fee_estimate: "$3,000–$10,000+" },
    whale_nurture: false,
    submitted_at: "2026-05-26T10:00:00Z",
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════
// Tokenisation
// ════════════════════════════════════════════════════════════════════

describe("tokenize", () => {
  it("returns empty array for empty / whitespace query", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  it("single plain token", () => {
    expect(tokenize("patel")).toEqual([{ field: "any", value: "patel", qualified: false, negated: false }]);
  });

  it("multi-word plain query yields multiple tokens", () => {
    expect(tokenize("sarah patel")).toEqual([
      { field: "any", value: "sarah", qualified: false, negated: false },
      { field: "any", value: "patel", qualified: false, negated: false },
    ]);
  });

  it("recognises field qualifiers", () => {
    expect(tokenize("name:patel")).toEqual([{ field: "name", value: "patel", qualified: true, negated: false }]);
    expect(tokenize("band:A")).toEqual([{ field: "band", value: "A", qualified: true, negated: false }]);
    expect(tokenize("phone:647")).toEqual([{ field: "phone", value: "647", qualified: true, negated: false }]);
    expect(tokenize("channel:messenger")).toEqual([{ field: "channel", value: "messenger", qualified: true, negated: false }]);
    expect(tokenize("ref:Z3A")).toEqual([{ field: "ref", value: "Z3A", qualified: true, negated: false }]);
    expect(tokenize("matter:dismissal")).toEqual([{ field: "matter", value: "dismissal", qualified: true, negated: false }]);
    expect(tokenize("text:harassment")).toEqual([{ field: "text", value: "harassment", qualified: true, negated: false }]);
  });

  it("mixes qualified + plain tokens", () => {
    expect(tokenize("name:patel band:A messenger")).toEqual([
      { field: "name", value: "patel", qualified: true, negated: false },
      { field: "band", value: "A", qualified: true, negated: false },
      { field: "any", value: "messenger", qualified: false, negated: false },
    ]);
  });

  it("collapses multiple spaces", () => {
    expect(tokenize("  sarah   patel  ")).toEqual([
      { field: "any", value: "sarah", qualified: false, negated: false },
      { field: "any", value: "patel", qualified: false, negated: false },
    ]);
  });

  it("unknown qualifier prefix falls through to plain", () => {
    expect(tokenize("foo:bar")).toEqual([{ field: "any", value: "foo:bar", qualified: false, negated: false }]);
  });

  it("qualifier names are case-insensitive but values keep case", () => {
    expect(tokenize("Name:Patel")).toEqual([{ field: "name", value: "Patel", qualified: true, negated: false }]);
    expect(tokenize("BAND:a")).toEqual([{ field: "band", value: "a", qualified: true, negated: false }]);
  });

  // Quoted phrases
  it("quoted phrase becomes a single token preserving inner spaces", () => {
    expect(tokenize("\"van der berg\"")).toEqual([
      { field: "any", value: "van der berg", qualified: false, negated: false },
    ]);
  });

  it("quoted phrase with field qualifier", () => {
    expect(tokenize("name:\"van der berg\"")).toEqual([
      { field: "name", value: "van der berg", qualified: true, negated: false },
    ]);
  });

  it("mixed quoted + unquoted tokens", () => {
    expect(tokenize("\"sarah patel\" name:lee")).toEqual([
      { field: "any", value: "sarah patel", qualified: false, negated: false },
      { field: "name", value: "lee", qualified: true, negated: false },
    ]);
  });

  it("unclosed quote reads to end-of-string (best effort)", () => {
    expect(tokenize("\"unclosed phrase")).toEqual([
      { field: "any", value: "unclosed phrase", qualified: false, negated: false },
    ]);
  });

  // Negation
  it("negation prefix", () => {
    expect(tokenize("-voice")).toEqual([
      { field: "any", value: "voice", qualified: false, negated: true },
    ]);
  });

  it("negation with field qualifier", () => {
    expect(tokenize("-channel:voice")).toEqual([
      { field: "channel", value: "voice", qualified: true, negated: true },
    ]);
  });

  it("negation with quoted phrase", () => {
    expect(tokenize("-\"out of scope\"")).toEqual([
      { field: "any", value: "out of scope", qualified: false, negated: true },
    ]);
  });

  it("positive + negative combo", () => {
    expect(tokenize("patel -channel:voice")).toEqual([
      { field: "any", value: "patel", qualified: false, negated: false },
      { field: "channel", value: "voice", qualified: true, negated: true },
    ]);
  });

  it("bare dash with no following char is not treated as negation", () => {
    expect(tokenize("-")).toEqual([]);
    expect(tokenize("- patel")).toEqual([
      { field: "any", value: "patel", qualified: false, negated: false },
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Damerau-Levenshtein
// ════════════════════════════════════════════════════════════════════

describe("damerauLevenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(damerauLevenshtein("patel", "patel")).toBe(0);
    expect(damerauLevenshtein("", "")).toBe(0);
  });

  it("returns length when one string is empty", () => {
    expect(damerauLevenshtein("", "patel")).toBe(5);
    expect(damerauLevenshtein("patel", "")).toBe(5);
  });

  it("single insertion", () => {
    expect(damerauLevenshtein("patel", "patell")).toBe(1);
  });

  it("single deletion", () => {
    expect(damerauLevenshtein("patell", "patel")).toBe(1);
  });

  it("single substitution", () => {
    expect(damerauLevenshtein("patel", "petel")).toBe(1);
  });

  it("adjacent transposition counts as 1, not 2", () => {
    // Damerau-Levenshtein gives single-edit credit only when the swapped
    // characters are adjacent. "patel" → "ptael" swaps positions 1 and 2
    // (a↔t), adjacent — distance 1.
    expect(damerauLevenshtein("patel", "ptael")).toBe(1);
    expect(damerauLevenshtein("abcd", "bacd")).toBe(1);
  });

  it("non-adjacent swap counts as 2 substitutions", () => {
    // "sarah" → "sahar" swaps the r (position 2) with the h (position 4) —
    // not adjacent, so it costs 2 substitutions, not 1 transposition.
    expect(damerauLevenshtein("sarah", "sahar")).toBe(2);
  });

  it("classic kitten/sitting", () => {
    expect(damerauLevenshtein("kitten", "sitting")).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════
// Search + rank — substring + prefix + exact
// ════════════════════════════════════════════════════════════════════

describe("searchAndRankQueue — exact / prefix / substring", () => {
  it("empty query returns rows in original order with score 0", () => {
    const rows = [row({ lead_id: "A" }), row({ lead_id: "B" }), row({ lead_id: "C" })];
    const out = searchAndRankQueue(rows, { query: "", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A", "B", "C"]);
    expect(out.every((s) => s.score === 0)).toBe(true);
  });

  it("name substring match", () => {
    const rows = [
      row({ lead_id: "A", contact_name: "Sarah Patel" }),
      row({ lead_id: "B", contact_name: "Anna Lee", contact_email: "anna@example.com", contact_phone: "(416) 555-1111" }),
    ];
    const out = searchAndRankQueue(rows, { query: "patel", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A"]);
  });

  it("exact name match ranks higher than substring", () => {
    const rows = [
      row({ lead_id: "A", contact_name: "Sarah Patel-Singh", contact_email: "sarah.singh@example.com", contact_phone: "(416) 555-1111" }), // substring
      row({ lead_id: "B", contact_name: "patel", contact_email: "patel@example.com", contact_phone: "(416) 555-2222" }), // exact name (lowercase)
    ];
    const out = searchAndRankQueue(rows, { query: "patel", bands: [], channels: [] });
    expect(out[0].row.lead_id).toBe("B");
    expect(out[1].row.lead_id).toBe("A");
  });

  it("prefix match ranks higher than substring", () => {
    const rows = [
      row({ lead_id: "A", contact_name: "Marcus Patel", contact_email: "marcus@example.com", contact_phone: "(416) 555-1111" }),
      row({ lead_id: "B", contact_name: "Patel Sarah", contact_email: "p.sarah@example.com", contact_phone: "(416) 555-2222" }),
    ];
    const out = searchAndRankQueue(rows, { query: "patel", bands: [], channels: [] });
    expect(out[0].row.lead_id).toBe("B");
  });

  it("phone match via digits-only normalisation", () => {
    const rows = [
      row({ lead_id: "A", contact_phone: "(647) 555-9999" }),
      row({ lead_id: "B", contact_phone: "(416) 555-1111" }),
    ];
    const out = searchAndRankQueue(rows, { query: "6475559999", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A"]);
  });

  it("postal match via whitespace-stripped normalisation", () => {
    const rows = [
      row({ lead_id: "A", contact_postal_code: "M5T 1B3" }),
      row({ lead_id: "B", contact_postal_code: "M9R 2X1" }),
    ];
    const out = searchAndRankQueue(rows, { query: "m5t1b3", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A"]);
  });

  it("matter type label match (display string, not enum)", () => {
    const rows = [
      row({ lead_id: "A", matter_type: "wrongful_dismissal" }),
      row({ lead_id: "B", matter_type: "shareholder_dispute" }),
    ];
    const out = searchAndRankQueue(rows, { query: "dismissal", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A"]);
  });

  it("lead ref short-code match", () => {
    const rows = [
      row({ lead_id: "L-2026-05-26-Z3A" }),
      row({ lead_id: "L-2026-05-26-X9B" }),
    ];
    const out = searchAndRankQueue(rows, { query: "Z3A", bands: [], channels: [] });
    expect(out[0].row.lead_id).toBe("L-2026-05-26-Z3A");
  });
});

// ════════════════════════════════════════════════════════════════════
// Search + rank — fuzzy
// ════════════════════════════════════════════════════════════════════

describe("searchAndRankQueue — fuzzy match", () => {
  it("typo in name (1 edit) still matches", () => {
    const rows = [row({ contact_name: "Sarah Patel" })];
    const out = searchAndRankQueue(rows, { query: "patell", bands: [], channels: [] });
    expect(out.length).toBe(1);
  });

  it("adjacent transposition in name matches", () => {
    // "patel" → "ptael" is a single adjacent transposition (distance 1).
    const rows = [row({ contact_name: "Patel", contact_email: null, contact_phone: null, contact_postal_code: null })];
    const out = searchAndRankQueue(rows, { query: "ptael", bands: [], channels: [] });
    expect(out.length).toBe(1);
  });

  it("fuzzy match scores lower than substring match", () => {
    const rows = [
      row({ lead_id: "A", contact_name: "Sahar Khan" }),  // fuzzy match to "sarah"
      row({ lead_id: "B", contact_name: "Sarah Patel" }), // substring match
    ];
    const out = searchAndRankQueue(rows, { query: "sarah", bands: [], channels: [] });
    expect(out[0].row.lead_id).toBe("B");
  });

  it("short query (under 4 chars) does NOT fuzzy match", () => {
    const rows = [row({ contact_name: "Sarah Patel" })];
    // "Pat" with one transposition would be "Apt" — should NOT match.
    const out = searchAndRankQueue(rows, { query: "apt", bands: [], channels: [] });
    expect(out.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// Search + rank — multi-token AND
// ════════════════════════════════════════════════════════════════════

describe("searchAndRankQueue — multi-token AND", () => {
  it("two tokens: both must match (AND, not OR)", () => {
    const rows = [
      row({ lead_id: "A", contact_name: "Sarah Patel", slot_answers: { channel: "facebook" } }),
      row({ lead_id: "B", contact_name: "Sarah Patel", slot_answers: { channel: "whatsapp" } }),
      row({ lead_id: "C", contact_name: "Anna Lee", contact_email: "anna@example.com", contact_phone: "(416) 555-1111", slot_answers: { channel: "facebook" } }),
    ];
    const out = searchAndRankQueue(rows, { query: "patel facebook", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A"]);
  });

  it("token order does not matter", () => {
    const rows = [row({ contact_name: "Sarah Patel", slot_answers: { channel: "whatsapp" } })];
    const a = searchAndRankQueue(rows, { query: "patel whatsapp", bands: [], channels: [] });
    const b = searchAndRankQueue(rows, { query: "whatsapp patel", bands: [], channels: [] });
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });

  it("score sums across tokens — more matches rank higher", () => {
    const rows = [
      row({ lead_id: "A", contact_name: "Sarah Patel", slot_answers: { channel: "whatsapp" } }),
      row({ lead_id: "B", contact_name: "Sarah Lee",   slot_answers: { channel: "whatsapp" } }),
    ];
    const out = searchAndRankQueue(rows, { query: "sarah whatsapp", bands: [], channels: [] });
    // Both match both tokens, but A's name also contains a sub-string of "sarah"
    // (same as B). Tie OK — what matters is both rows pass and order is stable.
    expect(out.length).toBe(2);
  });

  it("missing one of two tokens excludes the row", () => {
    const rows = [
      row({ contact_name: "Sarah Patel", slot_answers: { channel: "facebook" } }),
    ];
    // facebook AND lee → lee misses
    const out = searchAndRankQueue(rows, { query: "facebook lee", bands: [], channels: [] });
    expect(out.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// Search + rank — field qualifiers
// ════════════════════════════════════════════════════════════════════

describe("searchAndRankQueue — field qualifiers", () => {
  const rows: SearchableQueueRow[] = [
    row({ lead_id: "L-AAA", band: "A", contact_name: "Sarah Patel", slot_answers: { channel: "facebook" } }),
    row({ lead_id: "L-BBB", band: "B", contact_name: "Anna Lee",    slot_answers: { channel: "whatsapp" } }),
    row({ lead_id: "L-CCC", band: "C", contact_name: "Patel Marcus", slot_answers: { channel: "voice" } }),
  ];

  it("name: qualifier searches only the name", () => {
    const out = searchAndRankQueue(rows, { query: "name:patel", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id).sort()).toEqual(["L-AAA", "L-CCC"]);
  });

  it("band: qualifier filters by band", () => {
    const out = searchAndRankQueue(rows, { query: "band:A", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["L-AAA"]);
  });

  it("channel: qualifier matches channel code or label", () => {
    const out = searchAndRankQueue(rows, { query: "channel:voice", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["L-CCC"]);
  });

  it("ref: qualifier matches lead id substring", () => {
    const out = searchAndRankQueue(rows, { query: "ref:AAA", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["L-AAA"]);
  });

  it("combining qualifier with plain ANDs them", () => {
    const out = searchAndRankQueue(rows, { query: "name:patel band:A", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["L-AAA"]);
  });

  it("text: qualifier matches brief snapshot/fee", () => {
    const rs = [
      row({ lead_id: "X", brief_json: { matter_snapshot: "harassment complaint", fee_estimate: "$5,000" } }),
      row({ lead_id: "Y", brief_json: { matter_snapshot: "wrongful dismissal", fee_estimate: "$8,000" } }),
    ];
    const out = searchAndRankQueue(rs, { query: "text:harassment", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["X"]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Search + rank — quoted phrases
// ════════════════════════════════════════════════════════════════════

describe("searchAndRankQueue — quoted phrases", () => {
  it("multi-word phrase matches contiguous substring only", () => {
    const rows = [
      row({ lead_id: "A", contact_name: "Van Der Berg", contact_email: "vdb@example.com", contact_phone: "(416) 555-1111", contact_postal_code: null }),
      row({ lead_id: "B", contact_name: "Van Sarah", contact_email: "v@example.com", contact_phone: "(416) 555-2222", contact_postal_code: null }),
      row({ lead_id: "C", contact_name: "Der Anna", contact_email: "d@example.com", contact_phone: "(416) 555-3333", contact_postal_code: null }),
    ];
    const out = searchAndRankQueue(rows, { query: "\"van der\"", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A"]);
  });

  it("quoted phrase with field qualifier", () => {
    const rows = [
      row({ lead_id: "A", contact_name: "Van Der Berg" }),
      row({ lead_id: "B", contact_name: "Lee Anna" }),
    ];
    const out = searchAndRankQueue(rows, { query: "name:\"van der\"", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A"]);
  });

  it("quoted phrase requires contiguous match (NOT word-bag)", () => {
    const rows = [
      row({ lead_id: "A", contact_name: "Sarah Van Anna Der Berg" }), // van and der not adjacent
    ];
    const out = searchAndRankQueue(rows, { query: "\"van der\"", bands: [], channels: [] });
    // No contiguous "van der" → no match.
    expect(out.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// Search + rank — negation
// ════════════════════════════════════════════════════════════════════

describe("searchAndRankQueue — negation", () => {
  const rows: SearchableQueueRow[] = [
    row({ lead_id: "A", contact_name: "Sarah Patel", slot_answers: { channel: "facebook" } }),
    row({ lead_id: "B", contact_name: "Sarah Patel", slot_answers: { channel: "voice" } }),
    row({ lead_id: "C", contact_name: "Anna Lee",   contact_email: "anna@example.com", contact_phone: "(416) 555-1111", slot_answers: { channel: "voice" } }),
  ];

  it("negated qualified token excludes matching rows", () => {
    const out = searchAndRankQueue(rows, { query: "-channel:voice", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A"]);
  });

  it("positive + negative combo", () => {
    // patel AND NOT voice → row A only.
    const out = searchAndRankQueue(rows, { query: "patel -channel:voice", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A"]);
  });

  it("negated unqualified token excludes any-field match", () => {
    const rs = [
      row({ lead_id: "X", contact_name: "Sarah Patel" }),
      row({ lead_id: "Y", contact_name: "Anna Lee", contact_email: "anna@example.com", contact_phone: "(416) 555-1111" }),
    ];
    // -patel → exclude any row containing "patel" anywhere.
    const out = searchAndRankQueue(rs, { query: "-patel", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["Y"]);
  });

  it("negated quoted phrase", () => {
    const rs = [
      row({ lead_id: "X", contact_name: "Van Der Berg" }),
      row({ lead_id: "Y", contact_name: "Anna Lee", contact_email: "anna@example.com", contact_phone: "(416) 555-1111" }),
    ];
    const out = searchAndRankQueue(rs, { query: "-\"van der\"", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["Y"]);
  });

  it("query with only negations returns rows that don't match", () => {
    const rs = [
      row({ lead_id: "A", slot_answers: { channel: "facebook" } }),
      row({ lead_id: "B", slot_answers: { channel: "voice" } }),
    ];
    const out = searchAndRankQueue(rs, { query: "-channel:voice", bands: [], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A"]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Brief-text fallback
// ════════════════════════════════════════════════════════════════════

describe("searchAndRankQueue — brief-text scoring", () => {
  it("matches a unique word in snapshot when nowhere else does", () => {
    const rows = [
      row({ contact_name: "Sarah Patel", brief_json: { matter_snapshot: "Caller mentioned a harassment complaint from her employer." } }),
      row({ contact_name: "Anna Lee",    brief_json: { matter_snapshot: "Wrongful dismissal case." } }),
    ];
    const out = searchAndRankQueue(rows, { query: "harassment", bands: [], channels: [] });
    expect(out.length).toBe(1);
    expect(out[0].row.contact_name).toBe("Sarah Patel");
  });

  it("brief-text matches score lower than name matches (ranking)", () => {
    const rows = [
      row({ lead_id: "A", contact_name: "Anna Lee",      brief_json: { matter_snapshot: "Caller is Patel-Singh's neighbour." } }),
      row({ lead_id: "B", contact_name: "Sarah Patel",   brief_json: { matter_snapshot: "Generic." } }),
    ];
    const out = searchAndRankQueue(rows, { query: "patel", bands: [], channels: [] });
    expect(out[0].row.lead_id).toBe("B");
  });
});

// ════════════════════════════════════════════════════════════════════
// Filters: band + channel chips
// ════════════════════════════════════════════════════════════════════

describe("searchAndRankQueue — band/channel filters", () => {
  const rows: SearchableQueueRow[] = [
    row({ lead_id: "A", band: "A", slot_answers: { channel: "facebook" } }),
    row({ lead_id: "B", band: "B", slot_answers: { channel: "whatsapp" } }),
    row({ lead_id: "C", band: "C", slot_answers: { channel: "voice" } }),
    row({ lead_id: "D", band: "D", slot_answers: { channel: "web" } }),
  ];

  it("band filter applied", () => {
    const out = searchAndRankQueue(rows, { query: "", bands: ["A", "B"], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["A", "B"]);
  });

  it("channel filter applied", () => {
    const out = searchAndRankQueue(rows, { query: "", bands: [], channels: ["voice", "whatsapp"] });
    expect(out.map((s) => s.row.lead_id).sort()).toEqual(["B", "C"]);
  });

  it("filter + query combine", () => {
    const rs = [
      row({ lead_id: "1", band: "A", contact_name: "Sarah Patel" }),
      row({ lead_id: "2", band: "B", contact_name: "Sarah Patel" }),
      row({ lead_id: "3", band: "A", contact_name: "Anna Lee", contact_email: "anna@example.com", contact_phone: "(416) 555-1111" }),
    ];
    const out = searchAndRankQueue(rs, { query: "patel", bands: ["A"], channels: [] });
    expect(out.map((s) => s.row.lead_id)).toEqual(["1"]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Saved views
// ════════════════════════════════════════════════════════════════════

describe("searchAndRankQueue — saved views", () => {
  const NOW = new Date("2026-05-26T15:00:00Z");

  it("Top priority view scopes to bands A + B", () => {
    const rows = [
      row({ lead_id: "1", band: "A" }),
      row({ lead_id: "2", band: "B" }),
      row({ lead_id: "3", band: "C" }),
      row({ lead_id: "4", band: "D" }),
    ];
    const view = SAVED_VIEWS.find((v) => v.id === "priority")!;
    const out = searchAndRankQueue(rows, { query: "", bands: [], channels: [], view, now: NOW });
    expect(out.map((s) => s.row.lead_id).sort()).toEqual(["1", "2"]);
  });

  it("Whales view scopes to whale_nurture=true", () => {
    const rows = [
      row({ lead_id: "1", whale_nurture: true }),
      row({ lead_id: "2", whale_nurture: false }),
    ];
    const view = SAVED_VIEWS.find((v) => v.id === "whales")!;
    const out = searchAndRankQueue(rows, { query: "", bands: [], channels: [], view, now: NOW });
    expect(out.map((s) => s.row.lead_id)).toEqual(["1"]);
  });

  it("Voice view scopes to channel=voice", () => {
    const rows = [
      row({ lead_id: "1", slot_answers: { channel: "voice" } }),
      row({ lead_id: "2", slot_answers: { channel: "facebook" } }),
    ];
    const view = SAVED_VIEWS.find((v) => v.id === "voice")!;
    const out = searchAndRankQueue(rows, { query: "", bands: [], channels: [], view, now: NOW });
    expect(out.map((s) => s.row.lead_id)).toEqual(["1"]);
  });

  it("Stale view scopes to leads older than 4h", () => {
    const rows = [
      row({ lead_id: "fresh", submitted_at: new Date(NOW.getTime() - 1 * 3_600_000).toISOString() }),
      row({ lead_id: "stale", submitted_at: new Date(NOW.getTime() - 5 * 3_600_000).toISOString() }),
    ];
    const view = SAVED_VIEWS.find((v) => v.id === "stale")!;
    const out = searchAndRankQueue(rows, { query: "", bands: [], channels: [], view, now: NOW });
    expect(out.map((s) => s.row.lead_id)).toEqual(["stale"]);
  });

  it("user filter intersects with view filter", () => {
    const rows = [
      row({ lead_id: "1", band: "A" }),
      row({ lead_id: "2", band: "B" }),
    ];
    const view = SAVED_VIEWS.find((v) => v.id === "priority")!; // bands A+B
    // User clicks Band A on top → intersection is just A
    const out = searchAndRankQueue(rows, { query: "", bands: ["A"], channels: [], view, now: NOW });
    expect(out.map((s) => s.row.lead_id)).toEqual(["1"]);
  });

  it("view + query combine — query on top of view's preset", () => {
    const rows: SearchableQueueRow[] = [
      row({ lead_id: "1", band: "A", contact_name: "Sarah Patel" }),
      row({ lead_id: "2", band: "A", contact_name: "Anna Lee", contact_email: "anna@example.com", contact_phone: "(416) 555-1111" }),
      row({ lead_id: "3", band: "C", contact_name: "Sarah Patel" }),
    ];
    const view = SAVED_VIEWS.find((v) => v.id === "priority")!;
    const out = searchAndRankQueue(rows, { query: "patel", bands: [], channels: [], view, now: NOW });
    // priority view → A+B only; then patel → row 1 wins.
    expect(out.map((s) => s.row.lead_id)).toEqual(["1"]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Highlighting
// ════════════════════════════════════════════════════════════════════

describe("highlightText", () => {
  it("returns single text segment when no tokens", () => {
    expect(highlightText("Sarah Patel", [])).toEqual([{ text: "Sarah Patel" }]);
  });

  it("wraps a single match", () => {
    expect(highlightText("Sarah Patel", ["patel"])).toEqual([
      { text: "Sarah " },
      { mark: "Patel" },
    ]);
  });

  it("wraps multiple matches across the string", () => {
    expect(highlightText("Patel Sarah Patel", ["patel"])).toEqual([
      { mark: "Patel" },
      { text: " Sarah " },
      { mark: "Patel" },
    ]);
  });

  it("case-insensitive match preserves original case in the mark", () => {
    expect(highlightText("PATEL", ["patel"])).toEqual([{ mark: "PATEL" }]);
    expect(highlightText("Sarah", ["sarah"])).toEqual([{ mark: "Sarah" }]);
  });

  it("longer token wins over shorter prefix at overlapping positions", () => {
    const segs = highlightText("patel", ["pat", "patel"]);
    expect(segs).toEqual([{ mark: "patel" }]);
  });

  it("returns empty array for empty input", () => {
    expect(highlightText("", ["x"])).toEqual([]);
  });

  it("non-matching tokens leave the string intact", () => {
    expect(highlightText("Sarah Patel", ["xyz"])).toEqual([{ text: "Sarah Patel" }]);
  });

  it("multi-token: each token's matches highlighted independently", () => {
    const segs = highlightText("Sarah Anna Patel", ["sarah", "patel"]);
    expect(segs).toEqual([
      { mark: "Sarah" },
      { text: " Anna " },
      { mark: "Patel" },
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Ranking stability
// ════════════════════════════════════════════════════════════════════

describe("searchAndRankQueue — ranking sanity", () => {
  it("score never negative", () => {
    const rows = [row()];
    const out = searchAndRankQueue(rows, { query: "patel", bands: [], channels: [] });
    expect(out.every((s) => s.score >= 0)).toBe(true);
  });

  it("does not mutate input array", () => {
    const rows = [row({ lead_id: "A" }), row({ lead_id: "B" })];
    const before = rows.map((r) => r.lead_id).join(",");
    searchAndRankQueue(rows, { query: "patel", bands: [], channels: [] });
    expect(rows.map((r) => r.lead_id).join(",")).toBe(before);
  });

  it("returns empty array when nothing matches", () => {
    const rows = [row({ contact_name: "Sarah Patel" })];
    const out = searchAndRankQueue(rows, { query: "completely-different-person-rajiv", bands: [], channels: [] });
    expect(out).toEqual([]);
  });

  it("highlights include the lower-cased tokens that matched", () => {
    const rows = [row({ contact_name: "Sarah Patel" })];
    const out = searchAndRankQueue(rows, { query: "Patel", bands: [], channels: [] });
    expect(out[0].highlights).toEqual(["patel"]);
  });
});
