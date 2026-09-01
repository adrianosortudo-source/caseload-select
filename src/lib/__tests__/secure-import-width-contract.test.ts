import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const globalsPath = "src/app/globals.css";
const targetComponentPaths = [
  "src/app/portal/[firmId]/clients/page.tsx",
  "src/components/portal/SecureImportRoom.tsx",
  "src/components/portal/SecureImportTrustGuide.tsx",
] as const;
const scopedPaths = [globalsPath, ...targetComponentPaths] as const;
const semanticTextTags = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "dd", "blockquote", "summary", "figcaption",
]);

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function semanticWidthViolations(relativePath: string): string[] {
  const source = ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations: string[] = [];

  function visit(node: ts.Node): void {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening && semanticTextTags.has(opening.tagName.getText())) {
      const sourceText = opening.getText(source);
      if (/max-w-|max-width|maxInlineSize|max-inline-size|\b\d+(?:\.\d+)?ch\b/i.test(sourceText)) {
        const position = source.getLineAndCharacterOfPosition(opening.getStart(source));
        violations.push(`${relativePath}:${position.line + 1} ${sourceText}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

function semanticCssWidthViolations(relativePath: string): string[] {
  const source = read(relativePath);
  const violations: string[] = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const semanticSelector = /(?:^|[\s>+~,(])(?:h[1-6]|p|li|dd|blockquote|summary|figcaption)(?=$|[\s>+~.#:[,)])/i;

  for (const rule of source.matchAll(rulePattern)) {
    const selector = rule[1].trim().replace(/\s+/g, " ");
    if (!semanticSelector.test(selector)) continue;
    const cappedDeclarations = rule[2].match(/max-(?:width|inline-size)\s*:[^;{}]+|(?:width|inline-size)\s*:[^;{}]*\b\d+(?:\.\d+)?ch\b/gi) ?? [];
    violations.push(...cappedDeclarations.map((declaration) => `${relativePath} ${selector} uses ${declaration.trim()}`));
  }

  return violations;
}

describe("Secure Import component width contract", () => {
  it("keeps the removed shared measure system out of the scoped entry path", () => {
    const legacyIdentifiers = [
      ["readable", "prose"].join("-"),
      ["measure", "readable"].join("-"),
      ["measure", "heading"].join("-"),
      ["data", "readable", "measure", "exception"].join("-"),
      ["--measure", "readable"].join("-"),
      ["--measure", "heading"].join("-"),
    ];
    const violations = scopedPaths.flatMap((file) => legacyIdentifiers
      .filter((identifier) => read(file).includes(identifier))
      .map((identifier) => `${file} contains legacy identifier ${identifier}`));

    expect(violations).toEqual([]);
  });

  it("does not cap semantic copy in the Clients or Secure Import components", () => {
    expect([
      ...targetComponentPaths.flatMap(semanticWidthViolations),
      ...semanticCssWidthViolations(globalsPath),
    ]).toEqual([]);
  });

  it("keeps the technical disclosure summary and import summary full width", () => {
    const guide = read("src/components/portal/SecureImportTrustGuide.tsx");
    const room = read("src/components/portal/SecureImportRoom.tsx");
    expect(guide).toContain('<summary className="cursor-pointer px-4 py-4 text-sm font-bold text-navy');
    expect(room).toContain('function Summary({ label, value }');
    expect(room).toContain('className="bg-parchment px-4 py-3"');
  });

  it("keeps the Clients relationship copy useful until its action row genuinely fits", () => {
    const clients = read("src/app/portal/[firmId]/clients/page.tsx");
    expect(clients).toContain("lg:flex-row lg:items-end lg:justify-between");
    expect(clients).not.toContain("sm:flex-row sm:items-end sm:justify-between");
    expect(clients).toContain('className="mt-2 text-sm leading-6 text-black/60"');
  });
});
