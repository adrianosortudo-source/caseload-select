import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateScreenPublicBuild } from "../../../scripts/screen-public-build.mjs";

const roots: string[] = [];
function fixture() {
  const parent = resolve(process.cwd(), "test-results", "screen-artifact");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "manifest-"));
  roots.push(root);
  const html = '<script type="module" src="/screen-demo-app/assets/main.js"></script>';
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "public", "screen-demo-app"), { recursive: true });
  writeFileSync(join(root, "public", "screen-demo-app", "index.html"), html);
  const manifest = {
    schemaVersion: "screen-public-build-v1",
    canonicalPath: "/tools/screen",
    assetBase: "/screen-demo-app/",
    sourceRepository: "adrianosortudo-source/caseload-screen-sandbox",
    sourceCommit: "a".repeat(40),
    files: [{ path: "index.html", sha256: createHash("sha256").update(html).digest("hex") }],
  };
  const save = () => writeFileSync(join(root, "config", "screen-public-build.manifest.json"), JSON.stringify(manifest));
  save();
  return { root, manifest, save };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const rel = relative(resolve(process.cwd(), "test-results", "screen-artifact"), root);
    if (!rel || rel.startsWith("..")) throw new Error("Unexpected test fixture cleanup path.");
    rmSync(root, { recursive: true, force: true });
  }
});
describe("canonical SCREEN artifact", () => {
  it("accepts a bound source commit and unchanged generated entry", () => {
    expect(validateScreenPublicBuild(fixture().root)).toEqual([]);
  });
  it("rejects a changed asset even when its filename is unchanged", () => {
    const { root } = fixture();
    writeFileSync(join(root, "public", "screen-demo-app", "index.html"), "stale build");
    expect(validateScreenPublicBuild(root)).toContain("SCREEN asset hash mismatch: index.html");
  });
  it("rejects a surprise file in the generated public directory", () => {
    const { root } = fixture();
    writeFileSync(join(root, "public", "screen-demo-app", "unexpected.html"), "unreviewed");
    expect(validateScreenPublicBuild(root)).toContain("Untracked generated SCREEN asset: unexpected.html");
  });
  it("rejects traversal paths before reading outside the artifact", () => {
    const { root, manifest, save } = fixture();
    manifest.files = [{ path: "../../private", sha256: "" }];
    save();
    expect(validateScreenPublicBuild(root)).toContain("SCREEN manifest contains an unsafe asset path.");
  });
});
