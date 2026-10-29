import { describe, expect, it } from "vitest";
import { parseIndexDirectives } from "../index-directives";

describe("parseIndexDirectives", () => {
  it("combines every generic robots meta tag regardless of order", () => {
    const cases = [
      '<meta name="robots" content="index"><meta name="robots" content="noindex">',
      '<meta name="robots" content="noindex"><meta name="robots" content="index">',
    ];
    for (const html of cases) expect(parseIndexDirectives(html).noindex).toBe("observed");
  });

  it("accepts case, attribute order, spaces, unquoted attributes, and entity values", () => {
    const html = '<META CONTENT = no&#105;ndex NAME = ROBOTS><meta content="index" name="robots">';
    const result = parseIndexDirectives(html);
    expect(result.noindex).toBe("observed");
    expect(result.observations[0].explicitDirectives).toContain("noindex");
  });

  it("applies generic and Googlebot instructions to the Google assessment", () => {
    const generic = parseIndexDirectives('<meta name="robots" content="index, follow">');
    const google = parseIndexDirectives('<meta name="googlebot" content="noindex, nofollow">');
    expect(generic).toMatchObject({ noindex: "not-observed", nofollow: "not-observed" });
    expect(google).toMatchObject({ noindex: "observed", nofollow: "observed" });
  });

  it("does not treat unrelated meta names as crawler scope", () => {
    const result = parseIndexDirectives('<meta name="description" content="noindex"><meta name="robots" content="index">');
    expect(result.noindex).toBe("not-observed");
    expect(result.observations).toHaveLength(1);
  });

  it("keeps Google News, Bing, and other crawler scopes out of Google's scored scope", () => {
    const result = parseIndexDirectives(
      '<meta name="googlebot-news" content="noindex"><meta name="bingbot" content="none"><meta name="otherbot" content="noindex">'
    );
    expect(result.noindex).toBe("not-observed");
    expect(result.nofollow).toBe("not-observed");
    expect(result.observations.map((item) => item.scope)).toEqual(["googlebot-news", "bingbot", "other"]);
    expect(result.observations[2].googleApplicability).toBe("not-applicable");
  });

  it("ignores comments and script raw text that resemble robots meta tags", () => {
    const html = '<!-- <meta name="robots" content="noindex"> --><script>"<meta name=robots content=noindex>"</script><meta name="robots" content="index">';
    const result = parseIndexDirectives(html);
    expect(result.noindex).toBe("not-observed");
    expect(result.observations).toHaveLength(1);
  });

  it("ignores meta-like content inside embedded frames", () => {
    const result = parseIndexDirectives('<iframe><meta name="robots" content="noindex"></iframe><meta name="robots" content="index">');
    expect(result.noindex).toBe("not-observed");
    expect(result.observations).toHaveLength(1);
  });

  it("marks robots metadata inside noscript as unknown instead of a confident directive", () => {
    const result = parseIndexDirectives('<noscript><meta name="robots" content="noindex"></noscript>');
    expect(result.noindex).toBe("unknown");
    expect(result.observations[0]).toMatchObject({ googleApplicability: "unknown", explicitDirectives: ["noindex"] });
  });

  it("keeps an unrelated crawler inside noscript out of Google's unknown scope", () => {
    const result = parseIndexDirectives('<noscript><meta name="otherbot" content="noindex"></noscript>');
    expect(result.noindex).toBe("not-observed");
    expect(result.observations[0]).toMatchObject({ scope: "other", googleApplicability: "not-applicable" });
  });

  it("resets noscript scope before a following generic robots element", () => {
    const result = parseIndexDirectives('<noscript><meta name="robots" content="noindex"></noscript><meta name="robots" content="index">');
    expect(result.noindex).toBe("unknown");
    expect(result.observations.map((item) => item.googleApplicability)).toEqual(["unknown", "applicable"]);
  });

  it("ignores template content while collecting a following live robots element", () => {
    const result = parseIndexDirectives('<template><meta name="robots" content="noindex"></template><meta name="robots" content="index">');
    expect(result.noindex).toBe("not-observed");
    expect(result.observations).toHaveLength(1);
  });

  it("expands a standalone none directive to noindex and nofollow", () => {
    expect(parseIndexDirectives('<meta name="robots" content="none">')).toMatchObject({ noindex: "observed", nofollow: "observed" });
  });

  it("matches exact directive tokens, not similar words or parameter values", () => {
    const result = parseIndexDirectives('<meta name="robots" content="notnoindex, noimageindex, indexifembedded, max-image-preview:none, max-image-preview: none, max-snippet: 0">');
    expect(result.noindex).toBe("not-observed");
  });

  it("does not confuse parameter colons or unavailable-after dates with crawler scopes", () => {
    const result = parseIndexDirectives("", ["max-image-preview:none, unavailable_after: 25 Jun 2010 15:00:00 PST"]);
    expect(result.noindex).toBe("not-observed");
    expect(result.observations[0].scope).toBe("generic");
  });

  it("applies an explicit Googlebot X-Robots-Tag to Google", () => {
    const result = parseIndexDirectives("", ["Googlebot: noindex, nofollow"]);
    expect(result).toMatchObject({ noindex: "observed", nofollow: "observed" });
    expect(result.observations[0]).toMatchObject({ scope: "googlebot", crawlerToken: "Googlebot", source: "x-robots-tag" });
  });

  it("does not globalize an explicit Bingbot or Googlebot-News X-Robots-Tag", () => {
    const bing = parseIndexDirectives("", ["Bingbot: noindex"]);
    const news = parseIndexDirectives("", ["Googlebot-News: noindex"]);
    expect(bing.noindex).toBe("not-observed");
    expect(news.noindex).toBe("not-observed");
    expect(bing.observations[0].googleApplicability).toBe("not-applicable");
    expect(news.observations[0].googleApplicability).toBe("not-applicable");
  });

  it("does not make a sole other-crawler header unknown to Google", () => {
    const result = parseIndexDirectives("", ["Otherbot: noindex"]);
    expect(result.noindex).toBe("not-observed");
    expect(result.observations[0].googleApplicability).toBe("not-applicable");
  });

  it("keeps a known unrelated-bot noindex separate from an ambiguous trailing nofollow", () => {
    const result = parseIndexDirectives("", ["Otherbot: noindex, nofollow"]);
    expect(result.noindex).toBe("not-observed");
    expect(result.nofollow).toBe("unknown");
    expect(result.observations).toMatchObject([
      { scope: "other", googleApplicability: "not-applicable", effectiveDirectives: ["noindex"] },
      { scope: "unknown", googleApplicability: "unknown", effectiveDirectives: ["nofollow"] },
    ]);
  });

  it("keeps uncertainty through multiple bare directives after an unrelated crawler prefix", () => {
    const result = parseIndexDirectives("", ["otherbot: follow, nofollow, noindex"]);
    expect(result.noindex).toBe("unknown");
    expect(result.nofollow).toBe("unknown");
    expect(result.observations.filter((item) => item.scope === "unknown")).toHaveLength(2);
  });

  it("keeps bare directives after a Googlebot prefix Google-applicable", () => {
    const result = parseIndexDirectives("", ["googlebot: follow, noindex, nofollow"]);
    expect(result.noindex).toBe("observed");
    expect(result.nofollow).toBe("observed");
    expect(result.observations.filter((item) => item.scope === "unknown")).toMatchObject([
      { googleApplicability: "applicable", effectiveDirectives: ["noindex"] },
      { googleApplicability: "applicable", effectiveDirectives: ["nofollow"] },
    ]);
  });

  it("treats unprefixed header directives as generic unless a flattened prior scope makes that ambiguous", () => {
    expect(parseIndexDirectives("", ["noindex, Bingbot: follow"]).noindex).toBe("observed");
    expect(parseIndexDirectives("", ["Bingbot: noindex, noindex"]).noindex).toBe("unknown");
  });

  it("preserves field boundaries supplied to the pure parser", () => {
    const result = parseIndexDirectives("", ["Bingbot: noindex", "noindex"]);
    expect(result.noindex).toBe("observed");
    expect(result.observations.map((item) => item.googleApplicability)).toEqual(["not-applicable", "applicable"]);
  });

  it("keeps an explicit Google noindex when another flattened directive is ambiguous", () => {
    const result = parseIndexDirectives("", ["Googlebot: noindex, Bingbot: noindex, noindex"]);
    expect(result.noindex).toBe("observed");
    expect(result.observations.some((item) => item.googleApplicability === "unknown")).toBe(true);
  });

  it("marks malformed crawler-scope syntax unknown", () => {
    const result = parseIndexDirectives("", [": noindex"]);
    expect(result.noindex).toBe("unknown");
    expect(result.limitations.join(" ")).toContain("malformed crawler scope");
  });

  it("marks a directive beyond the token bound unknown unless an applicable one was already seen", () => {
    const manyTokens = Array.from({ length: 128 }, () => "index").join(" ");
    expect(parseIndexDirectives(`<meta name="robots" content="${manyTokens} noindex">`).noindex).toBe("unknown");
    expect(parseIndexDirectives(`<meta name="robots" content="noindex ${manyTokens}">`).noindex).toBe("observed");
  });

  it("does not let an unrelated crawler's token bound make Google's scope unknown", () => {
    const manyTokens = Array.from({ length: 128 }, () => "index").join(" ");
    const result = parseIndexDirectives(`<meta name="bingbot" content="${manyTokens} noindex">`);
    expect(result.noindex).toBe("not-observed");
    expect(result.observations[0]).toMatchObject({ googleApplicability: "not-applicable" });
  });

  it("marks an absent directive unknown when the observation bound hides later tags", () => {
    const unrelated = '<meta name="otherbot" content="follow">'.repeat(513);
    const result = parseIndexDirectives(`${unrelated}<meta name="robots" content="noindex">`);
    expect(result.noindex).toBe("unknown");
    expect(result.limitations.join(" ")).toContain("observation limit");
  });
});
