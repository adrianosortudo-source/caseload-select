/**
 * Static source-scan regression test for Operator Support Preview
 * (DR-084 completion). Every listed client-facing mutation route must
 * import denyWriteIfPreview and call it once per mutating handler,
 * before that handler's write logic. The two standing-authorization
 * routes additionally must call the guard BEFORE getFirmSession
 * (guard-first: the support-preview contract must win even though these
 * routes are already lawyer-only).
 *
 * Enumeration is an explicit fixed list, not a directory sweep: several
 * of these files also export a GET handler that must NOT be guarded
 * (reads stay readable during preview), so a generic per-file handler
 * count would false-positive. The expected count is validated against
 * the number of mutating handlers actually present.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const API_DIR = path.join(process.cwd(), "src", "app", "api", "portal", "[firmId]");

function read(relFile: string): string {
  return fs.readFileSync(path.join(API_DIR, relFile), "utf8");
}

/** relFile -> expected number of denyWriteIfPreview call sites. */
const GUARDED_ROUTES: Array<[string, number]> = [
  // G1 -- already guarded at the DR-084 baseline, verified not edited.
  ["deliverables/route.ts", 1],
  ["deliverables/[deliverableId]/route.ts", 1],
  ["deliverables/[deliverableId]/versions/route.ts", 1],
  ["deliverables/[deliverableId]/approve/route.ts", 1],
  ["deliverables/[deliverableId]/comments/route.ts", 1],
  ["deliverables/[deliverableId]/comments/[commentId]/route.ts", 1],
  ["deliverables/[deliverableId]/attachments/route.ts", 1],
  ["deliverables/[deliverableId]/hero/route.ts", 1],
  ["deliverables/notify-pending/route.ts", 1],
  // G2 -- added this session: publication/placement, notifications
  // (individual-review), firm settings, standing authorization.
  ["deliverables/[deliverableId]/placements/route.ts", 1],
  ["deliverables/[deliverableId]/placements/[placementId]/claim/route.ts", 1],
  ["deliverables/[deliverableId]/placements/[placementId]/receipts/route.ts", 1],
  [
    "deliverables/[deliverableId]/placements/[placementId]/receipts/[receiptId]/verify/route.ts",
    1,
  ],
  ["deliverables/[deliverableId]/versions/[versionId]/individual-review/route.ts", 1],
  ["periods/route.ts", 1],
  ["periods/[periodId]/route.ts", 2], // PATCH + DELETE
  ["periods/[periodId]/activate-readiness/route.ts", 1],
  ["periods/[periodId]/deactivate-readiness/route.ts", 1],
  ["about/route.ts", 1],
  ["content-plan-settings/route.ts", 1],
  ["standing-authorization/enable/route.ts", 1],
  ["standing-authorization/disable/route.ts", 1],
  // G3 -- getPortalSession-pattern routes that admit an operator session.
  ["files/route.ts", 1],
  ["files/[fileId]/route.ts", 1],
  ["boards/route.ts", 1],
  ["triage/[leadId]/take/route.ts", 1],
  ["triage/[leadId]/pass/route.ts", 1],
  ["triage/[leadId]/refer/route.ts", 1],
];

describe("support-preview write-guard coverage", () => {
  it("covers 28 mutation routes (sweep sanity check)", () => {
    expect(GUARDED_ROUTES.length).toBe(28);
  });

  it.each(GUARDED_ROUTES)("%s imports denyWriteIfPreview from @/lib/preview-guard", (relFile) => {
    const src = read(relFile);
    expect(
      src.includes('from "@/lib/preview-guard"') || src.includes("from '@/lib/preview-guard'"),
      `${relFile} must import denyWriteIfPreview from @/lib/preview-guard`,
    ).toBe(true);
  });

  it.each(GUARDED_ROUTES)("%s calls the guard the expected number of times", (relFile, expectedCalls) => {
    const src = read(relFile);
    const calls = src.match(/await\s+denyWriteIfPreview\(/g)?.length ?? 0;
    expect(
      calls,
      `${relFile} expected ${expectedCalls} denyWriteIfPreview call(s), found ${calls}`,
    ).toBe(expectedCalls);
  });
});

describe("support-preview write-guard: guard-first exception", () => {
  const guardFirstFiles = [
    "standing-authorization/enable/route.ts",
    "standing-authorization/disable/route.ts",
  ];

  it.each(guardFirstFiles)(
    "%s calls denyWriteIfPreview before getFirmSession",
    (relFile) => {
      const src = read(relFile);
      const guardIndex = src.indexOf("await denyWriteIfPreview(");
      const sessionIndex = src.indexOf("await getFirmSession(");
      expect(guardIndex, `${relFile} does not call denyWriteIfPreview`).toBeGreaterThan(-1);
      expect(sessionIndex, `${relFile} does not call getFirmSession`).toBeGreaterThan(-1);
      expect(
        guardIndex,
        `${relFile}: denyWriteIfPreview must run before getFirmSession so the support-preview contract wins even if session admission ever widens`,
      ).toBeLessThan(sessionIndex);
    },
  );
});

describe("support-preview write-guard: reads stay unguarded", () => {
  it("GET handlers on partially-guarded files are not gated (reads remain readable in preview)", () => {
    const filesReadOnly = read("deliverables/[deliverableId]/placements/route.ts");
    const getMatch = filesReadOnly.match(/export async function GET\(([\s\S]*?)\n\}/);
    expect(getMatch, "placements/route.ts must still export GET").not.toBeNull();
    expect(getMatch![1]).not.toContain("denyWriteIfPreview");
  });
});

describe("support-preview render binding: portal layout terminates cross-firm previews", () => {
  const layoutSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "portal", "[firmId]", "layout.tsx"),
    "utf8",
  );

  it("resolves the preview against the URL firm via resolvePreviewForFirm", () => {
    expect(layoutSrc).toContain("resolvePreviewForFirm(preview, firmId)");
  });

  it("redirects a mismatched preview to the exit route instead of rendering", () => {
    expect(layoutSrc).toMatch(
      /resolvePreviewForFirm\(preview, firmId\) === "mismatch"[\s\S]{0,200}redirect\(`\/api\/portal\/\$\{firmId\}\/preview\/exit`\)/,
    );
  });

  it("terminates the mismatch before computing any preview render state", () => {
    const mismatchIdx = layoutSrc.indexOf('"mismatch"');
    const lawyerPreviewIdx = layoutSrc.indexOf("isLawyerPreview");
    expect(mismatchIdx).toBeGreaterThan(-1);
    expect(mismatchIdx).toBeLessThan(lawyerPreviewIdx);
  });
});
