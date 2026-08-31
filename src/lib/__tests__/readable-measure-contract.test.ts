import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const targetFiles = [
  "src/components/portal/SecureImportRoom.tsx",
  "src/components/portal/SecureImportTrustGuide.tsx",
] as const;
const semanticProseTags = new Set(["p", "li", "dd", "blockquote"]);
const prohibitedInlineSizeProperties = new Set(["width", "maxWidth", "maxInlineSize"]);
const genericExceptionReasons = new Set(["exception", "needed", "layout", "todo"]);
const nonProseTextTags = new Set([
  "style", "script", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "figure", "figcaption",
  "h1", "h2", "h3", "h4", "h5", "h6",
]);

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const scopedFiles = execFileSync(
  "git",
  ["grep", "-l", "readable-prose", "--", "src/app", "src/components"],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/)
  .filter((relativePath) => relativePath.endsWith(".tsx"));

function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
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

function staticAttributeValue(attributeNode: ts.JsxAttribute | null): string | null {
  if (!attributeNode?.initializer) return null;
  if (ts.isStringLiteral(attributeNode.initializer)) return attributeNode.initializer.text;
  if (!ts.isJsxExpression(attributeNode.initializer)) return null;
  const expression = attributeNode.initializer.expression;
  if (expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))) {
    return expression.text;
  }
  return null;
}

function classTokens(opening: ts.JsxOpeningLikeElement): string[] | null {
  const className = attribute(opening, "className");
  if (!className) return [];
  const value = staticAttributeValue(className);
  return value === null ? null : value.split(/\s+/).filter(Boolean);
}

function tagName(opening: ts.JsxOpeningLikeElement): string {
  return opening.tagName.getText();
}

function exceptionReason(opening: ts.JsxOpeningLikeElement): string | undefined {
  const exception = attribute(opening, "data-readable-measure-exception");
  if (!exception) return undefined;
  return staticAttributeValue(exception) ?? "";
}

function hasReviewableExceptionReason(opening: ts.JsxOpeningLikeElement): boolean {
  const reason = exceptionReason(opening)?.trim() ?? "";
  return reason.length >= 8 && !genericExceptionReasons.has(reason.toLowerCase());
}

function enclosingExceptionReason(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    const opening = openingElement(current);
    const reason = opening ? exceptionReason(opening) : undefined;
    if (reason !== undefined) return reason;
    current = current.parent;
  }
  return undefined;
}

