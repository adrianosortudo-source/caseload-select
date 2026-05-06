import { describe, it, expect } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  CATEGORY_LABELS,
  FILE_CATEGORIES,
  MAX_FILE_SIZE_BYTES,
  buildStoragePath,
  categoryLabel,
  formatBytes,
  isValidCategory,
  mimeFromFilename,
  sanitizeFilename,
  validateUpload,
} from "../firm-files-pure";

describe("categoryLabel", () => {
  it("returns the human label for known categories", () => {
    for (const c of FILE_CATEGORIES) {
      expect(categoryLabel(c)).toBe(CATEGORY_LABELS[c]);
    }
  });

  it("falls back to Other for null / undefined / blank", () => {
    expect(categoryLabel(null)).toBe("Other");
    expect(categoryLabel(undefined)).toBe("Other");
    expect(categoryLabel("")).toBe("Other");
  });

  it("passes unknown category strings through unchanged", () => {
    expect(categoryLabel("novel")).toBe("novel");
  });
});

describe("isValidCategory", () => {
  it("recognises every documented category", () => {
    for (const c of FILE_CATEGORIES) expect(isValidCategory(c)).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isValidCategory("invoice")).toBe(false);
    expect(isValidCategory("")).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats bytes under 1 KB as integer B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats KB with one decimal under 10 KB, integer above", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(102400)).toBe("100 KB");
  });

  it("formats MB with one decimal under 10 MB, integer above", () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
  });

  it("guards bad inputs", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
  });
});

describe("sanitizeFilename", () => {
  it("strips path separators and dangerous chars", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("etc passwd");
    expect(sanitizeFilename("C:\\Users\\foo\\bar.pdf")).toBe("C Users foo bar.pdf");
    expect(sanitizeFilename("a<b>c|d?.pdf")).toBe("abcd.pdf");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeFilename("   weird   spaces   .pdf   ")).toBe("weird spaces .pdf");
  });

  it("preserves unicode letters", () => {
    expect(sanitizeFilename("Acordo de Honorários.pdf")).toBe("Acordo de Honorários.pdf");
  });

  it("returns 'untitled' for empty input", () => {
    expect(sanitizeFilename("")).toBe("untitled");
    expect(sanitizeFilename("   ")).toBe("untitled");
    expect(sanitizeFilename("/")).toBe("untitled");
  });

  it("caps long names at 200 chars", () => {
    const long = "a".repeat(300) + ".pdf";
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200);
  });
});

describe("buildStoragePath", () => {
  it("interleaves firm + file id and sanitised filename", () => {
    const path = buildStoragePath({
      firmId: "1f5a2391-85d8-45a2-b427-90441e78a93c",
      fileId: "00000000-0000-0000-0000-000000000001",
      filename: "Q2 Report.pdf",
    });
    expect(path).toBe(
      "firms/1f5a2391-85d8-45a2-b427-90441e78a93c/00000000-0000-0000-0000-000000000001/Q2 Report.pdf",
    );
  });

  it("sanitises path-traversal attempts in the filename", () => {
    const path = buildStoragePath({
      firmId: "firm-1",
      fileId: "file-1",
      filename: "../escape.pdf",
    });
    expect(path).toBe("firms/firm-1/file-1/escape.pdf");
  });
});

describe("mimeFromFilename", () => {
  it("maps common extensions", () => {
    expect(mimeFromFilename("contract.pdf")).toBe("application/pdf");
    expect(mimeFromFilename("DOC.DOCX")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mimeFromFilename("photo.jpg")).toBe("image/jpeg");
  });

  it("returns null for unknown / missing extensions", () => {
    expect(mimeFromFilename("noext")).toBeNull();
    expect(mimeFromFilename("file.zip")).toBeNull();
  });
});

describe("validateUpload", () => {
  const baseInput = {
    filename: "Q2 Report.pdf",
    category: "report",
    size: 1024,
    mimeType: "application/pdf",
  };

  it("accepts a clean PDF upload", () => {
    const v = validateUpload(baseInput);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.filename).toBe("Q2 Report.pdf");
      expect(v.category).toBe("report");
      expect(v.resolvedMime).toBe("application/pdf");
      expect(ALLOWED_MIME_TYPES.has(v.resolvedMime)).toBe(true);
    }
  });

  it("rejects missing filename", () => {
    const v = validateUpload({ ...baseInput, filename: "   " });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("missing_filename");
  });

  it("rejects missing or invalid category", () => {
    expect(validateUpload({ ...baseInput, category: "" }).ok).toBe(false);
    const v = validateUpload({ ...baseInput, category: "invoice" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("invalid_category");
  });

  it("rejects empty file", () => {
    const v = validateUpload({ ...baseInput, size: 0 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("missing_file");
  });

  it("rejects oversize files", () => {
    const v = validateUpload({ ...baseInput, size: MAX_FILE_SIZE_BYTES + 1 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("size_exceeded");
  });

  it("falls back to extension when mime is empty", () => {
    const v = validateUpload({ ...baseInput, mimeType: "" });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.resolvedMime).toBe("application/pdf");
  });

  it("rejects disallowed mimes regardless of extension trick", () => {
    const v = validateUpload({
      ...baseInput,
      filename: "trojan.exe",
      mimeType: "application/x-msdownload",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("unsupported_mime");
  });
});
