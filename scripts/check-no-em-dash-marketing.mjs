#!/usr/bin/env node
/**
 * Brand guard: the public marketing route group must be free of em dashes in its
 * rendered copy. The no-em-dash rule is a zero-exception brand rule, called out
 * explicitly for marketing in the app docs. This scans src/app/(marketing),
 * strips comments (which never render), and fails if the em-dash code point
 * survives in code or string literals. Use a colon, comma, parentheses, or the
 * brand mid-dot instead.
 *
 * Runs as the first step of `npm run build`, so a deploy that reintroduces an
 * em dash to the marketing site fails before it ships. Scoped to marketing on
 * purpose: the rest of the tree carries historical em dashes in comments, LLM
 * prompt strings, and empty-value glyphs that a global guard would choke on.
 *
 * Run directly: node scripts/check-no-em-dash-marketing.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The em dash, referenced by code point so this guard file stays clean.
const EM = String.fromCharCode(0x2014);
const ROOT = join(process.cwd(), "src", "app", "(marketing)");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

// Drop block comments and line comments so only code + string literals remain.
// The line-comment strip skips "://" so URLs are not mistaken for comments.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const offenders = [];
for (const file of walk(ROOT)) {
  const stripped = stripComments(readFileSync(file, "utf8"));
  stripped.split("\n").forEach((line, idx) => {
    if (line.includes(EM)) {
      offenders.push(`${file.replace(process.cwd() + "/", "")}:${idx + 1}: ${line.trim()}`);
    }
  });
}

if (offenders.length > 0) {
  console.error("Em dash found in marketing copy (banned). Use a colon, comma, parentheses, or the brand mid-dot:");
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log("OK: no em dashes in marketing copy.");
