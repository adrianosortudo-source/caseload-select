/**
 * Pure transform: a LinkedIn Article deliverable's body_html -> the HTML
 * LinkedIn's own rich-text Article editor understands when pasted. No I/O,
 * no Supabase, no React.
 *
 * Ported from the operator's one-off script written for one week's manual
 * paste kit:
 *   D:\00_Work\01_CaseLoad_Select\06_Clients\DRGLaw\04_Capture\Week_03_Business_Sale_Lease\03_linkedin\paste-kit\make-paste-kit.js
 * (function toLinkedInHtml, roughly lines 32-174). That script's asset.js
 * cover-image resolution has no equivalent here on purpose: Publish Kit
 * already has native database access to its own artifacts, so there is
 * nothing to port for that part.
 *
 * Why this exists: LinkedIn's Article editor reads text/html off the
 * clipboard and maps supported tags onto its own toolbar controls. Pasting
 * plain text loses every heading, list, and hyperlink. The stored body
 * carries links in the copy-safe "label (url)" / "Source: cite: url" form so
 * a plain-text paste never loses a destination; this transform losslessly
 * reconstructs real <a href> anchors from that form, hung on the label or
 * citation name -- never the bare URL, which was a real bug the operator
 * had to hand-fix on a published article once the naked URL showed up as
 * anchor text.
 *
 * The transform also converts the Five-Line Brief, headings, FAQs, and
 * numbered action blocks into conservative paragraph/strong/emphasis markup.
 * Live destination proof showed that LinkedIn flattens pasted h2/h3/list tags
 * and merges adjacent blockquotes, while it preserves these simpler tags.
 *
 * ENGLISH ONLY. Every pattern below -- the Five-Line Brief labels,
 * "Frequently asked questions", the DR-082 disclaimer's opening words,
 * "Source:"/"See" -- is literal English text taken from the CSB doctrine
 * this codebase has today. There is no Portuguese equivalent on file, and
 * inventing one here would be guessing at doctrine, not porting it.
 * toLinkedInArticlePasteHtmlEnglishOnly, the entry point real callers should
 * use, refuses to run against a non-English locale and returns a typed
 * refusal instead of silently producing wrong output. The bare transform,
 * toLinkedInArticleHtml, does not know about locale at all and must never be
 * wired to a UI control directly for that reason -- see PublishKit.tsx for
 * the actual gate, which is the real enforcement point.
 *
 * Two gaps in the original script are fixed here rather than ported
 * verbatim:
 *
 * 1. Decision Box detection was keyed on one week's exact heading text
 *    ("Six actions before committing to the sale"), so it only ever worked
 *    for that one week. Generalized to a structural signal instead: an <h2>
 *    immediately followed by a run of 2+ numbered <p>1.</p><p>2.</p>...
 *    paragraphs IS a Decision Box, regardless of its wording. The original's
 *    <ol>-promotion regex already matched exactly that numbered-paragraph
 *    run; decisionBoxAndNumberedLists below reuses that same match to also
 *    apply the section-divider <hr> before the heading, instead of matching
 *    the heading text.
 * 2. The English-only assumption was implicit -- every regex here is
 *    English-only, but nothing said so and nothing stopped it running
 *    against Portuguese content. Made explicit via isEnglishLocale and
 *    toLinkedInArticlePasteHtmlEnglishOnly's refusal below.
 *
 * Unit-tested in __tests__/linkedin-article-paste-pure.test.ts.
 */

export interface LinkedInArticlePasteBody {
  /** The working headline, extracted from the body's first non-blank line. "" when the body opens directly with a tag (no plain-text headline line to extract). */
  headline: string;
  /** The transformed HTML, ready to place on the clipboard as text/html for LinkedIn's Article editor. */
  html: string;
}

// ─── Headline extraction ─────────────────────────────────────────────────────

/** Normalises CRLF to LF and strips the leading-whitespace-per-line convention the stored source uses. */
function normalizeLineEndings(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/(^|\n)[ \t]+/g, "$1");
}

/**
 * The first non-blank line is the working headline, UNLESS it is already a
 * tag (a body that opens directly with e.g. <h1> or <p> gets no implicit
 * headline extraction). LinkedIn takes the article title in its own field,
 * so the headline is removed from the body to avoid duplicating it there.
 */
function extractHeadline(s: string): { headline: string; rest: string } {
  const lines = s.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx === -1 || /^</.test(lines[firstIdx].trim())) {
    return { headline: "", rest: s };
  }
  const headline = lines[firstIdx].trim();
  lines.splice(firstIdx, 1);
  return { headline, rest: lines.join("\n") };
}

// ─── Links ────────────────────────────────────────────────────────────────────

