import type {
  DeliverableAnnotation,
  DeliverableSuggestion,
  DeliverableSuggestionEvent,
} from "./types";

export type TextSuggestionAnnotation = Extract<DeliverableAnnotation, { type: "text" }>;
export type SuggestionOperation = "replace" | "delete";
export type SuggestionState =
  | "open"
  | "needs_discussion"
  | "applied"
  | "declined"
  | "withdrawn"
  | "superseded";

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

export function plainTextFromHtml(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      const lower = entity.toLowerCase();
      if (ENTITY_MAP[lower]) return ENTITY_MAP[lower];
      if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
      return match;
    });
}

export function latestSuggestionState(
  events: DeliverableSuggestionEvent[],
  suggestionId: string,
): SuggestionState {
  const latest = events
    .filter((event) => event.suggestion_id === suggestionId)
    .sort((a, b) => {
      const time = a.created_at.localeCompare(b.created_at);
      return time || a.id.localeCompare(b.id);
    })
    .at(-1);
  if (!latest || latest.event_type === "created") return "open";
  return latest.event_type;
}

export function validateSuggestionAnchor(input: {
  bodyHtml: string;
  annotation: TextSuggestionAnnotation;
}): { ok: true; originalText: string } | { ok: false; error: string } {
  const text = plainTextFromHtml(input.bodyHtml);
  const start = Math.floor(input.annotation.start);
  const end = Math.floor(input.annotation.end);
  if (start < 0 || end <= start || end > text.length) {
    return { ok: false, error: "The selected passage is outside the current version." };
  }
  const originalText = text.slice(start, end);
  if (originalText !== input.annotation.quote) {
    return { ok: false, error: "The selected passage no longer matches this version." };
  }
  return { ok: true, originalText };
}

export function validateSuggestionReplacement(input: {
  operation: SuggestionOperation;
  replacementText: unknown;
}): { ok: true; replacementText: string | null } | { ok: false; error: string } {
  if (input.operation === "delete") {
    if (input.replacementText !== null && input.replacementText !== undefined && input.replacementText !== "") {
      return { ok: false, error: "A deletion suggestion cannot include replacement text." };
    }
    return { ok: true, replacementText: null };
  }
  if (typeof input.replacementText !== "string" || !input.replacementText.trim()) {
    return { ok: false, error: "Replacement text is required." };
  }
  if (input.replacementText.length > 5000) {
    return { ok: false, error: "Replacement text is too long." };
  }
  return { ok: true, replacementText: input.replacementText };
}

export function validateSuggestionList(
  suggestions: DeliverableSuggestion[],
  events: DeliverableSuggestionEvent[],
): { ok: true; suggestions: DeliverableSuggestion[] } | { ok: false; error: string } {
  const open = suggestions.filter((suggestion) => {
    const state = latestSuggestionState(events, suggestion.id);
    return state === "open" || state === "needs_discussion";
  });
  const sorted = [...open].sort((a, b) => {
    const aStart = typeof a.annotation.start === "number" ? a.annotation.start : 0;
    const bStart = typeof b.annotation.start === "number" ? b.annotation.start : 0;
    return aStart - bStart;
  });
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    const previousEnd = previous.annotation.end;
    const currentStart = current.annotation.start;
    if (currentStart < previousEnd) {
      return { ok: false, error: "Two selected suggestions overlap. Apply them separately." };
    }
  }
  return { ok: true, suggestions: sorted };
}

function escapeHtmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * Apply plain-text replacements to HTML without allowing a suggestion to
 * inject markup. Phase one intentionally supports a selection contained in a
 * single text node. Cross-block edits remain comments until a structured rich
 * text editor is introduced.
 */
export function applySuggestionsToHtml(
  bodyHtml: string,
  suggestions: DeliverableSuggestion[],
): { ok: true; bodyHtml: string } | { ok: false; error: string } {
  let output = bodyHtml;
  const ordered = [...suggestions].sort((a, b) => b.annotation.start - a.annotation.start);
  for (const suggestion of ordered) {
    const original = suggestion.original_text;
    const replacement = suggestion.operation === "delete" ? "" : suggestion.replacement_text ?? "";
    const tokenPattern = /(<[^>]*>|[^<]+)/g;
    let plainOffset = 0;
    let found = false;
    output = output.replace(tokenPattern, (token) => {
      if (found || token.startsWith("<")) return token;
      const decoded = plainTextFromHtml(token);
      const start = suggestion.annotation.start;
      const end = suggestion.annotation.end;
      const tokenStart = plainOffset;
      const tokenEnd = plainOffset + decoded.length;
      plainOffset = tokenEnd;
      if (start < tokenStart || end > tokenEnd) return token;
      const localStart = start - tokenStart;
      const localEnd = end - tokenStart;
      if (decoded.slice(localStart, localEnd) !== original || /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(token)) {
        return token;
      }
      found = true;
      return `${token.slice(0, localStart)}${escapeHtmlText(replacement)}${token.slice(localEnd)}`;
    });
    if (!found) return { ok: false, error: `Could not safely apply suggestion ${suggestion.id}.` };
  }
  return { ok: true, bodyHtml: output };
}
