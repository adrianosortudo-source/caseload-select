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

type SemanticWidthViolation = {
  file: string;
  tag: string;
  kind: "class" | "style";
  signature: string;
  sourceLocation: string;
};

type ReviewedSemanticException = {
  file: string;
  tag: string;
  kind: SemanticWidthViolation["kind"];
  signature: string;
  expectedMatches: number;
  reason: string;
};

const reviewedSemanticExceptions: readonly ReviewedSemanticException[] = [
  {
    file: "src/app/admin/prospecting-diagnostic/_components/ProspectingDiagnosticTool.tsx",
    tag: "li",
    kind: "class",
    signature: "max-w-full",
    expectedMatches: 1,
    reason: "Functional URL truncation prevents raw audit paths from widening diagnostic rows.",
  },
  {
    file: "src/app/admin/prospecting-diagnostic/_components/SavedDiagnosticDetail.tsx",
    tag: "li",
    kind: "class",
    signature: "max-w-full",
    expectedMatches: 1,
    reason: "Functional URL truncation prevents raw audit paths from widening diagnostic rows.",
  },
  {
    file: "src/app/portal/[firmId]/boards/BoardTabs.tsx",
    tag: "li",
    kind: "style",
    signature: "maxWidth: 240",
    expectedMatches: 1,
    reason: "Compact channel and count data remains a deliberately bounded two-column summary row.",
  },
] as const;

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

function prohibitedWidthUtilities(attributeNode: ts.JsxAttribute | null): string[] {
  if (!attributeNode?.initializer) return [];
  return attributeNode.initializer.getText().match(/(?:[a-z0-9-]+:)*!?max-w-(?:\[[^\]]+\]|[a-z0-9.-]+)/gi) ?? [];
}

function prohibitedInlineStyles(attributeNode: ts.JsxAttribute | null): string[] {
  if (!attributeNode?.initializer || !ts.isJsxExpression(attributeNode.initializer)) return [];
  const expression = attributeNode.initializer.expression;
  if (!expression || !ts.isObjectLiteralExpression(expression)) return [];
  return expression.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return [];
    const name = property.name?.getText().replace(/["']/g, "");
    return name && prohibitedInlineProperties.has(name) ? [property.getText()] : [];
  });
}

function semanticWidthViolations(relativePath: string): SemanticWidthViolation[] {
  const source = parse(relativePath);
  const violations: SemanticWidthViolation[] = [];
  function visit(node: ts.Node): void {
    const opening = openingElement(node);
    if (opening && semanticTextTags.has(opening.tagName.getText())) {
      const tag = opening.tagName.getText();
      for (const signature of prohibitedWidthUtilities(attribute(opening, "className"))) {
        violations.push({ file: relativePath, tag, kind: "class", signature, sourceLocation: location(source, opening) });
      }
      for (const signature of prohibitedInlineStyles(attribute(opening, "style"))) {
        violations.push({ file: relativePath, tag, kind: "style", signature, sourceLocation: location(source, opening) });
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

  it("does not cap semantic component text without an exact reviewed node signature", () => {
    const violations: string[] = [];
    const matchCounts = new Map(reviewedSemanticExceptions.map((exception) => [exception, 0]));

    for (const file of jsxFiles) {
      for (const violation of semanticWidthViolations(file)) {
        const exception = reviewedSemanticExceptions.find((candidate) => (
          candidate.file === violation.file
          && candidate.tag === violation.tag
          && candidate.kind === violation.kind
          && candidate.signature === violation.signature
        ));
        if (exception) {
          matchCounts.set(exception, (matchCounts.get(exception) ?? 0) + 1);
        } else {
          violations.push(
            `${violation.sourceLocation} <${violation.tag}> uses unreviewed ${violation.kind} signature ${violation.signature}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
    for (const exception of reviewedSemanticExceptions) {
      expect(trackedTextFiles, `${exception.file} must remain a tracked source file`).toContain(exception.file);
      expect(exception.reason.trim().length, `${exception.file} exception needs a reviewable reason`).toBeGreaterThanOrEqual(20);
      expect(
        matchCounts.get(exception),
        `${exception.file} <${exception.tag}> ${exception.kind} signature ${exception.signature}`,
      ).toBe(exception.expectedMatches);
    }
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