/**
 * Trims a captured link label down to the phrase that actually names the
 * destination: everything after the FINAL colon (a lead-in like "Related
 * reading on the DRG Law website:" is dropped), then any leading "and "/"or "
 * (optionally "the ") connector between two links in the same sentence.
 */
function tightenLabel(label: string): string {
  return label
    .trim()
    .replace(/^.*:\s*/, "")
    .replace(/^(?:and|or)\s+(?:the\s+)?/i, "")
    .trim();
}

/**
 * "label (https://...)" -> a real anchor, hung on the tightened label so the
 * lead-in prose and the connector between two links stay outside the anchor
 * text. Restricted to http(s) URLs with no whitespace, so ordinary
 * parenthetical prose is never swallowed.
 */
function convertLabelledLinks(s: string): string {
  return s.replace(/([^<>()\n]+?)\s\((https?:\/\/[^\s)]+)\)/g, (_m: string, label: string, url: string) => {
    const tight = tightenLabel(label);
    // Slice the lead off the UNtrimmed capture so the whitespace separating
    // this link from the previous one survives.
    const idx = label.lastIndexOf(tight);
    const lead = idx > 0 ? label.slice(0, idx) : "";
    return `${lead}<a href="${url}">${tight}</a>`;
  });
}

/**
 * Citations read "See <authority>: <url>" or "Source: <cite>: <url>". Hangs
 * the link on the authority's name rather than on the raw URL -- a naked URL
 * as anchor text reads as an artefact, and the operator had to correct one
 * by hand on a published article. The lead-in ("See" / "Source:") stays
 * outside the anchor, the colon stays inside, and the URL stops being
 * displayed. Bounded to 200 chars so it cannot run backwards over a whole
 * paragraph, and anchored on the lead-in so it starts at the citation.
 */
function convertCitationLinks(s: string): string {
  return s.replace(
    /(Source:|See)\s+([^<>\n]{5,200}?):\s+(https?:\/\/[^\s<)]+)/g,
    (_m: string, lead: string, cite: string, url: string) => `${lead} <a href="${url}">${cite.trim()}:</a>`,
  );
}

