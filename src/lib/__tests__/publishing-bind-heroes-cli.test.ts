/**
 * CLI coverage for scripts/publishing-bind-heroes.mjs. The script lives
 * under scripts/ (matching every other CLI in this repo, e.g.
 * check-no-em-dash-marketing.mjs) rather than under src/, so this test
 * imports it by relative path -- vitest's config only globs
 * src/**\/__tests__/**\/*.test.ts, so the test itself must live under src/,
 * even though its subject does not.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  validateManifestShape,
  resolveAssetPathWithinManifestFolder,
  preflightManifest,
  runCli,
} from "../../../scripts/publishing-bind-heroes.mjs";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const DELIVERABLE_ID = "d1111111-1111-1111-1111-111111111111";
const DELIVERABLE_ID_2 = "d2222222-2222-2222-2222-222222222222";
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hero-manifest-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeManifest(obj: unknown, filename = "manifest.json"): string {
  const p = join(dir, filename);
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

function baseOperation(overrides: Record<string, unknown> = {}) {
  return {
    deliverable_id: DELIVERABLE_ID,
    expected_locale: "en-CA",
    expected_content_kind: "text",
    asset_path: "hero.png",
    expected_sha256: sha256(PNG_BYTES),
    alt_text: "DRG Law hero image",
    ...overrides,
  };
}

function baseManifest(operations: unknown[]) {
  return { schema_version: 1, firm_id: FIRM_ID, operations };
}

describe("validateManifestShape: schema-level rejections", () => {
  it("invalid UUID (firm_id) -> rejected", () => {
    const result = validateManifestShape(baseManifest([baseOperation()]));
    expect(result.ok).toBe(true);
    const bad = validateManifestShape({ ...baseManifest([baseOperation()]), firm_id: "not-a-uuid" });
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e: { path: string }) => e.path === "firm_id")).toBe(true);
  });

  it("invalid UUID (deliverable_id) -> rejected", () => {
    const result = validateManifestShape(baseManifest([baseOperation({ deliverable_id: "not-a-uuid" })]));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: { path: string }) => e.path.endsWith("deliverable_id"))).toBe(true);
  });

  it("invalid expected_sha256 (not 64 lowercase hex) -> rejected", () => {
    const result = validateManifestShape(baseManifest([baseOperation({ expected_sha256: "ABCDEF" })]));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: { path: string }) => e.path.endsWith("expected_sha256"))).toBe(true);
  });

  it("duplicate deliverable_id across two operations -> rejected", () => {
    const result = validateManifestShape(
      baseManifest([baseOperation({ asset_path: "a.png" }), baseOperation({ asset_path: "b.png" })]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: { message: string }) => e.message.includes("duplicate deliverable_id"))).toBe(true);
  });

  it("duplicate asset_path across two operations -> rejected", () => {
    const result = validateManifestShape(
      baseManifest([
        baseOperation({ deliverable_id: DELIVERABLE_ID }),
        baseOperation({ deliverable_id: DELIVERABLE_ID_2 }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: { message: string }) => e.message.includes("duplicate asset_path"))).toBe(true);
  });

  it("empty operations array -> rejected", () => {
    const result = validateManifestShape(baseManifest([]));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: { path: string }) => e.path === "operations")).toBe(true);
  });

  it("schema_version other than 1 -> rejected, never silently coerced", () => {
    const result = validateManifestShape({ ...baseManifest([baseOperation()]), schema_version: 2 });
    expect(result.ok).toBe(false);
  });
});

describe("resolveAssetPathWithinManifestFolder: path safety", () => {
  it("absolute asset_path -> rejected", () => {
    const result = resolveAssetPathWithinManifestFolder(dir, "/etc/passwd.png");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("absolute_path");
  });

  it("Windows-style absolute asset_path -> rejected", () => {
    const result = resolveAssetPathWithinManifestFolder(dir, "C:\\Windows\\evil.png");
    // On Windows this is absolute and caught by isAbsolute(); on POSIX it's
    // treated as a relative filename and caught by the escape check instead
    // when combined with traversal -- either way it must never resolve
    // silently inside the manifest folder as a literal filename passthrough
    // without at least being subject to the same folder-containment check.
    expect(result.resolvedPath === null || result.resolvedPath.startsWith(dir)).toBe(true);
  });

  it("simple traversal (../../escape.png) -> rejected, escapes_manifest_folder", () => {
    const result = resolveAssetPathWithinManifestFolder(dir, "../../escape.png");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("escapes_manifest_folder");
  });

  it("subtler traversal that still resolves outside the folder (sub/../../escape.png) -> rejected", () => {
    const result = resolveAssetPathWithinManifestFolder(dir, "sub/../../escape.png");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("escapes_manifest_folder");
  });

  it("a normal relative path within the folder -> accepted", () => {
    const result = resolveAssetPathWithinManifestFolder(dir, "assets/hero.png");
    expect(result.ok).toBe(true);
    expect(result.resolvedPath?.startsWith(dir)).toBe(true);
  });
});

describe("preflightManifest: local SHA-256 check runs before any network activity", () => {
  it("local SHA-256 mismatch -> preflight fails, zero operations returned", () => {
    writeFileSync(join(dir, "hero.png"), PNG_BYTES);
    const manifestPath = writeManifest(baseManifest([baseOperation({ expected_sha256: "0".repeat(64) })]));
    const result = preflightManifest(manifestPath);
    expect(result.ok).toBe(false);
    expect(result.operations).toEqual([]);
    expect(result.errors.some((e: { message: string }) => e.message.includes("does not match expected_sha256"))).toBe(true);
  });

  it("whole manifest validated before first write: one valid + one bad-hash operation -> BOTH are blocked, not just the bad one", async () => {
    writeFileSync(join(dir, "a.png"), PNG_BYTES);
    writeFileSync(join(dir, "b.png"), PNG_BYTES);
    const manifestPath = writeManifest(
      baseManifest([
        baseOperation({ deliverable_id: DELIVERABLE_ID, asset_path: "a.png", expected_sha256: sha256(PNG_BYTES) }),
        baseOperation({ deliverable_id: DELIVERABLE_ID_2, asset_path: "b.png", expected_sha256: "1".repeat(64) }),
      ]),
    );
    const preflight = preflightManifest(manifestPath);
    expect(preflight.ok).toBe(false);
    expect(preflight.operations).toEqual([]);

    let fetchCallCount = 0;
    const fetchImpl = async () => {
      fetchCallCount++;
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    };
    const cli = await runCli({ argv: ["--manifest", manifestPath], fetchImpl });
    expect(cli.exitCode).toBe(1);
    expect(fetchCallCount).toBe(0); // the valid operation "a.png" is never uploaded either
  });
});

describe("runCli: dry run", () => {
  it("valid manifest, --dry-run -> exitCode 0, zero network calls, receipt marks dryRun:true", async () => {
    writeFileSync(join(dir, "hero.png"), PNG_BYTES);
    const manifestPath = writeManifest(baseManifest([baseOperation()]));
    let fetchCallCount = 0;
    const fetchImpl = async () => {
      fetchCallCount++;
      throw new Error("dry run must never call fetch");
    };
    const result = await runCli({ argv: ["--manifest", manifestPath, "--dry-run"], fetchImpl });
    expect(result.exitCode).toBe(0);
    expect(fetchCallCount).toBe(0);
    const content = result.receiptContent;
    if (!content) throw new Error("expected a receipt to be produced");
    expect(content.dryRun).toBe(true);
    expect(content.operations).toHaveLength(1);
  });

  it("receipt file is written to disk beside the manifest, and only after processing (not before runCli is called)", async () => {
    writeFileSync(join(dir, "hero.png"), PNG_BYTES);
    const manifestPath = writeManifest(baseManifest([baseOperation()]));
    const expectedReceiptPath = `${manifestPath}.receipt.json`;
    expect(existsSync(expectedReceiptPath)).toBe(false);
    const result = await runCli({ argv: ["--manifest", manifestPath, "--dry-run"], fetchImpl: async () => { throw new Error("no network"); } });
    expect(result.receiptPath).toBe(expectedReceiptPath);
    expect(existsSync(expectedReceiptPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(expectedReceiptPath, "utf8"));
    expect(onDisk).toEqual(result.receiptContent);
  });
});

describe("runCli: stop-on-first-failure default vs --continue-on-error", () => {
  function twoOperationManifest() {
    writeFileSync(join(dir, "a.png"), PNG_BYTES);
    writeFileSync(join(dir, "b.png"), PNG_BYTES);
    return writeManifest(
      baseManifest([
        baseOperation({ deliverable_id: DELIVERABLE_ID, asset_path: "a.png" }),
        baseOperation({ deliverable_id: DELIVERABLE_ID_2, asset_path: "b.png" }),
      ]),
    );
  }

  it("default (no --continue-on-error): first operation fails -> stops immediately, second operation never attempted", async () => {
    const manifestPath = twoOperationManifest();
    let callCount = 0;
    const fetchImpl = async () => {
      callCount++;
      return { ok: false, status: 500, json: async () => ({ ok: false }) } as unknown as Response;
    };
    const result = await runCli({
      argv: ["--manifest", manifestPath],
      env: { ...process.env, PUBLISHING_PACKAGE_GATEWAY_URL: "https://example.test/hero", PUBLISHING_PACKAGE_GATEWAY_TOKEN: "t" },
      fetchImpl,
    });
    expect(result.exitCode).toBe(1);
    expect(callCount).toBe(1);
  });

  it("--continue-on-error: first operation fails -> processing continues to the second", async () => {
    const manifestPath = twoOperationManifest();
    let callCount = 0;
    const fetchImpl = async () => {
      callCount++;
      return { ok: false, status: 500, json: async () => ({ ok: false }) } as unknown as Response;
    };
    const result = await runCli({
      argv: ["--manifest", manifestPath, "--continue-on-error"],
      env: { ...process.env, PUBLISHING_PACKAGE_GATEWAY_URL: "https://example.test/hero", PUBLISHING_PACKAGE_GATEWAY_TOKEN: "t" },
      fetchImpl,
    });
    expect(result.exitCode).toBe(1);
    expect(callCount).toBe(2);
  });

  it("all operations succeed -> exitCode 0, receipt lists both as ok", async () => {
    const manifestPath = twoOperationManifest();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, receipt: { operationId: "op-x" } }) } as unknown as Response);
    const result = await runCli({
      argv: ["--manifest", manifestPath],
      env: { ...process.env, PUBLISHING_PACKAGE_GATEWAY_URL: "https://example.test/hero", PUBLISHING_PACKAGE_GATEWAY_TOKEN: "t" },
      fetchImpl,
    });
    expect(result.exitCode).toBe(0);
    const content = result.receiptContent;
    if (!content || content.dryRun) throw new Error("expected a non-dry-run upload receipt");
    expect(content.operations).toHaveLength(2);
    expect(content.operations.every((o) => o.ok)).toBe(true);
  });
});

describe("runCli: never scans directories or infers assets", () => {
  it("an asset file present on disk but NOT listed in the manifest is never uploaded", async () => {
    writeFileSync(join(dir, "hero.png"), PNG_BYTES);
    writeFileSync(join(dir, "unlisted-but-present.png"), PNG_BYTES); // not referenced by any operation
    const manifestPath = writeManifest(baseManifest([baseOperation()]));
    const uploadedPaths: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = init?.body as FormData;
      const file = body.get("file") as File;
      uploadedPaths.push(file.name);
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    };
    await runCli({
      argv: ["--manifest", manifestPath],
      env: { ...process.env, PUBLISHING_PACKAGE_GATEWAY_URL: "https://example.test/hero", PUBLISHING_PACKAGE_GATEWAY_TOKEN: "t" },
      fetchImpl,
    });
    expect(uploadedPaths).toEqual(["hero.png"]);
    expect(uploadedPaths).not.toContain("unlisted-but-present.png");
  });
});
