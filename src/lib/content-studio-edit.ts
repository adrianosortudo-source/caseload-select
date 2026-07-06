// Pure validation for operator-edited version content (Ses.17 WP-2, the
// revision loop). No I/O: the route (pieces/[id]/version/route.ts) reads
// the request body and calls these functions with the parsed value.
//
// Two shapes: Markdown formats submit one edited body_markdown string.
// canonical_service_page (and any future structured format built the same
// way) submits an edited ServicePageBlock[] array, the exact shape already
// stored in content_piece_versions.body_structured, so the client edits
// what it already rendered rather than a different intermediate shape.

import type { ServicePageBlock } from "./content-studio-structured";

export function validateEditedMarkdownBody(
  input: unknown
): { valid: true; body: string } | { valid: false; errors: string[] } {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { valid: false, errors: ["body_markdown must be a non-empty string."] };
  }
  return { valid: true, body: input };
}

export function validateEditedServicePageBlocks(
  input: unknown
): { valid: true; blocks: ServicePageBlock[] } | { valid: false; errors: string[] } {
  if (!Array.isArray(input)) {
    return { valid: false, errors: ["blocks must be an array."] };
  }
  if (input.length === 0) {
    return { valid: false, errors: ["blocks array is empty."] };
  }

  const errors: string[] = [];
  const blocks: ServicePageBlock[] = [];

  input.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") {
      errors.push(`blocks[${i}] is not an object.`);
      return;
    }
    const b = raw as Record<string, unknown>;

    if (b.type === "h1") {
      if (typeof b.key !== "string" || typeof b.line1 !== "string" || typeof b.line2 !== "string") {
        errors.push(`blocks[${i}] (h1) missing key/line1/line2 string fields.`);
        return;
      }
      blocks.push({ type: "h1", key: b.key, line1: b.line1, line2: b.line2 });
      return;
    }

    if (b.type === "section") {
      if (typeof b.key !== "string" || typeof b.body_markdown !== "string") {
        errors.push(`blocks[${i}] (section) missing key/body_markdown string fields.`);
        return;
      }
      blocks.push({
        type: "section",
        key: b.key,
        heading: typeof b.heading === "string" ? b.heading : undefined,
        body_markdown: b.body_markdown,
      });
      return;
    }

    if (b.type === "faq_block") {
      if (typeof b.key !== "string" || !Array.isArray(b.items)) {
        errors.push(`blocks[${i}] (faq_block) missing key or items array.`);
        return;
      }
      const items: Array<{ question: string; answer: string }> = [];
      (b.items as unknown[]).forEach((item, j) => {
        const it = item as Record<string, unknown>;
        if (typeof it?.question !== "string" || typeof it?.answer !== "string") {
          errors.push(`blocks[${i}].items[${j}] missing question/answer string fields.`);
          return;
        }
        items.push({ question: it.question, answer: it.answer });
      });
      if (items.length !== (b.items as unknown[]).length) return; // an item failed above
      blocks.push({ type: "faq_block", key: b.key, items });
      return;
    }

    errors.push(`blocks[${i}] has unknown type "${String(b.type)}".`);
  });

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, blocks };
}
