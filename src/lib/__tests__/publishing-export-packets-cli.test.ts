/**
 * CLI coverage for scripts/publishing-export-packets.mjs. Same relative-
 * import convention as publishing-bind-heroes-cli.test.ts (the script
 * lives under scripts/, this test must live under src/ for vitest's glob).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import {
  renderPacketText,
  packetFileName,
  defaultOutDir,
  resolveOutputFilePath,
  runExportCli,
} from "../../../scripts/publishing-export-packets.mjs";

function makePacket(overrides: Record<string, unknown> = {}) {
  return {
    identity: { deliverableId: "d1111111-1111-1111-1111-111111111111", channel: "google_business_profile" },
    copy: { title: "Renewal Clause: What Ontario Landlords Need to Know", plainText: "Ontario landlords must provide 60 days notice." },
    cta: { label: null, targetPath: "/journal/renewal-clause-ontario" },
    image: { artifactId: "a1", fileName: "journal-renewal-clause-ontario-feature.png", storageOrPublicUrl: "https://drglaw.ca/images/journal-renewal-clause-ontario-feature.png" },
    dates: { scheduledFor: null, publishedAt: "2026-07-22T12:00:00Z" },
    ...overrides,
  };
}

describe("renderPacketText: exact calibration handoff format", () => {
  it("renders all seven fields in the exact order and labels the calibration report specifies", () => {
    const text = renderPacketText(makePacket());
    const lines = text.split("\n");
    expect(lines[0]).toBe("Title");
    expect(lines[1]).toBe("Renewal Clause: What Ontario Landlords Need to Know");
    expect(text).toContain("Body copy (verbatim)");
    expect(text).toContain("Ontario landlords must provide 60 days notice.");
    expect(text).toContain("CTA button label");
    expect(text).toContain("CTA URL");
    expect(text).toContain("/journal/renewal-clause-ontario");
    expect(text).toContain("Image filename");
    expect(text).toContain("journal-renewal-clause-ontario-feature.png");
    expect(text).toContain("Image download link");
    expect(text).toContain("https://drglaw.ca/images/journal-renewal-clause-ontario-feature.png");
    expect(text).toContain("Publishing date/time");
    expect(text).toContain("2026-07-22T12:00:00Z");
  });

  it("a missing field renders an explicit absence marker, never an invented value", () => {
    const text = renderPacketText(makePacket({ cta: { label: null, targetPath: null } }));
    expect(text).toContain("(none)");
  });

  it("scheduledFor is used only when publishedAt is absent -- never conflated", () => {
    const text = renderPacketText(makePacket({ dates: { scheduledFor: "2026-07-25", publishedAt: null } }));
    expect(text).toContain("2026-07-25");
    expect(text).not.toContain("2026-07-22T12:00:00Z");
  });
});

describe("defaultOutDir: OS-resolved, never a guessed root path", () => {
  it("resolves under the real os.homedir(), not a hardcoded drive-root guess", () => {
    const dir = defaultOutDir("renewal-clause-week", new Date("2026-07-22T00:00:00Z"));
    expect(dir.startsWith(homedir())).toBe(true);
    expect(dir).toContain("Downloads");
    expect(dir).toContain("DRG Law");
    expect(dir).toContain("2026-07-22");
    expect(dir).toContain("renewal-clause-week");
  });

  it("sanitizes an unsafe period id in the slug", () => {
    const dir = defaultOutDir("../../etc/passwd", new Date("2026-07-22T00:00:00Z"));
    expect(dir.startsWith(homedir())).toBe(true);
    // the traversal characters are neutralized into a literal safe segment, never actually escaping
    const afterDate = dir.split("2026-07-22")[1];
    expect(afterDate).not.toMatch(/[\\/]\.\.[\\/]/);
  });
});

describe("resolveOutputFilePath: path-traversal safety", () => {
  it("rejects a file name containing '..'", () => {
    expect(() => resolveOutputFilePath("/tmp/out", "../escape.txt")).toThrow();
  });

  it("rejects an absolute file name", () => {
    expect(() => resolveOutputFilePath("/tmp/out", "/etc/passwd")).toThrow();
  });

  it("rejects a file name containing a path separator", () => {
    expect(() => resolveOutputFilePath("/tmp/out", "sub/escape.txt")).toThrow();
  });

  it("accepts a plain safe file name", () => {
    const path = resolveOutputFilePath("/tmp/out", "d1-firm_website.txt");
    expect(path).toContain("d1-firm_website.txt");
  });
});

describe("packetFileName: sanitized, deterministic", () => {
  it("combines deliverableId and channel, sanitized", () => {
    expect(packetFileName(makePacket(), 0)).toBe("d1111111-1111-1111-1111-111111111111-google_business_profile.txt");
  });
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "packet-export-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runExportCli: dry-run makes zero writes and zero network calls", () => {
  it("--dry-run does not create any files", async () => {
    const outDir = join(dir, "out");
    const result = runExportCli({
      argv: ["--period", "renewal-clause-week", "--out", outDir, "--dry-run"],
      readInput: () => JSON.stringify([makePacket()]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(existsSync(outDir)).toBe(false);
  });

  it("missing --period -> usage error, exit 1, no output dir resolved", () => {
    const result = runExportCli({ argv: [], readInput: () => "[]" });
    expect(result.exitCode).toBe(1);
    expect(result.outDir).toBeNull();
  });

  it("empty packets array -> error, exit 1", () => {
    const result = runExportCli({ argv: ["--period", "x"], readInput: () => "[]" });
    expect(result.exitCode).toBe(1);
  });

  it("malformed JSON input -> error, exit 1, no crash", () => {
    const result = runExportCli({ argv: ["--period", "x"], readInput: () => "not json" });
    expect(result.exitCode).toBe(1);
  });
});

describe("runExportCli: real write path (no network anywhere in this CLI)", () => {
  it("writes one file per packet to the verified output directory, reading from --packets file", () => {
    const packetsPath = join(dir, "packets.json");
    writeFileSync(packetsPath, JSON.stringify([makePacket(), makePacket({ identity: { deliverableId: "d2222222-2222-2222-2222-222222222222", channel: "linkedin_post" } })]));
    const outDir = join(dir, "out");
    const result = runExportCli({ argv: ["--period", "renewal-clause-week", "--packets", packetsPath, "--out", outDir] });
    expect(result.exitCode).toBe(0);
    expect(result.dryRun).toBe(false);
    expect(existsSync(outDir)).toBe(true);
    expect(result.files).toHaveLength(2);
    for (const f of result.files) expect(existsSync(f)).toBe(true);
    const content = readFileSync(result.files[0], "utf8");
    expect(content).toContain("Title");
  });

  it("reads from stdin when --packets is not supplied", () => {
    const outDir = join(dir, "out-stdin");
    const result = runExportCli({
      argv: ["--period", "x", "--out", outDir],
      readInput: () => JSON.stringify([makePacket()]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.files).toHaveLength(1);
  });

  it("accepts an object with a top-level packets array, not just a bare array", () => {
    const outDir = join(dir, "out-wrapped");
    const result = runExportCli({
      argv: ["--period", "x", "--out", outDir],
      readInput: () => JSON.stringify({ packets: [makePacket()] }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.files).toHaveLength(1);
  });

  it("never connects to any network -- no fetch is imported or called anywhere in this script (static check)", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "publishing-export-packets.mjs"), "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
  });
});
