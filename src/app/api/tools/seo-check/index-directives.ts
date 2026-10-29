import sanitizeHtml from "sanitize-html";

export type DirectiveStatus = "observed" | "not-observed" | "unknown";
export type DirectiveScope = "generic" | "googlebot" | "googlebot-news" | "bingbot" | "other" | "unknown";
export type DirectiveSource = "meta" | "x-robots-tag";

export interface IndexDirectiveObservation {
  source: DirectiveSource;
  scope: DirectiveScope;
  crawlerToken: string | null;
  rawValue: string;
  explicitDirectives: string[];
  effectiveDirectives: string[];
  googleApplicability: "applicable" | "not-applicable" | "unknown";
  limitation?: string;
}

export interface IndexDirectiveAssessment {
  noindex: DirectiveStatus;
  nofollow: DirectiveStatus;
  observations: IndexDirectiveObservation[];
  limitations: string[];
}

const MAX_HTML_CHARS = 5 * 1024 * 1024;
const MAX_HEADER_FIELDS = 32;
const MAX_HEADER_FIELD_CHARS = 8_192;
const MAX_OBSERVATIONS = 512;
const MAX_DIRECTIVES_PER_VALUE = 128;
const CRAWLER_META_NAME_RE = /(?:bot|crawler|spider|slurp)$/i;
const IGNORED_CONTENT_TAGS = new Set(["script", "style", "textarea", "option", "xmp", "iframe", "noembed", "noframes"]);
const COLON_DIRECTIVE_NAMES = new Set([
  "unavailable_after",
  "max-snippet",
  "max-image-preview",
  "max-video-preview",
]);

function parseTokens(rawValue: string): string[] {
  return [...rawValue.matchAll(/([a-z][a-z0-9_-]*\s*:\s*[^\s,]+|[^\s,]+)/gi)]
    .map((match) => match[0].replace(/\s+/g, "").toLowerCase())
    .slice(0, MAX_DIRECTIVES_PER_VALUE);
}

function hasTooManyDirectives(rawValue: string): boolean {
  return [...rawValue.matchAll(/([a-z][a-z0-9_-]*\s*:\s*[^\s,]+|[^\s,]+)/gi)].length > MAX_DIRECTIVES_PER_VALUE;
}

function effectiveTokens(explicitDirectives: string[]): string[] {
  const effective = new Set(explicitDirectives);
  if (effective.has("none")) {
    effective.add("noindex");
    effective.add("nofollow");
  }
  return [...effective];
}

function scopeForToken(token: string): { scope: DirectiveScope; crawlerToken: string | null; googleApplicability: IndexDirectiveObservation["googleApplicability"] } {
  const lower = token.toLowerCase();
  if (lower === "googlebot") return { scope: "googlebot", crawlerToken: token, googleApplicability: "applicable" };
  if (lower === "googlebot-news") return { scope: "googlebot-news", crawlerToken: token, googleApplicability: "not-applicable" };
  if (lower === "bingbot") return { scope: "bingbot", crawlerToken: token, googleApplicability: "not-applicable" };
  if (token === "") return { scope: "generic", crawlerToken: null, googleApplicability: "applicable" };
  return { scope: "other", crawlerToken: token, googleApplicability: "not-applicable" };
}

function applicableStatus(observations: IndexDirectiveObservation[], directive: "noindex" | "nofollow", limitations: string[]): DirectiveStatus {
  if (observations.some((observation) => observation.googleApplicability === "applicable" && observation.effectiveDirectives.includes(directive))) {
    return "observed";
  }
  if (observations.some((observation) => observation.googleApplicability === "unknown" && observation.effectiveDirectives.includes(directive))) {
    return "unknown";
  }
  if (limitations.some((limitation) => /bound|limit|could not complete|incomplete|truncated|unclosed|exceeded/i.test(limitation))) return "unknown";
  if (observations.some((observation) => observation.limitation?.includes("directive-count bound"))) return "unknown";
  return "not-observed";
}

function makeObservation(
  source: DirectiveSource,
  scopeInfo: ReturnType<typeof scopeForToken>,
  rawValue: string,
  googleApplicability: IndexDirectiveObservation["googleApplicability"] = scopeInfo.googleApplicability,
  limitation?: string,
): IndexDirectiveObservation {
  const explicitDirectives = parseTokens(rawValue);
  const directiveLimitReached = hasTooManyDirectives(rawValue);
  return {
    source,
    scope: scopeInfo.scope,
    crawlerToken: scopeInfo.crawlerToken,
    rawValue: rawValue.slice(0, MAX_HEADER_FIELD_CHARS),
    explicitDirectives,
    effectiveDirectives: effectiveTokens(explicitDirectives),
    googleApplicability,
    ...(limitation || directiveLimitReached ? { limitation: limitation ?? "The directive-count bound was reached; later directives may be missing." } : {}),
  };
}

