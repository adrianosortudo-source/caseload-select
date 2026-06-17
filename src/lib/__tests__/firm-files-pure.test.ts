import { describe, it, expect } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  CATEGORY_LABELS,
  FILE_CATEGORIES,
  FILE_SECTIONS,
  SECTION_LABELS,
  MAX_FILE_SIZE_BYTES,
  MAX_EXTERNAL_URL_LEN,
  buildStoragePath,
  categoryLabel,
  cleanLinkTitle,
  fileTypeLabel,
  formatBytes,
  isValidCategory,
  isValidKind,
  isValidSection,
  mimeFromFilename,
  sanitizeFilename,
  sectionLabel,
  validateExternalUrl,
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

describe("sections", () => {
  it("labels every documented section", () => {
    for (const s of FILE_SECTIONS) {
      expect(sectionLabel(s)).toBe(SECTION_LABELS[s]);
    }
  });

  it("falls back to Admin for null / undefined / blank", () => {
    expect(sectionLabel(null)).toBe("Admin");
    expect(sectionLabel(undefined)).toBe("Admin");
    expect(sectionLabel("")).toBe("Admin");
  });

  it("passes unknown section strings through unchanged", () => {
    expect(sectionLabel("mystery")).toBe("mystery");
  });

  it("isValidSection recognises documented sections and rejects others", () => {
    for (const s of FILE_SECTIONS) expect(isValidSection(s)).toBe(true);
    expect(isValidSection("brand")).toBe(true);
    expect(isValidSection("contract")).toBe(false);
    expect(isValidSection("")).toBe(false);
  });
});

describe("isValidKind", () => {
  it("accepts file and link only", () => {
    expect(isValidKind("file")).toBe(true);
    expect(isValidKind("link")).toBe(true);
    expect(isValidKind("folder")).toBe(false);
    expect(isValidKind("")).toBe(false);
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

describe("MAX_FILE_SIZE_BYTES", () => {
  it("is 100 MB", () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(100 * 1024 * 1024);
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
    section: "reports",
    size: 1024,
    mimeType: "application/pdf",
  };

  it("accepts a clean PDF upload", () => {
    const v = validateUpload(baseInput);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.filename).toBe("Q2 Report.pdf");
      expect(v.section).toBe("reports");
      expect(v.resolvedMime).toBe("application/pdf");
      expect(ALLOWED_MIME_TYPES.has(v.resolvedMime)).toBe(true);
    }
  });

  it("rejects missing filename", () => {
    const v = validateUpload({ ...baseInput, filename: "   " });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("missing_filename");
  });

  it("rejects missing or invalid section", () => {
    expect(validateUpload({ ...baseInput, section: "" }).ok).toBe(false);
    const v = validateUpload({ ...baseInput, section: "invoice" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("invalid_section");
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

describe("validateExternalUrl", () => {
  it("accepts an https URL and normalises it", () => {
    const v = validateExternalUrl("https://example.com/deck");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.url).toBe("https://example.com/deck");
  });

  it("rejects a blank URL", () => {
    const v = validateExternalUrl("   ");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("missing_url");
  });

  it("rejects non-https schemes", () => {
    const http = validateExternalUrl("http://example.com");
    expect(http.ok).toBe(false);
    if (!http.ok) expect(http.reason).toBe("invalid_url");

    const ftp = validateExternalUrl("ftp://example.com/x");
    expect(ftp.ok).toBe(false);
  });

  it("rejects garbage", () => {
    const v = validateExternalUrl("not a url");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("invalid_url");
  });

  it("rejects overlong URLs", () => {
    const long = "https://example.com/" + "a".repeat(MAX_EXTERNAL_URL_LEN);
    const v = validateExternalUrl(long);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("url_too_long");
  });
});

describe("cleanLinkTitle", () => {
  it("trims and collapses a provided title", () => {
    expect(cleanLinkTitle("  Brand   Book  ", "https://x.com")).toBe("Brand Book");
  });

  it("falls back to the URL host when the title is blank", () => {
    expect(cleanLinkTitle("", "https://deck.example.com/strategy")).toBe("deck.example.com");
    expect(cleanLinkTitle(null, "https://deck.example.com/strategy")).toBe("deck.example.com");
  });

  it("falls back to a sentinel when both title and URL are unusable", () => {
    expect(cleanLinkTitle("", "not a url")).toBe("untitled link");
  });

  it("caps long titles at 200 chars", () => {
    expect(cleanLinkTitle("a".repeat(300), "https://x.com").length).toBeLessThanOrEqual(200);
  });
});

describe("fileTypeLabel", () => {
  it("labels a link", () => {
    expect(fileTypeLabel({ kind: "link", mimeType: null, displayName: "Brand book" })).toBe("LINK");
  });

  it("labels common file mimes", () => {
    expect(fileTypeLabel({ kind: "file", mimeType: "application/pdf", displayName: "a.pdf" })).toBe("PDF");
    expect(
      fileTypeLabel({
        kind: "file",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        displayName: "a.xlsx",
      }),
    ).toBe("XLSX");
    expect(fileTypeLabel({ kind: "file", mimeType: "text/csv", displayName: "a.csv" })).toBe("CSV");
    expect(
      fileTypeLabel({
        kind: "file",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        displayName: "a.docx",
      }),
    ).toBe("DOCX");
    expect(
      fileTypeLabel({
        kind: "file",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        displayName: "a.pptx",
      }),
    ).toBe("PPTX");
    expect(fileTypeLabel({ kind: "file", mimeType: "image/jpeg", displayName: "a.jpg" })).toBe("IMG");
  });

  it("falls back to the filename extension, then FILE", () => {
    expect(fileTypeLabel({ kind: "file", mimeType: null, displayName: "weird.heic" })).toBe("HEIC");
    expect(fileTypeLabel({ kind: "file", mimeType: null, displayName: "noext" })).toBe("FILE");
  });
});
