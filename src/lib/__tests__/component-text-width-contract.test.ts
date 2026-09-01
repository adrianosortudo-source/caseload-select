import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const semanticTextTags = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "dd", "blockquote", "summary", "figcaption",
]);
const prohibitedInlineProperties = new Set(["maxWidth", "maxInlineSize"]);
const contractPath = "src/lib/__tests__/component-text-width-contract.test.ts";

const reviewedSemanticExceptions = new Map<string, string>([
  [
    "src/app/admin/prospecting-diagnostic/_components/ProspectingDiagnosticTool.tsx",
    "Functional URL truncation prevents raw audit paths from widening diagnostic rows.",
  ],
  [
    "src/app/admin/prospecting-diagnostic/_components/SavedDiagnosticDetail.tsx",
    "Functional URL truncation prevents raw audit paths from widening diagnostic rows.",
  ],
  [
    "src/app/portal/[firmId]/boards/BoardTabs.tsx",
    "Compact channel and count data remains a deliberately bounded two-column summary row.",
  ],
  [
    "src/app/widget-v3/[firmId]/ChatWidget.tsx",
    "The centered completion copy belongs to the intentionally constrained chat-message surface.",
  ],
]);

const deletedFiles = new Set(execFileSync(
  "git",
  ["ls-files", "--deleted", "--", "src", "docs/prototypes"],
  { cwd: root, encoding: "utf8" },
).trim().split(/\r?\n/).filter(Boolean));

const trackedTextFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src", "docs/prototypes"],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !deletedFiles.has(file))
  .filter((file) => /\.(?:css|html|jsx?|tsx?)$/.test(file));

const jsxFiles = trackedTextFiles.filter((file) => /\.(?:jsx|tsx)$/.test(file));

function read(relativePath: string): string {
  const localPath = path.join(root, relativePath);
  if (fs.existsSync(localPath)) return fs.readFileSync(localPath, "utf8");
  return execFileSync("git", ["show", `HEAD:${relativePath}`], { cwd: root, encoding: "utf8" });
}

function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JSX,
  );
}

function openingElement(node: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isJsxElement(node)) return node.openingElement;
  if (ts.isJsxSelfClosingElement(node)) return node;
  return null;
}

function attribute(opening: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | null {
  const match = opening.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
  return match ?? null;
}

function location(source: ts.SourceFile, node: ts.Node): string {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${source.fileName}:${position.line + 1}`;
}

function hasProhibitedWidthUtility(attributeNode: ts.JsxAttribute | null): boolean {
  if (!attributeNode?.initializer) return false;
  return /(?:^|[\s"'`}:])(?:[a-z0-9-]+:)*!?max-w-[^\s"'`}]+/i.test(attributeNode.initializer.getText());
}

function prohibitedInlineStyles(attributeNode: ts.JsxAttribute | null): string[] {
  if (!attributeNode?.initializer || !ts.isJsxExpression(attributeNode.initializer)) return [];
  const expression = attributeNode.initializer.expression;
  if (!expression || !ts.isObjectLiteralExpression(expression)) return [];
  return expression.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return [];
    const name = property.name?.getText().replace(/["']/g, "");
    return name && prohibitedInlineProperties.has(name) ? [name] : [];
  });
}

function semanticWidthViolations(relativePath: string): string[] {
  const source = parse(relativePath);
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    const opening = openingElement(node);
    if (opening && semanticTextTags.has(opening.tagName.getText())) {
      if (hasProhibitedWidthUtility(attribute(opening, "className"))) {
        violations.push(`${location(source, opening)} uses a max-width utility on semantic component text`);
      }
      for (const property of prohibitedInlineStyles(attribute(opening, "style"))) {
        violations.push(`${location(source, opening)} uses inline ${property} on semantic component text`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

describe("component text width contract", () => {
  it("removes the legacy shared measure system from every source and prototype file", () => {
    const legacyIdentifiers = [
      ["readable", "prose"].join("-"),
      ["measure", "readable"].join("-"),
      ["measure", "heading"].join("-"),
      ["data", "readable", "measure", "exception"].join("-"),
      ["--measure", "readable"].join("-"),
      ["--measure", "heading"].join("-"),
    ];
    const violations = trackedTextFiles
      .filter((file) => file !== contractPath)
      .flatMap((file) => legacyIdentifiers
        .filter((identifier) => read(file).includes(identifier))
        .map((identifier) => `${file} contains legacy identifier ${identifier}`));

    expect(violations).toEqual([]);
  });

  it("does not cap semantic component text without a reviewed file-level reason", () => {
    const violations: string[] = [];
    const exercisedExceptions = new Set<string>();

    for (const file of jsxFiles) {
      const fileViolations = semanticWidthViolations(file);
      if (fileViolations.length === 0) continue;
      const reason = reviewedSemanticExceptions.get(file)?.trim();
      if (reason) {
        exercisedExceptions.add(file);
        continue;
      }
      violations.push(...fileViolations);
    }

    expect(violations).toEqual([]);
    expect([...reviewedSemanticExceptions.entries()].every(([file, reason]) => (
      trackedTextFiles.includes(file) && reason.trim().length >= 20 && exercisedExceptions.has(file)
    ))).toBe(true);
  });

  it("does not use character-based max-width declarations in source or prototypes", () => {
    const declaration = /max-(?:width|inline-size)\s*:\s*[^;}\n]*\b\d+(?:\.\d+)?ch\b/gi;
    const violations = trackedTextFiles.flatMap((file) => {
      const matches = read(file).match(declaration) ?? [];
      return matches.map((match) => `${file} contains ${match}`);
    });

    expect(violations).toEqual([]);
  });

  it("keeps the Clients import summary full-width until the action row genuinely fits", () => {
    const clients = read("src/app/portal/[firmId]/clients/page.tsx");
    expect(clients).toContain("lg:flex-row lg:items-end lg:justify-between");
    expect(clients).not.toContain("sm:flex-row sm:items-end sm:justify-between");
    expect(clients).toContain('className="mt-2 text-sm leading-6 text-black/60"');
  });
});
