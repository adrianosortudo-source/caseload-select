import { describe, expect, it } from "vitest";
import { findForbiddenReferences, validateBuildAssets } from "../../../scripts/check-self-contained-build-assets.mjs";

const remoteFontImport = ["next", "/font/google"].join("");
const remoteStylesheetHost = ["fonts", ".googleapis.com"].join("");

describe("self-contained build assets", () => {
  it("accepts the repository's pinned local build assets", () => {
    expect(validateBuildAssets(process.cwd())).toEqual([]);
  });

  it("rejects a remote font module import", () => {
    expect(findForbiddenReferences(
      [{ path: "src/example.ts", text: `import x from "${remoteFontImport}"` }],
      [remoteFontImport],
    )).toEqual([`src/example.ts: forbidden remote build dependency reference: ${remoteFontImport}`]);
  });

  it("rejects a remote font stylesheet", () => {
    expect(findForbiddenReferences(
      [{ path: "src/example.css", text: `@import url("https://${remoteStylesheetHost}/css2")` }],
      [remoteStylesheetHost],
    )).toEqual([`src/example.css: forbidden remote build dependency reference: ${remoteStylesheetHost}`]);
  });
});
