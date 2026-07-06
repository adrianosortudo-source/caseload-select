import { type CategoryResult, scoreItems } from "./engine-core";

export type RenderingRisk = "low" | "medium" | "high";

export interface PageRenderingSnapshot {
  risk: RenderingRisk;
  wordCount: number;
  scriptCount: number;
  externalScriptCount: number;
  appShellLikely: boolean;
  emptyAppRoot: boolean;
  hasNoscriptFallback: boolean;
  evidence: string[];
  recommendation?: string;
}

export interface SiteRenderingSummary {
  risk: RenderingRisk;
  highRiskPages: number;
  mediumRiskPages: number;
  totalPages: number;
  evidence: string[];
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  return (text.match(/\b[\p{L}\p{N}][\p{L}\p{N}'-]*\b/gu) || []).length;
}

function hasEmptyRoot(html: string): boolean {
  // Match app-shell mount points by EXACT attribute token (id="root",
  // class="app __next"), not substring. The prior substring match meant any
  // class merely containing "app" or "root" (Squarespace emits several, field
  // case marathonlaw.ca /contact) flagged a fully server-rendered page as an
  // empty app shell.
  const roots = html.matchAll(/<(?:div|main)[^>]+(?:id|class)=["']([^"']*)["'][^>]*>([\s\S]*?)<\/(?:div|main)>/gi);
  const SHELL_TOKEN = /(?:^|\s)(?:__next|root|app|gatsby-focus-wrapper|svelte|nuxt)(?:\s|$)/;
  for (const root of roots) {
    if (!SHELL_TOKEN.test(root[1])) continue;
    if (countWords(stripTags(root[2])) < 20) return true;
  }
  return false;
}

export function analyzeRenderingSnapshot(html: string, wordCountOverride?: number): PageRenderingSnapshot {
  const scriptTags = html.match(/<script\b[^>]*>/gi) || [];
  const externalScriptCount = scriptTags.filter((s) => /\bsrc=["']/i.test(s)).length;
  const bodyText = stripTags(html);
  const wordCount = Number.isFinite(wordCountOverride) ? Math.max(0, Math.round(wordCountOverride as number)) : countWords(bodyText);
  const emptyAppRoot = hasEmptyRoot(html);
  const appShellLikely =
    emptyAppRoot ||
    /__NEXT_DATA__|data-reactroot|id=["']root["']|id=["']__next["']|vite\/client|gatsby|nuxt/i.test(html);
  const hasNoscriptFallback = /<noscript[\s\S]*?>[\s\S]{80,}<\/noscript>/i.test(html);

  const evidence: string[] = [`${wordCount} words in server HTML`, `${externalScriptCount} external scripts`];
  if (appShellLikely) evidence.push("framework/app-shell markers found");
  if (emptyAppRoot) evidence.push("main app/root container has little visible text");
  if (hasNoscriptFallback) evidence.push("noscript fallback content present");

  // HIGH means "the raw HTML likely hides content a browser would show", so
  // it requires an app-shell signal, not just brevity: a contact page with 110
  // words of fully server-rendered NAP is short by design, not JS-dependent
  // (field case marathonlaw.ca /contact, previously HIGH on word count alone).
  let risk: RenderingRisk = "low";
  if ((wordCount < 120 && externalScriptCount >= 5 && appShellLikely) || (emptyAppRoot && wordCount < 150)) risk = "high";
  else if (wordCount < 180 || (emptyAppRoot && wordCount < 260) || (wordCount < 300 && appShellLikely && externalScriptCount >= 10)) risk = "medium";
  if (hasNoscriptFallback && risk === "high" && wordCount >= 80) risk = "medium";

  return {
    risk,
    wordCount,
    scriptCount: scriptTags.length,
    externalScriptCount,
    appShellLikely,
    emptyAppRoot,
    hasNoscriptFallback,
    evidence,
    recommendation: risk === "low"
      ? undefined
      : "Verify the page in a rendered browser and ensure key headings, service copy, phone numbers, and CTAs are present in the initial HTML or otherwise reliably crawlable.",
  };
}

export function buildRenderingCategory(snapshot: PageRenderingSnapshot): CategoryResult {
  const items = [
    snapshot.risk === "high"
      ? {
          label: "Server-rendered content",
          status: "fail" as const,
          detail: `Thin server HTML detected: ${snapshot.evidence.join("; ")}.`,
          fix: snapshot.recommendation,
        }
      : snapshot.risk === "medium"
        ? {
            label: "Server-rendered content",
            status: "warn" as const,
            detail: `Some important content may depend on JavaScript: ${snapshot.evidence.join("; ")}.`,
            fix: snapshot.recommendation,
          }
        : {
            label: "Server-rendered content",
            status: "pass" as const,
            detail: `Server HTML contains enough visible content for crawler analysis (${snapshot.wordCount} words).`,
          },
    snapshot.appShellLikely
      ? {
          label: "JavaScript app-shell dependency",
          status: snapshot.risk === "high" ? "warn" as const : "pass" as const,
          detail: snapshot.emptyAppRoot
            ? snapshot.risk === "high"
              ? "The page looks like a thin app shell, so raw HTML checks may undercount CTAs or content."
              : "Framework markers found, but the server HTML still contains enough visible content for this scan."
            : "Framework markers found, but the server HTML still contains meaningful content.",
          fix: snapshot.risk === "high" ? "Server-render or statically render critical legal-service copy and conversion elements." : undefined,
        }
      : {
          label: "JavaScript app-shell dependency",
          status: "pass" as const,
          detail: "No thin app-shell pattern detected.",
        },
    snapshot.hasNoscriptFallback
      ? {
          label: "Noscript fallback",
          status: "pass" as const,
          detail: "Fallback content is available when JavaScript is not executed.",
        }
      : {
          label: "Noscript fallback",
          status: snapshot.risk === "high" ? "warn" as const : "pass" as const,
          detail: snapshot.risk === "high"
            ? "No substantial noscript fallback was found for a JavaScript-dependent page."
            : "No noscript fallback needed for the detected server-rendered content level.",
          fix: snapshot.risk === "high" ? "Add server-rendered fallback content for core page messaging." : undefined,
        },
  ];
  const { score, maxScore } = scoreItems(items);
  return { name: "Rendering & Crawlability", score, maxScore, items };
}

export function aggregateRenderingSummary(pages: Array<{ url: string; rendering?: PageRenderingSnapshot }>): SiteRenderingSummary | undefined {
  const snapshots = pages
    .map((p) => ({ url: p.url, rendering: p.rendering }))
    .filter((p): p is { url: string; rendering: PageRenderingSnapshot } => !!p.rendering);
  if (snapshots.length === 0) return undefined;
  const high = snapshots.filter((p) => p.rendering.risk === "high");
  const medium = snapshots.filter((p) => p.rendering.risk === "medium");
  const risk: RenderingRisk = high.length > 0 ? "high" : medium.length > 0 ? "medium" : "low";
  const flagged = [...high, ...medium].slice(0, 4);
  return {
    risk,
    highRiskPages: high.length,
    mediumRiskPages: medium.length,
    totalPages: snapshots.length,
    evidence: flagged.length > 0
      ? flagged.map((p) => {
          try { return `${new URL(p.url).pathname || "/"}: ${p.rendering.evidence.join("; ")}`; }
          catch { return `${p.url}: ${p.rendering.evidence.join("; ")}`; }
        })
      : ["Server HTML appears to contain enough visible content across scanned pages."],
  };
}
