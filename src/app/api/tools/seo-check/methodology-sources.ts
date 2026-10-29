import type { CategoryResult, CheckItem } from "./engine-core";

export type MethodologySource = {
  id: string;
  publisher: string;
  title: string;
  url: string;
  publishedOrUpdatedDate?: string;
  verifiedAt?: string;
  verification: "verified" | "pending" | "unavailable";
  role: "implemented" | "context" | "account-review";
  supports: string[];
  implementationRefs: string[];
  limitations: string[];
};

export type CheckEvidenceKind = NonNullable<CheckItem["evidence"]>["kind"];

export type MethodologyCheckDefinition = {
  id: string;
  category: string;
  label: string;
  sourceIds: string[];
  evidenceKind: CheckEvidenceKind;
  scoreEligible: boolean;
  disposition: "scored" | "unscored" | "pending-review";
  basis: string;
  predicate?: string;
  scoringRationale?: string;
};

const REVIEWED = "2026-10-28";

export const METHODOLOGY_SOURCES: Record<string, MethodologySource> = {
  G01: { id: "G01", publisher: "Google Search Central", title: "Technical requirements", url: "https://developers.google.com/search/docs/essentials/technical", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["Googlebot access and technical eligibility explanations"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts", "src/app/api/tools/seo-check/route.ts"], limitations: ["Eligibility does not confirm indexing or ranking."] },
  G02: { id: "G02", publisher: "Google Search Central", title: "AI features and your website", url: "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide", publishedOrUpdatedDate: "2026-07-10", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Limits on AI search claims and required formats"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["Does not support universal word-count, special AI-schema, chunking, or llms.txt requirements."] },
  G03: { id: "G03", publisher: "Google Search Central", title: "Do you need an SEO?", url: "https://developers.google.com/search/docs/fundamentals/third-party-seo", publishedOrUpdatedDate: "2026-06-05", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Disclosure that third-party tools use their own metrics"], implementationRefs: ["src/app/api/tools/seo-check/report-model.ts"], limitations: ["Does not validate CaseLoad scoring thresholds or endorse this product."] },
  G04: { id: "G04", publisher: "Google Search Central", title: "Control what you share with Google Search", url: "https://developers.google.com/search/docs/crawling-indexing/control-what-you-share", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["Separate crawl, index, canonical, and snippet observations"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts", "src/app/api/tools/seo-check/route.ts"], limitations: ["Public observations do not confirm Google's indexing or canonical selection."] },
  G05: { id: "G05", publisher: "Google Search Console Help", title: "AI features and your site in Search", url: "https://support.google.com/webmasters/answer/16908024", verifiedAt: REVIEWED, verification: "verified", role: "account-review", supports: ["Account-level AI inclusion settings for human review"], implementationRefs: [], limitations: ["Not assessed by the public scan; settings cannot be inferred from robots.txt."] },
  G06: { id: "G06", publisher: "Google Search Console Help", title: "AI features report", url: "https://support.google.com/webmasters/answer/16984139", verifiedAt: REVIEWED, verification: "verified", role: "account-review", supports: ["Authorized account review of AI Overview and AI Mode impressions"], implementationRefs: [], limitations: ["Not a universal citation measure; insufficient data may leave the report unavailable."] },
  G07: { id: "G07", publisher: "Google Search Central", title: "General structured data guidelines", url: "https://developers.google.com/search/docs/appearance/structured-data/sd-policies", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["Structured data should describe visible page content; distinguish syntax from eligibility"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["Parsing does not establish eligibility, quality, or display."] },
  G08: { id: "G08", publisher: "Google Search Central", title: "Review snippet structured data", url: "https://developers.google.com/search/docs/appearance/structured-data/review-snippet", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Self-serving LocalBusiness and Organization review snippets are ineligible"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["No automated legal judgment or review-accuracy finding."] },
  G09: { id: "G09", publisher: "Google Search Central", title: "Search documentation updates", url: "https://developers.google.com/search/updates", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["FAQ rich-result retirement and Search documentation changes"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["A change log is maintenance context, not a ranking formula."] },
  G10: { id: "G10", publisher: "Google Search Central", title: "Page experience in Google Search", url: "https://developers.google.com/search/docs/appearance/page-experience", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Limits of page-experience claims"], implementationRefs: ["src/app/api/tools/seo-check/rendering-analysis.ts"], limitations: ["Raw HTML and request timing are not a complete user-experience assessment."] },
  G11: { id: "G11", publisher: "Chrome for Developers", title: "Web Vitals", url: "https://web.dev/articles/vitals", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Core Web Vitals measurement definitions"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["Field LCP, INP, and CLS are not measured by this scanner."] },
  G12: { id: "G12", publisher: "Google Crawling", title: "Google common crawlers: Google-Extended", url: "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended", publishedOrUpdatedDate: "2026-10-15", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["Google-Extended controls Gemini training and grounding; it is not a Search crawler"], implementationRefs: ["src/app/api/tools/seo-check/engine-core.ts"], limitations: ["It has no separate HTTP crawler identity and does not control Google Search inclusion or rankings."] },
  G13: { id: "G13", publisher: "Google Search Central", title: "Influence your title links in search results", url: "https://developers.google.com/search/docs/appearance/title-link", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["Every page should specify a concise, descriptive title; no fixed character-length limit"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["Displayed title links can be generated or truncated according to query and device context."] },
  G14: { id: "G14", publisher: "Google Search Central", title: "Control your snippets in search results", url: "https://developers.google.com/search/docs/appearance/snippet", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Meta descriptions may be used for snippets; snippets are primarily generated from page content"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["No fixed description-length limit; Google may use other page text."] },
  G15: { id: "G15", publisher: "Google Search Central", title: "How to specify a canonical URL", url: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Canonical annotations help indicate a preferred URL but are optional"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["Google may select a different canonical; absence or disagreement alone is not a search defect."] },
  G16: { id: "G16", publisher: "Google Search Central", title: "Build and submit a sitemap", url: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Small or comprehensively linked sites may not need a sitemap"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["Sitemap membership is an optional discovery observation, not a universal requirement."] },
  G17: { id: "G17", publisher: "Google Search Central", title: "Robots meta tag and X-Robots-Tag", url: "https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Page-level nofollow directives are policy instructions whose interpretation is not a guaranteed outcome"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["The presence of a nofollow directive does not establish how every link or page will be treated."] },
  G18: { id: "G18", publisher: "Google Search Central", title: "301 redirects", url: "https://developers.google.com/search/docs/crawling-indexing/301-redirects", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Permanent redirects are a supported way to consolidate URLs"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["A redirect is not itself a defect; destination and behavior require context."] },
  G19: { id: "G19", publisher: "Google Search Central", title: "Site moves with URL changes", url: "https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Google recommends keeping redirect chains short, ideally three hops or fewer and fewer than five"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["The recommendation is migration guidance; a small observed hop count is not a universal search defect."] },
  O01: { id: "O01", publisher: "OpenAI", title: "Overview of OpenAI crawlers", url: "https://developers.openai.com/api/docs/bots", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["OpenAI bot purposes and robots behavior"], implementationRefs: ["src/app/api/tools/seo-check/engine-core.ts"], limitations: ["Robots observations do not prove reachability or citations."] },
  AP01: { id: "AP01", publisher: "Apple", title: "About Applebot", url: "https://support.apple.com/en-us/119829", publishedOrUpdatedDate: "2026-09-04", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["Applebot and Applebot-Extended purposes"], implementationRefs: ["src/app/api/tools/seo-check/engine-core.ts"], limitations: ["Applebot-Extended is a control token, not the Applebot crawler."] },
  CC01: { id: "CC01", publisher: "Common Crawl", title: "CCBot", url: "https://www.commoncrawl.org/ccbot", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["CCBot builds an open web dataset"], implementationRefs: ["src/app/api/tools/seo-check/engine-core.ts"], limitations: ["Downstream dataset use is not limited to model training."] },
  ME01: { id: "ME01", publisher: "Meta", title: "Web crawlers", url: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["Meta crawler and product-indexing purposes"], implementationRefs: ["src/app/api/tools/seo-check/engine-core.ts"], limitations: ["Meta-ExternalAgent has multiple purposes; do not classify it as training only."] },
  A01: { id: "A01", publisher: "Anthropic", title: "Does Anthropic crawl data from the web?", url: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler", publishedOrUpdatedDate: "2026-04-07", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["Anthropic crawler names, purposes, and robots behavior"], implementationRefs: ["src/app/api/tools/seo-check/engine-core.ts"], limitations: ["Do not infer actual crawler access from the policy file."] },
  P01: { id: "P01", publisher: "Perplexity", title: "Perplexity crawlers", url: "https://docs.perplexity.ai/docs/resources/perplexity-crawlers", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["PerplexityBot and Perplexity-User distinctions"], implementationRefs: ["src/app/api/tools/seo-check/engine-core.ts"], limitations: ["User-agent impersonation does not prove actual access."] },
  S02: { id: "S02", publisher: "IETF", title: "RFC 9309: Robots Exclusion Protocol", url: "https://www.rfc-editor.org/info/rfc9309/", publishedOrUpdatedDate: "2022", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["Robots parser semantics"], implementationRefs: ["src/app/api/tools/seo-check/engine-core.ts", "src/app/api/tools/seo-check/page-checks.ts"], limitations: ["Robots rules are not access authorization and do not guarantee deindexing."] },
  S03: { id: "S03", publisher: "Sitemaps.org", title: "Sitemaps XML format", url: "https://www.sitemaps.org/protocol.html", verifiedAt: REVIEWED, verification: "verified", role: "implemented", supports: ["Sitemap URL discovery format"], implementationRefs: ["src/app/api/tools/seo-check/route.ts"], limitations: ["Discovered URLs are not a verified whole-site inventory or indexed-page count."] },
  S01: { id: "S01", publisher: "Schema.org", title: "LegalService", url: "https://schema.org/LegalService", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["LegalService vocabulary term"], implementationRefs: ["src/app/api/tools/seo-check/page-checks.ts"], limitations: ["Vocabulary does not establish a Google requirement, AI requirement, or professional credential."] },
  B01: { id: "B01", publisher: "Microsoft Bing", title: "Bing Webmaster Guidelines", url: "https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a", verifiedAt: REVIEWED, verification: "verified", role: "context", supports: ["Reviewed Bing guidance as contextual background; no Bing-specific score rule is implemented."], implementationRefs: [], limitations: ["Context only; this scan does not infer actual Bing indexing or apply Bing-specific score rules."] },
  L01: { id: "L01", publisher: "Law Society of Ontario", title: "Rules of Professional Conduct, Chapter 4", url: "https://lso.ca/about-lso/legislation-rules/rules-of-professional-conduct/chapter-4", verifiedAt: REVIEWED, verification: "pending", role: "context", supports: [], implementationRefs: [], limitations: ["Full-source review pending; do not implement detailed legal-compliance rules."] },
};

const labelsByCategory: Record<string, string[]> = {
  "On-Page SEO": ["Page title", "Page title length", "Meta description", "H1 heading", "H2 subheadings", "Open Graph tags", "Image alt text", "HTML lang attribute"],
  "Indexability": ["HTTP status", "Redirect chain", "Indexable", "Followable links", "Canonical tag", "Mixed indexability signals", "robots.txt crawl access", "Sitemap membership"],
  "Schema & Structured Data": ["JSON-LD structured data", "JSON-LD validity", "Business / LegalService schema", "Business schema fields", "FAQPage schema", "Review / Rating schema", "Breadcrumb schema", "Schema conflicts", "Entity sameAs coverage"],
  "AI Visibility": ["AI search bot access", "AI training bot control", "Attorney / person schema", "Author / reviewer signals", "Authoritative citations", "Direct-answer sentences", "Entity description", "llms.txt file", "Question-format headings", "Semantic HTML structure"],
  "Legal Marketing": ["Phone number visible", "Contact form / direct contact", "Consultation call to action", "Address / NAP", "Trust signals", "Practice-area intent", "Policy / disclaimer pages"],
  "Local SEO": ["Phone number (NAP)", "Street address (NAP)", "Google Maps embed", "NAP in structured data", "Google Business Profile link"],
  "Technical & Security": ["HTTPS", "Mixed content", "HSTS header", "X-Content-Type-Options", "Content-Security-Policy", "Viewport meta tag", "Compression"],
  "Rendering & Crawlability": ["Server-rendered content", "JavaScript app-shell dependency", "Noscript fallback"],
  "Performance": ["Time to first byte", "HTML document size", "Render-blocking resources", "Third-party scripts"],
  "Links & Content": ["Word count", "Heading hierarchy", "Internal links", "Content-to-HTML ratio", "Anchor text quality", "External links"],
  "Intent Alignment": ["Title alignment", "Meta description alignment", "H1 alignment", "Supporting headings", "URL slug", "Opening copy", "Entity coverage", "Location modifier", "Schema support", "Content depth", "Internal-link context"],
};

const sourceIdsByCheck: Record<string, string[]> = {
  "On-Page SEO::Page title": ["G13"],
  "On-Page SEO::Meta description": ["G14"],
  "Indexability::HTTP status": ["G01"],
  "Indexability::Redirect chain": ["G18", "G19"],
  "Indexability::Indexable": ["G01", "G04", "G17"],
  "Indexability::Followable links": ["G17"],
  "Indexability::Canonical tag": ["G15"],
  "Indexability::Mixed indexability signals": ["G04", "G15", "G17"],
  "Indexability::robots.txt crawl access": ["G01", "G04", "S02"],
  "Indexability::Sitemap membership": ["G16", "S03"],
  "Schema & Structured Data::JSON-LD structured data": ["G07"],
  "Schema & Structured Data::JSON-LD validity": ["G07"],
  "Schema & Structured Data::Business / LegalService schema": ["G07", "S01"],
  "Schema & Structured Data::FAQPage schema": ["G09"],
  "Schema & Structured Data::Review / Rating schema": ["G08"],
  "Schema & Structured Data::Breadcrumb schema": ["G07"],
  "AI Visibility::AI search bot access": ["O01", "A01", "P01", "AP01", "ME01"],
  "AI Visibility::AI training bot control": ["O01", "A01", "G12", "AP01", "CC01", "ME01"],
  "AI Visibility::llms.txt file": ["G02"],
  "AI Visibility::Direct-answer sentences": ["G02"],
  "AI Visibility::Question-format headings": ["G02"],
  "AI Visibility::Semantic HTML structure": ["G02"],
  "Technical & Security::HTTPS": ["G01"],
  "Performance::Time to first byte": ["G10", "G11"],
};

const scoreEligible = new Set([
  "On-Page SEO::Page title",
  "Indexability::HTTP status",
  "Indexability::Indexable",
  "Indexability::robots.txt crawl access",
  "Technical & Security::HTTPS",
]);

const explicitlyUnscored = new Set([
  "Indexability::Redirect chain", "Indexability::Followable links", "Indexability::Canonical tag", "Indexability::Mixed indexability signals", "Indexability::Sitemap membership",
  "On-Page SEO::Page title length", "On-Page SEO::Meta description", "On-Page SEO::H1 heading", "On-Page SEO::H2 subheadings", "On-Page SEO::Open Graph tags", "On-Page SEO::Image alt text", "On-Page SEO::HTML lang attribute",
  "Schema & Structured Data::JSON-LD structured data", "Schema & Structured Data::Business / LegalService schema", "Schema & Structured Data::Business schema fields", "Schema & Structured Data::FAQPage schema", "Schema & Structured Data::Review / Rating schema", "Schema & Structured Data::Breadcrumb schema",
  "AI Visibility::AI search bot access", "AI Visibility::AI training bot control", "AI Visibility::Attorney / person schema", "AI Visibility::Author / reviewer signals", "AI Visibility::Authoritative citations", "AI Visibility::Direct-answer sentences", "AI Visibility::Entity description", "AI Visibility::llms.txt file", "AI Visibility::Question-format headings", "AI Visibility::Semantic HTML structure",
  "Legal Marketing::Address / NAP", "Legal Marketing::Trust signals", "Local SEO::Street address (NAP)", "Local SEO::NAP in structured data",
  "Rendering & Crawlability::Server-rendered content", "Rendering & Crawlability::JavaScript app-shell dependency", "Rendering & Crawlability::Noscript fallback",
  "Links & Content::Word count", "Links & Content::Internal links", "Links & Content::Content-to-HTML ratio", "Links & Content::External links",
]);

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const categoryId: Record<string, string> = {
  "On-Page SEO": "on-page", "Indexability": "indexability", "Schema & Structured Data": "schema",
  "AI Visibility": "ai-observations", "Legal Marketing": "legal-marketing", "Local SEO": "local-seo",
  "Technical & Security": "technical", "Rendering & Crawlability": "rendering", "Performance": "performance",
  "Links & Content": "links-content", "Intent Alignment": "intent",
};

const exclusionBasisByCheck: Record<string, string> = {
  "Indexability::Redirect chain": "Known v4 exclusion: redirects are normal URL behavior. This records the observed hops; the count alone does not establish a defect.",
  "Indexability::Followable links": "Known v4 exclusion: a page-level nofollow instruction is recorded as policy, not a defect or guaranteed link outcome.",
  "Indexability::Canonical tag": "Known v4 exclusion: canonical annotations are optional signals; absence or a different selected URL is not a universal defect.",
  "Indexability::Mixed indexability signals": "Known v4 exclusion: the observed directives are retained for context, but this scan cannot determine the intended canonical or indexing outcome.",
  "Indexability::Sitemap membership": "Known v4 exclusion: sitemap membership is optional for some sites and this bounded check cannot establish a whole-site discovery problem.",
};

const scoredCriteriaByCheck: Record<string, { predicate: string; scoringRationale: string }> = {
  "On-Page SEO::Page title": {
    predicate: "The initial HTML contains a non-empty title element.",
    scoringRationale: "Google recommends a concise, descriptive title for each page. The score measures presence only; title length and displayed title-link selection are excluded.",
  },
  "Indexability::HTTP status": {
    predicate: "The final response for the inspected page returned a 2xx HTTP status.",
    scoringRationale: "A successful response is a directly observed retrieval condition for the page checks. This score records response status only; it does not establish indexing.",
  },
  "Indexability::Indexable": {
    predicate: "No generic or Googlebot-specific noindex directive was observed in the inspected initial HTML or response headers; unknown scope is excluded from the score.",
    scoringRationale: "Google documents generic and Googlebot-specific robots instructions. The score records an applicable instruction only, not actual index status or whether exclusion is intended.",
  },
  "Indexability::robots.txt crawl access": {
    predicate: "No applicable robots.txt Disallow rule for Googlebot was observed on this page path.",
    scoringRationale: "Google documents robots.txt as its crawl-preference mechanism. The score records the Googlebot policy observation only; it does not verify access or indexing.",
  },
  "Technical & Security::HTTPS": {
    predicate: "The inspected page response used an HTTPS URL.",
    scoringRationale: "HTTPS is a directly measurable secure-transport baseline for visitors. This check does not claim that HTTPS predicts rankings.",
  },
};

export const METHODOLOGY_CHECKS: Record<string, MethodologyCheckDefinition> = {};
for (const [category, labels] of Object.entries(labelsByCategory)) {
  for (const label of labels) {
    const key = `${category}::${label}`;
    const sourceIds = sourceIdsByCheck[key] ?? [];
    const kind: CheckEvidenceKind = category === "Indexability"
      ? label === "robots.txt crawl access" ? "robots-policy" : "measured-fetch"
      : category === "Schema & Structured Data" ? "structured-data"
        : category === "Technical & Security" ? label.includes("header") || label.includes("Policy") ? "response-header" : "measured-fetch"
          : category === "AI Visibility" && (label.includes("bot") || label.includes("crawler")) ? "robots-policy"
            : "initial-html-text";
    const disposition = scoreEligible.has(key) ? "scored" : explicitlyUnscored.has(key) ? "unscored" : "pending-review";
    const scoredCriteria = scoredCriteriaByCheck[key];
    if (scoreEligible.has(key) && !scoredCriteria) throw new Error(`Missing scored predicate or rationale for ${key}`);
    METHODOLOGY_CHECKS[key] = {
      id: `seo.${categoryId[category]}.${slug(label)}`,
      category,
      label,
      sourceIds,
      evidenceKind: kind,
      scoreEligible: scoreEligible.has(key),
      disposition,
      ...(scoredCriteria ? scoredCriteria : {}),
      basis: scoredCriteria
        ? `Predicate: ${scoredCriteria.predicate} Scoring rationale: ${scoredCriteria.scoringRationale}`
        : exclusionBasisByCheck[key] ?? (disposition === "unscored"
          ? "Known v4 exclusion: shown as a contextual observation, excluded from the score denominator and automatic actions."
          : "Source-to-predicate mapping is pending. Shown as an observation only; excluded from the score and automatic actions until reviewed."),
    };
  }
}

export function attachMethodologyEvidence(categories: CategoryResult[], assessedUrl: string): CategoryResult[] {
  return categories.map((category) => ({
    ...category,
    items: category.items.map((item) => {
      const key = `${category.name}::${item.label}`;
      const definition = METHODOLOGY_CHECKS[key];
      if (!definition) {
        return {
          ...item,
          scored: false,
          applicability: "unknown",
          checkId: `seo.unmapped.${slug(key)}`,
          sourceIds: [],
          disposition: "pending-review",
          basis: "No stable methodology definition is registered for this check.",
          evidence: { kind: "product-heuristic", assessedUrl, applicability: "unknown", coverage: "not-assessed", detail: "No stable methodology definition is registered for this check." },
        };
      }
      const coverage = item.applicability === "unknown" || item.applicability === "not-applicable"
        ? "not-assessed"
        : item.status === "pass" ? "observed" : "not-observed";
      return {
        ...item,
        scored: definition.scoreEligible ? item.scored : false,
        checkId: definition.id,
        sourceIds: definition.sourceIds,
        disposition: definition.disposition,
        basis: definition.basis,
        ...(definition.predicate ? { predicate: definition.predicate } : {}),
        ...(definition.scoringRationale ? { scoringRationale: definition.scoringRationale } : {}),
        evidence: {
          kind: definition.evidenceKind,
          assessedUrl,
          applicability: item.applicability ?? "applicable",
          coverage,
          detail: item.detail,
        },
      };
    }),
  }));
}
