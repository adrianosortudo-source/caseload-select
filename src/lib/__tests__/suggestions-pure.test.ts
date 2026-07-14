import { describe, expect, it } from "vitest";
import {
  applySuggestionsToHtml,
  latestSuggestionState,
  validateSuggestionAnchor,
  validateSuggestionList,
} from "../suggestions-pure";

function suggestion(over: Partial<Parameters<typeof applySuggestionsToHtml>[1][number]> = {}) {
  return {
    id: "s1",
    deliverable_id: "d",
    version_id: "v",
    firm_id: "f",
    author_role: "lawyer" as const,
    author_id: null,
    author_name: "Damaris",
    operation: "replace" as const,
    annotation: { type: "text" as const, start: 0, end: 6, quote: "Before" },
    original_text: "Before",
    replacement_text: "Prior to",
    rationale: null,
    source_body_sha256: null,
    created_at: "2026-07-13T00:00:00Z",
    ...over,
  };
}

describe("suggestion redline helpers", () => {
  it("validates a selection against the immutable source body", () => {
    expect(validateSuggestionAnchor({
      bodyHtml: "<p>Before you sign.</p>",
      annotation: { type: "text", start: 0, end: 10, quote: "Before you" },
    })).toEqual({ ok: true, originalText: "Before you" });
  });

  it("applies a replacement inside a single text node without injecting markup", () => {
    const result = applySuggestionsToHtml("<p>Before you sign.</p>", [suggestion()]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bodyHtml).toBe("<p>Prior to you sign.</p>");
  });

  it("maps the created event to an open state", () => {
    expect(latestSuggestionState([{ id: "e", suggestion_id: "s", firm_id: "f", event_type: "created", actor_role: "lawyer", actor_id: null, note: null, resulting_version_id: null, created_at: "2026-07-13T00:00:00Z" }], "s")).toBe("open");
  });

  it("applies multiple replacements from the end so offsets stay stable", () => {
    const result = applySuggestionsToHtml("<p>one two three</p>", [
      suggestion({
        id: "s-one",
        annotation: { type: "text", start: 0, end: 3, quote: "one" },
        original_text: "one",
        replacement_text: "first",
      }),
      suggestion({
        id: "s-three",
        annotation: { type: "text", start: 8, end: 13, quote: "three" },
        original_text: "three",
        replacement_text: "third item",
      }),
    ]);
    expect(result).toEqual({ ok: true, bodyHtml: "<p>first two third item</p>" });
  });

  it("rejects overlapping open suggestions", () => {
    const first = suggestion({
      id: "s-one",
      annotation: { type: "text", start: 0, end: 5, quote: "one t" },
      original_text: "one t",
    });
    const second = suggestion({
      id: "s-two",
      annotation: { type: "text", start: 4, end: 7, quote: "two" },
      original_text: "two",
    });
    expect(validateSuggestionList([first, second], [])).toEqual({
      ok: false,
      error: "Two selected suggestions overlap. Apply them separately.",
    });
  });

  it("escapes proposed markup instead of injecting it into the version", () => {
    const result = applySuggestionsToHtml("<p>Before you sign.</p>", [
      suggestion({ replacement_text: "<script>alert(1)</script>" }),
    ]);
    expect(result).toEqual({
      ok: true,
      bodyHtml: "<p>&lt;script&gt;alert(1)&lt;/script&gt; you sign.</p>",
    });
  });
});