/** Anything still bare links itself, so a URL is never left inert merely because it did not match the citation shape. */
function convertBareLinks(s: string): string {
  return s.replace(/(?<!href=")(?<!>)(https?:\/\/[^\s<)]+)(?![^<]*<\/a>)/g, '<a href="$1">$1</a>');
}

// ─── Decision Box (structural, not text-keyed -- gap 1 fix) ──────────────────

/** A run of 2+ "<p>N. ...</p>" paragraphs -- the shape a Decision Box's numbered steps arrive in. */
const NUMBERED_PARAGRAPH_RUN_SOURCE = "(?:<p>\\s*\\d+\\.\\s*[\\s\\S]*?<\\/p>\\s*){2,}";

/** Converts a numbered-paragraph run to separately preserved bold-number paragraphs. */
function numberedParagraphs(block: string): string {
  return [...block.matchAll(/<p>\s*(\d+)\.\s*([\s\S]*?)<\/p>/g)]
    .map((m) => `<p><strong>${m[1]}.</strong> ${m[2].trim()}</p>`)
    .join("");
}

/**
 * Decision Box detection: an <h2> immediately followed by a run of 2+
 * numbered <p> paragraphs IS a Decision Box, regardless of its wording. That
 * single match separates the numbered run into stable paragraphs AND prepends the
 * section-divider <hr> before the heading, in one step -- structural
 * detection, not keyed to any specific heading text, so it holds for any
 * week's Decision Box.
 *
 * The heading-text capture is `[^<]*`, NOT `[\s\S]*?`, and that is load-
 * bearing, not a style choice: this pattern's suffix (the numbered-paragraph
 * run) legitimately fails to match for every ordinary Subheading and for the
 * FAQ heading, and a lazy `[\s\S]*?` -- unlike every other capture in this
 * module, which is built from a negated character class for exactly this
 * reason -- backtracks by expanding one character at a time on failure. Since
 * `[\s\S]` does not exclude `<`, that expansion happily crosses OTHER
 * headings' own `<h2>`/`</h2>` boundaries looking for some later heading that
 * IS followed by a numbered run, silently fusing every heading in between
 * into one bogus match. `[^<]*` cannot cross a tag boundary at all, so a
 * heading whose own immediate suffix does not match simply fails outright,
 * exactly as intended, and the engine moves on to test the next real <h2>.
 *
 * A numbered-paragraph run with no <h2> directly above it (not seen in
 * practice, but the original tolerated it via a separate, unconditional
 * promotion regex) still separates into numbered paragraphs, just without a divider: that is
 * the fallback pass below, which only ever sees runs the first pass did not
 * already consume.
 */
function decisionBoxAndNumberedLists(s: string): string {
  const withHeadings = s.replace(
    new RegExp(`<h2>([^<]*)<\\/h2>(\\s*)(${NUMBERED_PARAGRAPH_RUN_SOURCE})`, "g"),
    (_m: string, headingText: string, gap: string, listBlock: string) =>
      `<hr><p><strong>${headingText}</strong></p>${gap}${numberedParagraphs(listBlock)}`,
  );
  const separate = withHeadings.replace(new RegExp(NUMBERED_PARAGRAPH_RUN_SOURCE, "g"), (block: string) =>
    numberedParagraphs(block),
  );

  // Production imports keep a Decision Box's numbered lines in one paragraph
  // when the source uses line breaks without blank lines. Split that shape too.
  return separate.replace(/<p>\s*(1\.\s[\s\S]*?\s2\.\s[\s\S]*?)<\/p>/g, (_m: string, inner: string) => {
    const items = inner.trim().split(/\s+(?=\d+\.\s)/);
    if (items.length < 2 || !items.every((item) => /^\d+\.\s/.test(item))) return _m;
    return items
      .map((item) => item.replace(/^(\d+)\.\s*([\s\S]*)$/, `<p><strong>$1.</strong> $2</p>`))
      .join("");
  });
}

// ─── Five-Line Brief ──────────────────────────────────────────────────────────

const BRIEF_LABELS = ["Risk", "Price", "Timeline", "Decision", "Next step"];

/** Five-Line Brief -> one paragraph per line, with the label bold. */
function convertFiveLineBrief(s: string): string {
  // The current production body keeps all five lines in one paragraph. Handle
  // that form first so the Risk capture cannot swallow the remaining labels.
  let out = s.replace(
    /<p>\s*Risk:\s*([\s\S]*?)\s+Price:\s*([\s\S]*?)\s+Timeline:\s*([\s\S]*?)\s+Decision:\s*([\s\S]*?)\s+Next step:\s*([\s\S]*?)<\/p>/,
    (_m, risk, price, timeline, decision, nextStep) =>
      [
        ["Risk", risk],
        ["Price", price],
        ["Timeline", timeline],
        ["Decision", decision],
        ["Next step", nextStep],
      ]
        .map(([label, text]) => `<p><strong>${label}:</strong> ${String(text).trim()}</p>`)
        .join(""),
  );
  for (const label of BRIEF_LABELS) {
    out = out.replace(
      new RegExp(`<p>\\s*${label}:\\s*([\\s\\S]*?)<\\/p>`),
      `<p><strong>${label}:</strong> $1</p>`,
    );
  }
  return out;
}

// ─── FAQ ────────────────────────────────────────────────────────────────────

/**
 * FAQ -> paragraph pairs, question bold, answer italic. Italics here are one
 * of exactly two sanctioned LinkedIn-only exceptions to the no-italics rule
 * (the other is the disclaimer below). The terminator tolerates the
 * <strong> the disclaimer opens with, and also stops at the next <h2> (a
 * Decision Box heading, when the article has one) -- an article with no
 * Decision Box has only the disclaimer to stop at.
 */
function convertFaq(s: string): string {
  return s.replace(
    /<(?:h2|p)>\s*Frequently asked questions\s*<\/(?:h2|p)>([\s\S]*?)(?=<h[1-3]>|<p>\s*(?:A qualified next step|(?:<strong>)?\s*Legal information))/,
    (_m: string, block: string) => {
      const paras = [...block.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1].trim());
      const pairs: string[] = [];
      for (let i = 0; i + 1 < paras.length; i += 2) {
        pairs.push(`<p><strong>${paras[i]}</strong></p><p><em>${paras[i + 1]}</em></p>`);
      }
      return `<hr><p><strong>Frequently asked questions</strong></p>${pairs.join("")}`;
    },
  );
}

// ─── Disclaimer and closing dividers ──────────────────────────────────────────

/**
 * The DR-082 disclaimer: the second sanctioned italic exception. Never
 * alters the captured wording -- only wraps it in <em> and drops the
 * <strong> the stored body opens it with (bold-inside-italic is a third
 * treatment nobody asked for). A divider precedes it, separating the
 * disclaimer from whatever section came before.
 */
function convertDisclaimer(s: string): string {
  return s.replace(
    /<p>\s*(?:<strong>)?\s*(Legal information, not legal advice\.[\s\S]*?)<\/p>/,
    (_m: string, inner: string) => `<hr><p><em>${inner.replace(/<\/?strong>/g, "").trim()}</em></p>`,
  );
}

/** Divider between the disclaimer and the close (the related-reading links). */
function convertRelatedReadingDivider(s: string): string {
  return s.replace(/<p>Related reading on the DRG Law website:/, "<hr>$&");
}

// ─── Destination-safe headings ───────────────────────────────────────────────

/**
 * LinkedIn's current paste sanitizer flattens h2/h3 but reliably keeps strong
 * text. Convert stored heading tags and short standalone question paragraphs
 * into bold paragraphs, preserving the source's section boundaries.
 */
function destinationSafeHeadings(s: string): string {
  let out = s.replace(
    /(<hr>\s*)?<h[1-3]>([\s\S]*?)<\/h[1-3]>/g,
    (_m: string, divider: string | undefined, text: string) => `${divider ?? ""}<p><strong>${text}</strong></p>`,
  );
  out = out.replace(/<p>\s*([^<]{3,180}\?)\s*<\/p>/g, `<p><strong>$1</strong></p>`);
  out = out.replace(
    /<p>\s*(Decision Box|Frequently asked questions|A qualified next step)\s*<\/p>/g,
    `<hr><p><strong>$1</strong></p>`,
  );
  return out;
}

// ─── Entry points ─────────────────────────────────────────────────────────────

/**
 * The bare transform, ported from make-paste-kit.js's toLinkedInHtml.
 * ENGLISH ONLY -- see the module header. This function has no way to check
 * that itself: it does not know what a piece's locale column says. Never
 * wire this directly to a UI control; use toLinkedInArticlePasteHtmlEnglishOnly,
 * which enforces the check this one cannot.
 *
 * Ordering note: decisionBoxAndNumberedLists runs AFTER convertFaq, not
 * before, even though the original script's unconditional ol-promotion ran
 * before its FAQ step. That was safe there because the original's separate
 * hr-for-the-Decision-Box-heading step ran AFTER the FAQ step, so no <hr>
 * ever existed between the FAQ's own content and a following heading while
 * the FAQ regex was still running. This port FUSES the divider and the list
 * promotion into one step (that is the gap 1 fix), so if that fused step ran
 * before the FAQ step here, a Decision Box immediately after the FAQ would
 * already carry its <hr> by the time convertFaq's lazy, lookahead-bounded
 * capture ran -- and that capture would silently swallow and discard the
 * very <hr> this function just added, since it only reconstructs the FAQ
 * heading and freshly-built <li> items, not the raw text it captured.
 * Running decisionBoxAndNumberedLists after convertFaq avoids the collision
 * entirely: the FAQ region is already finalized, and decisionBoxAndNumberedLists
 * does not care about the FAQ's final paragraph pairs.
 */
export function toLinkedInArticleHtml(raw: string): LinkedInArticlePasteBody {
  let s = normalizeLineEndings(raw);
  const { headline, rest } = extractHeadline(s);
  s = rest;

  s = convertLabelledLinks(s);
  s = convertCitationLinks(s);
  s = convertBareLinks(s);
  s = convertFiveLineBrief(s);
  s = convertFaq(s);
  s = decisionBoxAndNumberedLists(s);
  s = convertDisclaimer(s);
  s = convertRelatedReadingDivider(s);
  s = destinationSafeHeadings(s);

  return { headline, html: s.trim() };
}

/**
 * True when `locale` is present and its BCP-47 primary language subtag is
 * "en" (case-insensitive) -- "en-CA", "en-US", "en", etc. Mirrors
 * languageLabel's own convention in deliverables-pure.ts (value.startsWith
 * ("en")) so the two checks can never silently disagree about what counts as
 * English. False for null, undefined, "", and anything else (including
 * "pt-BR").
 */
export function isEnglishLocale(locale: string | null | undefined): boolean {
  return typeof locale === "string" && locale.trim().toLocaleLowerCase().startsWith("en");
}

export type LinkedInArticlePasteResult =
  | ({ ok: true } & LinkedInArticlePasteBody)
  | { ok: false; reason: "unsupported-locale"; locale: string };

/**
 * The entry point real callers should use. Identical to toLinkedInArticleHtml
 * except it refuses to run against a non-English locale, returning a typed
 * refusal instead of silently producing wrong output (every pattern in this
 * module is English-only -- see the module header).
 *
 * `locale` is optional: a caller that has already confirmed English some
 * other way (a unit test exercising the transform itself, for instance) has
 * nothing to pass, and omitting it behaves exactly like the bare transform.
 * Every real UI caller has the piece's own `locale` column on hand (see
 * PublishKit.tsx) and must pass it -- that call site is the real enforcement
 * point this function backs up, not a substitute for it.
 */
export function toLinkedInArticlePasteHtmlEnglishOnly(
  raw: string,
  opts: { locale?: string | null } = {},
): LinkedInArticlePasteResult {
  const locale = opts.locale ?? null;
  if (locale !== null && !isEnglishLocale(locale)) {
    return { ok: false, reason: "unsupported-locale", locale };
  }
  return { ok: true, ...toLinkedInArticleHtml(raw) };
}
