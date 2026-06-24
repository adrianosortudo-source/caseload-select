import { describe, it, expect } from "vitest";
import {
  validateAnnotation,
  cleanTitle,
  cleanDescription,
  cleanNote,
  cleanCommentBody,
  canSignOff,
  canPostVersion,
  statusAfterNewVersion,
  statusAfterDecision,
  isValidContentKind,
  annotationLabel,
  openCommentCount,
  APPROVAL_ATTESTATION,
} from "@/lib/deliverables-pure";

describe("validateAnnotation", () => {
  it("accepts a valid text annotation", () => {
    expect(validateAnnotation({ type: "text", start: 5, end: 12, quote: "hello" })).toEqual({
      type: "text",
      start: 5,
      end: 12,
      quote: "hello",
    });
  });

  it("rejects a text annotation with no quote", () => {
    expect(validateAnnotation({ type: "text", start: 0, end: 3, quote: "" })).toBeNull();
  });

  it("rejects end <= start (zero-length range)", () => {
    expect(validateAnnotation({ type: "text", start: 10, end: 4, quote: "x" })).toBeNull();
    expect(validateAnnotation({ type: "text", start: 10, end: 10, quote: "x" })).toBeNull();
  });

  it("clamps pin coordinates to 0..1", () => {
    expect(validateAnnotation({ type: "pin", x: 1.5, y: -0.2 })).toEqual({
      type: "pin",
      x: 1,
      y: 0,
    });
  });

  it("clamps region coordinates", () => {
    expect(validateAnnotation({ type: "region", x: -1, y: 0.5, w: 2, h: 0.3 })).toEqual({
      type: "region",
      x: 0,
      y: 0.5,
      w: 1,
      h: 0.3,
    });
  });

  it("floors page to at least 1", () => {
    expect(validateAnnotation({ type: "page", page: 0 })).toEqual({ type: "page", page: 1 });
    expect(validateAnnotation({ type: "page", page: 3.9 })).toEqual({ type: "page", page: 3 });
  });

  it("rejects unknown type, non-object, and missing fields", () => {
    expect(validateAnnotation({ type: "blah" })).toBeNull();
    expect(validateAnnotation(null)).toBeNull();
    expect(validateAnnotation("nope")).toBeNull();
    expect(validateAnnotation({ type: "pin", x: "a", y: 0 })).toBeNull();
    expect(validateAnnotation({ type: "region", x: 0, y: 0, w: 0.1 })).toBeNull();
  });
});

describe("text cleaners", () => {
  it("cleanTitle trims and collapses whitespace", () => {
    expect(cleanTitle("  hello    world  ")).toBe("hello world");
  });

  it("cleanTitle caps length", () => {
    expect(cleanTitle("a".repeat(500)).length).toBe(200);
  });

  it("cleanDescription returns null when empty", () => {
    expect(cleanDescription("   ")).toBeNull();
    expect(cleanDescription("note")).toBe("note");
  });

  it("cleanNote returns null when empty", () => {
    expect(cleanNote("")).toBeNull();
    expect(cleanNote("changed the headline")).toBe("changed the headline");
  });

  it("cleanCommentBody collapses runaway blank lines and caps", () => {
    expect(cleanCommentBody("a\n\n\n\nb")).toBe("a\n\nb");
    expect(cleanCommentBody("x".repeat(6000)).length).toBe(5000);
    expect(cleanCommentBody("   ")).toBe("");
  });
});

describe("permissions", () => {
  it("only a lawyer can sign off", () => {
    expect(canSignOff("lawyer")).toBe(true);
    expect(canSignOff("operator")).toBe(false);
    expect(canSignOff("client")).toBe(false);
  });

  it("operator and lawyer can post versions; client cannot", () => {
    expect(canPostVersion("operator")).toBe(true);
    expect(canPostVersion("lawyer")).toBe(true);
    expect(canPostVersion("client")).toBe(false);
  });
});

describe("status machine", () => {
  it("a new version returns the deliverable to review", () => {
    expect(statusAfterNewVersion()).toBe("in_review");
  });

  it("maps a decision to a status", () => {
    expect(statusAfterDecision("approved")).toBe("approved");
    expect(statusAfterDecision("changes_requested")).toBe("changes_requested");
  });
});

describe("misc", () => {
  it("validates content kind", () => {
    expect(isValidContentKind("text")).toBe(true);
    expect(isValidContentKind("image")).toBe(true);
    expect(isValidContentKind("pdf")).toBe(true);
    expect(isValidContentKind("video")).toBe(false);
    expect(isValidContentKind(7)).toBe(false);
  });

  it("labels annotations", () => {
    expect(annotationLabel(null)).toBe("General comment");
    expect(annotationLabel({ type: "text", start: 0, end: 1, quote: "x" })).toBe("On a passage");
    expect(annotationLabel({ type: "pin", x: 0, y: 0 })).toBe("Pinned on the image");
    expect(annotationLabel({ type: "page", page: 2 })).toBe("On page 2");
  });

  it("counts open comments", () => {
    expect(
      openCommentCount([{ resolved: false }, { resolved: true }, { resolved: false }]),
    ).toBe(2);
  });

  it("attestation references LSO Rule 4.2-1", () => {
    expect(APPROVAL_ATTESTATION).toContain("4.2-1");
  });
});
