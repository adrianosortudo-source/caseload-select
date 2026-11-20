/**
 * Visitor-facing language for report text authored by CaseLoad Select.
 * Keep crawler tokens and source links in the underlying observations.
 */
const labels: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:Google Search Console|Bing Webmaster Tools)\b/g, "the search performance dashboard"],
  [/\b(?:Google Business Profile|Bing Places|GBP)\b/g, "business listing"],
  [/\b(?:Google Maps|Google Map)\b/g, "map"],
  [/\bGoogle-addressed\b/g, "search-engine-specific"],
  [/\bGoogle indexing\b/g, "indexing in the primary search engine"],
  [/\bGooglebot\b/g, "the primary search crawler"],
  [/\bBingbot\b/g, "the secondary search crawler"],
  [/(^|[.!?] )Google\b/g, "$1The primary search engine"],
  [/\bGoogle\b/g, "the primary search engine"],
  [/\bBing\b/g, "the secondary search engine"],
  [/\bnew WordPress install\b/g, "new installation of the publishing platform"],
  [/\bWordPress starter content\b/g, "Default starter content"],
  [/\bWordPress(?:'s|’s)\b/g, "the publishing platform’s"],
  [/\bWordPress defaults\b/g, "default content from the publishing platform"],
  [/\bWordPress placeholder pages\b/g, "placeholder pages"],
  [/\b(?:ChatGPT|OpenAI|Claude|Anthropic|Perplexity|Gemini)\b/g, "an AI service"],
];

const crawlerLabels: Readonly<Record<string, string>> = {
  "OAI-SearchBot": "AI search crawler 1",
  "OpenAI SearchBot": "AI search crawler 1",
  "Claude-SearchBot": "AI search crawler 2",
  "Claude Search": "AI search crawler 2",
  PerplexityBot: "AI search crawler 3",
  "Meta-WebIndexer": "AI search crawler 4",
  GPTBot: "Training crawler 1",
  ClaudeBot: "Training crawler 2",
  "ChatGPT-User": "User-requested fetch 1",
  "Claude-User": "User-requested fetch 2",
  "Perplexity-User": "User-requested fetch 3",
  "Google-Extended": "Training and grounding control",
  Applebot: "Search and training crawler",
  "Applebot-Extended": "Training control",
  CCBot: "Public archive crawler",
  "Meta-ExternalAgent": "Training and indexing crawler",
  Bytespider: "Crawler with unverified purpose",
};

export function seoCrawlerLabel(token: string): string {
  return crawlerLabels[token] ?? "Other crawler";
}

export function seoReportCopy(value: string): string {
  const withoutCrawlerNames = value.replace(
    /\b(?:OpenAI SearchBot|OAI-SearchBot|Claude-SearchBot|Claude Search|PerplexityBot|Meta-WebIndexer|GPTBot|ClaudeBot|ChatGPT-User|Claude-User|Perplexity-User|Google-Extended|Applebot-Extended|Applebot|CCBot|Meta-ExternalAgent|Bytespider)\b/g,
    seoCrawlerLabel,
  );
  return labels.reduce((copy, [brand, replacement]) => copy.replace(brand, replacement), withoutCrawlerNames)
    .replace(/^the /, "The ");
}