function parseXRobotsField(
  field: string,
  observations: IndexDirectiveObservation[],
  limitations: string[],
): void {
  let currentAgent = "";
  let currentRaw: string[] = [];
  let currentApplicability: IndexDirectiveObservation["googleApplicability"] = scopeForToken("").googleApplicability;
  let ambiguousContinuation = false;
  const flush = () => {
    if (currentRaw.length === 0) return;
    const rawValue = currentRaw.join(", ");
    const scopeInfo = scopeForToken(currentAgent);
    let applicability = currentApplicability;
    let limitation: string | undefined;
    const tokens = effectiveTokens(parseTokens(rawValue));
    if (currentAgent && currentAgent.toLowerCase() !== "googlebot" && tokens.some((token) => token === "noindex" || token === "nofollow")) {
      const hasAmbiguousBareDirective = currentRaw.slice(1).some((segment) => {
        const trimmed = segment.trim();
        return !/^[a-z][a-z0-9._-]{0,79}\s*:/i.test(trimmed) && /(^|[\s,])(?:noindex|nofollow|none)(?=$|[\s,])/i.test(trimmed);
      });
      if (hasAmbiguousBareDirective) {
        applicability = "unknown";
        limitation = "The flattened X-Robots-Tag value does not retain field boundaries, so this directive may be a crawler-scoped continuation or a separate generic field.";
      }
    }
    const observation = makeObservation("x-robots-tag", scopeInfo, rawValue, applicability, limitation);
    if (observation.limitation) limitations.push(observation.limitation);
    if (observations.length < MAX_OBSERVATIONS) observations.push(observation);
    else limitations.push("The directive observation limit was reached; a missing directive cannot be ruled out.");
    currentRaw = [];
  };

  for (const segment of field.split(",")) {
    const trimmed = segment.trim();
    const prefix = trimmed.match(/^([a-z][a-z0-9._-]{0,79})\s*:\s*(.*)$/i);
    if (prefix && !COLON_DIRECTIVE_NAMES.has(prefix[1].toLowerCase())) {
      flush();
      currentAgent = prefix[1];
      currentApplicability = scopeForToken(prefix[1]).googleApplicability;
      ambiguousContinuation = false;
      currentRaw.push(prefix[2]);
      continue;
    }
    if (/^\s*:\s*/.test(segment)) {
      flush();
      currentAgent = "";
      currentApplicability = "unknown";
      ambiguousContinuation = false;
      currentRaw.push(trimmed.replace(/^:\s*/, ""));
      flush();
      limitations.push("An X-Robots-Tag segment had a malformed crawler scope; Google applicability is unknown.");
      continue;
    }
    const hasDirectiveToken = /(^|[\s,])(?:noindex|nofollow|none)(?=$|[\s,])/i.test(trimmed);
    if (ambiguousContinuation && hasDirectiveToken) {
      const applicability = currentAgent.toLowerCase() === "googlebot" ? "applicable" : "unknown";
      const ambiguous = makeObservation("x-robots-tag", { scope: "unknown", crawlerToken: null, googleApplicability: applicability }, trimmed, applicability, "A bare directive after a crawler-scoped X-Robots-Tag value may belong to that crawler or to a separate generic field.");
      if (observations.length < MAX_OBSERVATIONS) observations.push(ambiguous);
      else limitations.push("The directive observation limit was reached; a missing directive cannot be ruled out.");
      continue;
    }
    if (currentAgent && hasDirectiveToken) {
      flush();
      const applicability = currentAgent.toLowerCase() === "googlebot" ? "applicable" : "unknown";
      const unknownDirective = makeObservation("x-robots-tag", { scope: "unknown", crawlerToken: null, googleApplicability: applicability }, trimmed, applicability, "A bare directive after a crawler-scoped X-Robots-Tag value may belong to that crawler or to a separate generic field.");
      if (observations.length < MAX_OBSERVATIONS) observations.push(unknownDirective);
      else limitations.push("The directive observation limit was reached; a missing directive cannot be ruled out.");
      ambiguousContinuation = true;
      continue;
    }
    currentRaw.push(trimmed);
  }
  flush();
}

/**
 * Parse page-level robots directives without changing the scanner's network or
 * robots.txt behavior. Meta tags are read with sanitize-html's parser hook so
 * comments, script raw text, attribute order, quoting, whitespace, and entities
 * are handled by an HTML parser rather than a regex over source text.
 */
