import { describe, it, expect } from "vitest";
import {
  validateEditedMarkdownBody,
  validateEditedServicePageBlocks,
} from "../content-studio-edit";

describe("validateEditedMarkdownBody", () => {
  it("accepts a non-empty string", () => {
    const result = validateEditedMarkdownBody("Some edited body text.");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.body).toBe("Some edited body text.");
  });

  it("rejects an empty string", () => {
    expect(validateEditedMarkdownBody("").valid).toBe(false);
    expect(validateEditedMarkdownBody("   ").valid).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(validateEditedMarkdownBody(null).valid).toBe(false);
    expect(validateEditedMarkdownBody(undefined).valid).toBe(false);
    expect(validateEditedMarkdownBody(42).valid).toBe(false);
    expect(validateEditedMarkdownBody({}).valid).toBe(false);
  });
});

describe("validateEditedServicePageBlocks", () => {
  const validBlocks = [
    { type: "h1", key: "h1_key", line1: "Line one", line2: "Line two" },
    { type: "section", key: "section_key", heading: "A Heading", body_markdown: "Body text here." },
    { type: "section", key: "no_heading_section", body_markdown: "No heading on this one." },
    {
      type: "faq_block",
      key: "faq_key",
      items: [
        { question: "Do I need this?", answer: "Yes, generally." },
        { question: "How much does it cost?", answer: "It depends." },
      ],
    },
  ];

  it("accepts a well-formed blocks array covering all three block types", () => {
    const result = validateEditedServicePageBlocks(validBlocks);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.blocks).toHaveLength(4);
  });

  it("rejects non-array input", () => {
    expect(validateEditedServicePageBlocks(null).valid).toBe(false);
    expect(validateEditedServicePageBlocks({}).valid).toBe(false);
    expect(validateEditedServicePageBlocks("not an array").valid).toBe(false);
  });

  it("rejects an empty array", () => {
    const result = validateEditedServicePageBlocks([]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]).toContain("empty");
  });

  it("rejects an h1 block missing line2", () => {
    const result = validateEditedServicePageBlocks([
      { type: "h1", key: "h1_key", line1: "Only one line" },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]).toContain("h1");
  });

  it("rejects a section block missing body_markdown", () => {
    const result = validateEditedServicePageBlocks([
      { type: "section", key: "sec", heading: "A heading with no body" },
    ]);
    expect(result.valid).toBe(false);
  });

  it("allows a section block with no heading (heading is optional)", () => {
    const result = validateEditedServicePageBlocks([
      { type: "section", key: "sec", body_markdown: "Body only, no heading." },
    ]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      const block = result.blocks[0];
      expect(block.type).toBe("section");
      if (block.type === "section") expect(block.heading).toBeUndefined();
    }
  });

  it("rejects a faq_block item missing an answer", () => {
    const result = validateEditedServicePageBlocks([
      {
        type: "faq_block",
        key: "faq",
        items: [{ question: "A question with no answer?" }],
      },
    ]);
    expect(result.valid).toBe(false);
  });

  it("rejects an unknown block type", () => {
    const result = validateEditedServicePageBlocks([{ type: "unknown_type", key: "x" }]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[0]).toContain("unknown type");
  });

  it("collects multiple errors across multiple malformed blocks", () => {
    const result = validateEditedServicePageBlocks([
      { type: "h1", key: "h1" },
      { type: "section", key: "sec" },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors).toHaveLength(2);
  });
});
