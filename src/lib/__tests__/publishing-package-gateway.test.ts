/**
 * Pure-core coverage for the Publishing Package Gateway
 * (publishing-package-gateway.ts). Route-level wiring (auth, Supabase I/O,
 * storage writes, receipts) is covered separately in
 * src/app/api/publishing-agent/hero-package/__tests__/route.test.ts --
 * this file exercises the byte-level and identity-level decisions in
 * isolation, matching this codebase's own pure-core/thin-route convention.
 */
import { describe, it, expect } from "vitest";
import {
  sniffHeroPackageMime,
  sha256Hex,
  validateHeroPackageBytes,
  validateHeroPackageDeliverableIdentity,
  heroPackageStoragePath,
  safeHeroPackageFileName,
  HERO_PACKAGE_BUCKET,
  HERO_PACKAGE_MAX_BYTES,
} from "../publishing-package-gateway";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
function webpBytes() {
  const buf = Buffer.alloc(16);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(8, 4);
  buf.write("WEBP", 8, "ascii");
  return buf;
}

describe("sniffHeroPackageMime: bytes-only, never trusts filename or header", () => {
  it("PNG magic bytes -> image/png", () => {
    expect(sniffHeroPackageMime(PNG_MAGIC)).toBe("image/png");
  });
  it("JPEG magic bytes -> image/jpeg (covers both JPG and JPEG, same signature)", () => {
    expect(sniffHeroPackageMime(JPEG_MAGIC)).toBe("image/jpeg");
  });
  it("WebP (RIFF....WEBP) magic bytes -> image/webp", () => {
    expect(sniffHeroPackageMime(webpBytes())).toBe("image/webp");
  });
  it("unsupported bytes (plain text) -> null, regardless of any claimed type", () => {
    expect(sniffHeroPackageMime(Buffer.from("not an image, just text", "utf8"))).toBeNull();
  });
  it("a GIF signature (never allowed by this gateway) -> null", () => {
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(sniffHeroPackageMime(gif)).toBeNull();
  });
  it("bytes named/typed as one image format but actually another sniff as their REAL format, never the claimed one -- this module has no concept of a claimed type at all, so spoofing it changes nothing", () => {
    // PNG bytes, no filename/content-type involved anywhere in this
    // function's signature -- proves the sniff is 100% bytes-driven.
    expect(sniffHeroPackageMime(PNG_MAGIC)).toBe("image/png");
    expect(sniffHeroPackageMime(PNG_MAGIC)).not.toBe("image/jpeg");
  });
  it("too few bytes -> null", () => {
    expect(sniffHeroPackageMime(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

describe("validateHeroPackageBytes", () => {
  it("valid PNG within size, matching hash -> ok", () => {
    const expected = sha256Hex(PNG_MAGIC);
    const result = validateHeroPackageBytes(PNG_MAGIC, expected);
    expect(result.ok).toBe(true);
    expect(result.rejectionReason).toBeNull();
    expect(result.sniffedMime).toBe("image/png");
  });

  it("unsupported MIME -> rejected, unsupported_mime, even with a matching hash", () => {
    const bytes = Buffer.from("just text", "utf8");
    const expected = sha256Hex(bytes);
    const result = validateHeroPackageBytes(bytes, expected);
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("unsupported_mime");
  });

  it("over HERO_PACKAGE_MAX_BYTES -> rejected, too_large, checked before MIME sniffing", () => {
    const big = Buffer.concat([PNG_MAGIC, Buffer.alloc(HERO_PACKAGE_MAX_BYTES)]);
    const result = validateHeroPackageBytes(big, sha256Hex(big));
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("too_large");
    expect(big.length).toBeGreaterThan(HERO_PACKAGE_MAX_BYTES);
  });

  it("SHA-256 mismatch -> rejected, hash_mismatch, even though MIME and size are both fine", () => {
    const result = validateHeroPackageBytes(PNG_MAGIC, "0".repeat(64));
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("hash_mismatch");
    expect(result.sniffedMime).toBe("image/png"); // proves MIME check ran and passed before the hash check failed
  });

  it("computedSha256 is always the real digest of the actual bytes received, never the caller's claim", () => {
    const result = validateHeroPackageBytes(PNG_MAGIC, "0".repeat(64));
    expect(result.computedSha256).toBe(sha256Hex(PNG_MAGIC));
    expect(result.computedSha256).not.toBe("0".repeat(64));
  });

  it("the CORRECT hash in uppercase hex is still rejected as hash_mismatch -- no case normalization, matching the manifest schema's own no-silent-normalization rule", () => {
    const correctHashUppercase = sha256Hex(PNG_MAGIC).toUpperCase();
    const result = validateHeroPackageBytes(PNG_MAGIC, correctHashUppercase);
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("hash_mismatch");
  });
});

describe("validateHeroPackageDeliverableIdentity", () => {
  const base = { firm_id: "f1", status: "approved", locale: "en-CA", content_kind: "text" };
  const expected = { firmId: "f1", deliverableId: "d1", expectedLocale: "en-CA", expectedContentKind: "text" };

  it("deliverable not found (null row) -> rejected, deliverable_not_found", () => {
    const result = validateHeroPackageDeliverableIdentity(null, expected);
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("deliverable_not_found");
  });

  it("wrong firm (deliverable belongs to a different firm than claimed) -> rejected, cross_firm", () => {
    const result = validateHeroPackageDeliverableIdentity({ ...base, id: "d1", firm_id: "OTHER_FIRM" }, expected);
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("cross_firm");
  });

  it("cross-firm deliverable is rejected even when every other field matches exactly", () => {
    const result = validateHeroPackageDeliverableIdentity(
      { ...base, id: "d1", firm_id: "some-other-real-firm" },
      expected,
    );
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("cross_firm");
  });

  it("archived deliverable -> rejected, archived, even though firm/locale/content-kind all match", () => {
    const result = validateHeroPackageDeliverableIdentity({ ...base, id: "d1", status: "archived" }, expected);
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("archived");
  });

  it("wrong locale (deliverable's actual locale differs from expected_locale) -> rejected, locale_mismatch", () => {
    const result = validateHeroPackageDeliverableIdentity({ ...base, id: "d1", locale: "pt-BR" }, expected);
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("locale_mismatch");
  });

  it("wrong content kind (deliverable's actual content_kind differs from expected_content_kind) -> rejected, content_kind_mismatch", () => {
    const result = validateHeroPackageDeliverableIdentity({ ...base, id: "d1", content_kind: "pdf" }, expected);
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("content_kind_mismatch");
  });

  it("every dimension matching exactly -> ok", () => {
    const result = validateHeroPackageDeliverableIdentity({ ...base, id: "d1" }, expected);
    expect(result.ok).toBe(true);
    expect(result.rejectionReason).toBeNull();
  });
});

describe("heroPackageStoragePath: deterministic, never caller-controlled", () => {
  it("always lands under HERO_PACKAGE_BUCKET's deliverables/hero/{firm}/{deliverable}/ prefix -- the established hero-image storage location", () => {
    const path = heroPackageStoragePath({ firmId: "f1", deliverableId: "d1", operationId: "op-1", fileName: "photo.png" });
    expect(path).toBe("deliverables/hero/f1/d1/op-1-photo.png");
    expect(HERO_PACKAGE_BUCKET).toBe("firm-files");
  });

  it("sanitizes the file name -- a caller cannot inject a path traversal or arbitrary path via the filename", () => {
    const path = heroPackageStoragePath({
      firmId: "f1",
      deliverableId: "d1",
      operationId: "op-1",
      fileName: "../../etc/passwd.png",
    });
    // The sanitized name may still contain literal ".." characters (dots
    // and underscores are allowed), but it can never contain a "/" -- so
    // the traversal segments are inert, single-path-component text, never
    // an actual directory escape. The real invariant is "still exactly one
    // path segment under the fixed prefix," not "no dots anywhere."
    const afterPrefix = path.slice("deliverables/hero/f1/d1/op-1-".length);
    expect(afterPrefix).not.toContain("/");
    expect(path.split("/")).toHaveLength(5); // deliverables/hero/f1/d1/<single-file-segment>
    expect(path.startsWith("deliverables/hero/f1/d1/op-1-")).toBe(true);
  });

  it("safeHeroPackageFileName strips everything but alnum/dot/dash/underscore", () => {
    expect(safeHeroPackageFileName("héro image!!.png")).toMatch(/^[a-zA-Z0-9._-]+$/);
  });
});