export function parseIndexDirectives(html: string, xRobotsTagValues: readonly string[] = []): IndexDirectiveAssessment {
  const observations: IndexDirectiveObservation[] = [];
  const limitations: string[] = [];
  let noscriptDepth = 0;
  let templateDepth = 0;
  let ignoredContentDepth = 0;
  let parserFailed = false;
  let htmlTruncated = html.length > MAX_HTML_CHARS;
  let headersTruncated = xRobotsTagValues.length > MAX_HEADER_FIELDS;
  const safeHtml = htmlTruncated ? html.slice(0, MAX_HTML_CHARS) : html;
  const safeHeaders = xRobotsTagValues.slice(0, MAX_HEADER_FIELDS);
  if (htmlTruncated) limitations.push("The HTML exceeded the directive-parser bound; a missing directive cannot be ruled out.");
  if (headersTruncated) limitations.push("The response exposed more X-Robots-Tag values than the directive-parser bound; a missing directive cannot be ruled out.");

  try {
    const parserOptions = {
      allowedTags: [] as string[],
      allowedAttributes: {} as Record<string, string[]>,
      nonTextTags: ["script", "style", "textarea", "option", "xmp", "iframe", "noembed", "noframes", "noscript"],
      onOpenTag: (tagName: string, attribs: Record<string, string>) => {
        if (IGNORED_CONTENT_TAGS.has(tagName)) {
          ignoredContentDepth++;
          return;
        }
        if (ignoredContentDepth > 0) return;
        if (tagName === "noscript") {
          noscriptDepth++;
          return;
        }
        if (tagName === "template") {
          templateDepth++;
          return;
        }
        if (templateDepth > 0) return;
        if (tagName !== "meta" || observations.length >= MAX_OBSERVATIONS) return;
        const name = String(attribs.name ?? "").trim().toLowerCase();
        const crawlerToken = name === "robots" ? "" : name;
        if (!name || !(name === "robots" || name === "googlebot" || name === "googlebot-news" || name === "bingbot" || CRAWLER_META_NAME_RE.test(name))) return;
        const content = String(attribs.content ?? "");
        const scopeInfo = scopeForToken(crawlerToken);
        if (noscriptDepth > 0) {
          const effective = effectiveTokens(parseTokens(content));
          if (effective.some((token) => token === "noindex" || token === "nofollow")) {
            const applicability = scopeInfo.googleApplicability === "not-applicable" ? "not-applicable" : "unknown";
            observations.push(makeObservation("meta", scopeInfo, content, applicability, "This robots meta element is inside noscript; the parser cannot establish whether a Google-addressed directive is an applicable document directive."));
          }
          return;
        }
        observations.push(makeObservation("meta", scopeInfo, content));
      },
      onCloseTag: (tagName: string) => {
        if (IGNORED_CONTENT_TAGS.has(tagName) && ignoredContentDepth > 0) ignoredContentDepth--;
        if (tagName === "noscript" && noscriptDepth > 0) noscriptDepth--;
        if (tagName === "template" && templateDepth > 0) templateDepth--;
      },
    } satisfies sanitizeHtml.IOptions;
    void sanitizeHtml(safeHtml, parserOptions);
    if (noscriptDepth > 0) limitations.push("An unclosed noscript element made later meta-tag scope uncertain.");
    if (templateDepth > 0) limitations.push("An unclosed template element made later meta-tag scope uncertain.");
    if (ignoredContentDepth > 0) limitations.push("An unclosed raw-text or embedded-content element made later meta-tag scope uncertain.");
    if (observations.length >= MAX_OBSERVATIONS) limitations.push("The directive observation limit was reached; a missing directive cannot be ruled out.");
  } catch {
    parserFailed = true;
    limitations.push("The HTML parser could not complete; a missing directive cannot be ruled out.");
  }

  if (noscriptDepth > 0) {
    observations.push({
      source: "meta",
      scope: "unknown",
      crawlerToken: null,
      rawValue: "",
      explicitDirectives: [],
      effectiveDirectives: [],
      googleApplicability: "unknown",
      limitation: "An unclosed noscript element made later meta-tag scope uncertain.",
    });
  }

  for (const field of safeHeaders) {
    const value = field.slice(0, MAX_HEADER_FIELD_CHARS);
    if (field.length > MAX_HEADER_FIELD_CHARS) limitations.push("An X-Robots-Tag value exceeded the parser bound; a missing directive cannot be ruled out.");
    parseXRobotsField(value, observations, limitations);
  }

  if (observations.length >= MAX_OBSERVATIONS) limitations.push("The directive observation limit was reached; a missing directive cannot be ruled out.");

  if (parserFailed) limitations.push("HTML directive parsing was incomplete.");
  const finalObservations = observations.slice(0, MAX_OBSERVATIONS);
  return {
    noindex: applicableStatus(finalObservations, "noindex", limitations),
    nofollow: applicableStatus(finalObservations, "nofollow", limitations),
    observations: finalObservations,
    limitations: [...new Set(limitations)],
  };
}