function jsxLocation(source: ts.SourceFile, node: ts.Node): string {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${source.fileName}:${position.line + 1}`;
}

function inlineSizeStyleProperties(opening: ts.JsxOpeningLikeElement): string[] {
  const style = attribute(opening, "style");
  if (!style) return [];
  if (!style.initializer || !ts.isJsxExpression(style.initializer)) return ["uninspectable style"];
  const expression = style.initializer.expression;
  if (!expression || !ts.isObjectLiteralExpression(expression)) return ["uninspectable style"];

  return expression.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      return ["uninspectable style spread"];
    }
    const name = property.name?.getText().replace(/["']/g, "");
    return name && prohibitedInlineSizeProperties.has(name) ? [name] : [];
  });
}

function prohibitedClassToken(token: string): boolean {
  return /(^|:)!?max-w-/.test(token)
    || /(^|:)!?\[(?:max-inline-size|max-width):/i.test(token);
}

function directStaticTextLength(node: ts.JsxElement): number {
  const text = node.children.map((child) => {
    if (ts.isJsxText(child)) return child.text;
    if (!ts.isJsxExpression(child) || !child.expression) return "";
    if (ts.isStringLiteral(child.expression) || ts.isNoSubstitutionTemplateLiteral(child.expression)) {
      return child.expression.text;
    }
    return "";
  }).join(" ").replace(/\s+/g, " ").trim();
  return text.length;
}

function readableScopes(source: ts.SourceFile): ts.JsxElement[] {
  const scopes: ts.JsxElement[] = [];
  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) && classTokens(node.openingElement)?.includes("readable-prose")) {
      scopes.push(node);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return scopes;
}

function defaultComponentRoot(source: ts.SourceFile): ts.JsxOpeningLikeElement | null {
  const defaultFunction = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement)
      && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true,
  );
  if (!defaultFunction?.body) return null;

  let result: ts.JsxOpeningLikeElement | null = null;
  function visit(node: ts.Node): void {
    if (result) return;
    if (ts.isReturnStatement(node) && node.expression) {
      let expression = node.expression;
      while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
      result = openingElement(expression);
      if (result) return;
    }
    ts.forEachChild(node, visit);
  }
  visit(defaultFunction.body);
  return result;
}

describe("readable prose measure contract", () => {
  it("defines a zero-specificity 65ch utility scoped to opted-in prose surfaces", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("--measure-readable: 65ch;");
    expect(css).toContain(":where(.measure-readable)");
    expect(css).toContain(":where(.readable-prose) :where(p, li, dd, blockquote)");
    expect(css).toContain("max-inline-size: var(--measure-readable);");
    expect(css).toContain(":where([data-readable-measure-exception]:not([data-readable-measure-exception=\"\"]))");
    expect(css).not.toMatch(/(^|[,{]\s*)p\s*\{/m);
  });

  for (const relativePath of targetFiles) {
    it(`${relativePath} opts in at the component root`, () => {
      const source = parse(relativePath);
      const componentRoot = defaultComponentRoot(source);
      expect(componentRoot, `${relativePath} must return a JSX root`).not.toBeNull();
      expect(classTokens(componentRoot!), `${relativePath} root className must be static`).not.toBeNull();
      expect(classTokens(componentRoot!)).toContain("readable-prose");
    });
  }

  for (const relativePath of scopedFiles) {
    it(`${relativePath} has no unreasoned prose-width bypass`, () => {
      const source = parse(relativePath);
      const violations: string[] = [];
      function visit(node: ts.Node): void {
        const opening = openingElement(node);
        if (opening) {
          const reason = exceptionReason(opening);
          if (reason !== undefined && !hasReviewableExceptionReason(opening)) {
            violations.push(`${jsxLocation(source, opening)} has a missing, dynamic, empty or generic exception reason`);
          }

          const tokens = classTokens(opening);
          const semanticProse = semanticProseTags.has(tagName(opening));
          const explicitProse = tokens?.includes("measure-readable") === true;
          if (semanticProse || explicitProse) {
            const exempt = (enclosingExceptionReason(node)?.trim().length ?? 0) > 0;
            if (!exempt && tokens === null) {
              violations.push(`${jsxLocation(source, opening)} readable copy has a dynamic className`);
            }
            if (!exempt && tokens?.some(prohibitedClassToken)) {
              violations.push(`${jsxLocation(source, opening)} readable copy uses a prohibited inline-size utility`);
            }
            if (!exempt) {
              for (const property of inlineSizeStyleProperties(opening)) {
                violations.push(`${jsxLocation(source, opening)} readable copy uses prohibited inline ${property}`);
              }
            }
          }

          if (
            ts.isJsxElement(node)
            && !semanticProse
            && !nonProseTextTags.has(tagName(opening))
            && directStaticTextLength(node) >= 120
            && !explicitProse
            && !hasReviewableExceptionReason(opening)
          ) {
            violations.push(`${jsxLocation(source, opening)} has long direct text without measure-readable or a reasoned exception`);
          }
        }
        ts.forEachChild(node, visit);
      }
      const scopes = readableScopes(source);
      expect(scopes.length, `${relativePath} must contain a readable-prose JSX scope`).toBeGreaterThan(0);
      for (const scope of scopes) visit(scope);

      expect(violations).toEqual([]);
    });
  }

  it("keeps exception reasons literal and reviewable", () => {
    const reasons = scopedFiles.flatMap((relativePath) => {
      const source = parse(relativePath);
      const found: string[] = [];
      function visit(node: ts.Node): void {
        const opening = openingElement(node);
        const reason = opening ? exceptionReason(opening) : undefined;
        if (reason !== undefined) found.push(reason);
        ts.forEachChild(node, visit);
      }
      visit(source);
      return found;
    });

    expect(reasons).toContain("eight-column CSV data table");
    expect(reasons).toContain("compact import summary data");
    expect(reasons.every((reason) => reason.trim().length >= 8)).toBe(true);
    expect(reasons.every((reason) => !genericExceptionReasons.has(reason.trim().toLowerCase()))).toBe(true);
  });
});
