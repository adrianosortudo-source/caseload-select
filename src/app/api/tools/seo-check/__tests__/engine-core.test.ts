import { describe, it, expect } from "vitest";
import {
  ipInBlockedRange,
  isSsrfBlocked,
  resolveScan,
  parseRobotsTxt,
  checkBotBlockedParsed,
  robotsPathMatchLength,
  normalizePageUrl,
  shouldSkipUrl,
  crawlUrlKey,
  classifyPageType,
  isWpDefaultContent,
  scoreUrlPriority,
  aiScoresFromItems,
  computeWeightedScore,
  decodeHtmlEntities,
  MAX_PAGES_HARD_CAP,
  SCAN_MODE_DEFAULTS,
  type CheckItem,
} from "../engine-core";

describe("ipInBlockedRange / SSRF ranges", () => {
  const blocked = [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "240.0.0.1",
    "::1", "fe80::1", "fe90::1", "fea0::1", "febf::1", "fec0::1", "feff::1",
    "fc00::1", "fdff::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
    "notanip",
    // NAT64 64:ff9b::/96 embedding a private/metadata IPv4
    "64:ff9b::a9fe:a9fe", "64:ff9b::169.254.169.254", "64:ff9b::0a00:0001",
    "64:ff9b::7f00:0001", "64:ff9b:0:0:0:0:a9fe:a9fe",
  ];
  const allowed = [
    "8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "93.184.216.34",
    "2606:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8",
    // NAT64 embedding a public IPv4 stays allowed
    "64:ff9b::0808:0808", "64:ff9b::8.8.8.8",
  ];
  it("blocks private/reserved/loopback/link-local/site-local/multicast", () => {
    for (const ip of blocked) expect(ipInBlockedRange(ip), ip).toBe(true);
  });
  it("allows global unicast", () => {
    for (const ip of allowed) expect(ipInBlockedRange(ip), ip).toBe(false);
  });
  it("blocks deprecated IPv6 site-local fec0::/10 fully", () => {
    expect(ipInBlockedRange("fec0::1")).toBe(true);
    expect(ipInBlockedRange("feff::1")).toBe(true);
    expect(ipInBlockedRange("fe7f::1")).toBe(false); // just below link-local
  });
  it("isSsrfBlocked covers literals + hostname blocklist, allows real hostnames", () => {
    expect(isSsrfBlocked("localhost")).toBe(true);
    expect(isSsrfBlocked("169.254.169.254")).toBe(true);
    expect(isSsrfBlocked("metadata.google.internal")).toBe(true);
    expect(isSsrfBlocked("127.0.0.1")).toBe(true);
    expect(isSsrfBlocked("example.com")).toBe(false);
  });
});

describe("resolveScan", () => {
  it("uses scan-mode defaults when maxPages absent", () => {
    expect(resolveScan({ scanMode: "quick" })).toEqual({ scanMode: "quick", maxPages: SCAN_MODE_DEFAULTS.quick });
    expect(resolveScan({ scanMode: "standard" }).maxPages).toBe(25);
    expect(resolveScan({ scanMode: "deep" }).maxPages).toBe(50);
  });
  it("defaults to quick mode when neither provided", () => {
    expect(resolveScan({})).toEqual({ scanMode: "quick", maxPages: 10 });
  });
  it("clamps explicit maxPages to [1,75] and floors it", () => {
    expect(resolveScan({ maxPages: 1000 }).maxPages).toBe(MAX_PAGES_HARD_CAP);
    expect(resolveScan({ maxPages: 0 }).maxPages).toBe(1);
    expect(resolveScan({ maxPages: -5 }).maxPages).toBe(1);
    expect(resolveScan({ maxPages: 7.9 }).maxPages).toBe(7);
  });
  it("rejects NaN / non-finite maxPages and falls back to mode default", () => {
    expect(resolveScan({ maxPages: NaN, scanMode: "standard" }).maxPages).toBe(25);
    expect(resolveScan({ maxPages: "12" as unknown as number }).maxPages).toBe(10);
  });
});

describe("robots.txt precedence + longest match", () => {
  it("specific agent group overrides wildcard", () => {
    const r = parseRobotsTxt("User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n");
    expect(checkBotBlockedParsed(r, "GPTBot", "/anything")).toBe(false);
    expect(checkBotBlockedParsed(r, "OtherBot", "/anything")).toBe(true);
  });
  it("merges multiple groups for the same agent before longest-match", () => {
    const r = parseRobotsTxt("User-agent: GPTBot\nDisallow: /private\n\nUser-agent: GPTBot\nAllow: /private/public\n");
    expect(checkBotBlockedParsed(r, "GPTBot", "/private")).toBe(true);
    expect(checkBotBlockedParsed(r, "GPTBot", "/private/public")).toBe(false); // longer Allow wins
  });
  it("empty Disallow means allow all", () => {
    const r = parseRobotsTxt("User-agent: *\nDisallow:\n");
    expect(checkBotBlockedParsed(r, "GPTBot", "/anything")).toBe(false);
  });
  it("honours $ end-anchor and * wildcard", () => {
    expect(robotsPathMatchLength("/a.pdf", "/*.pdf$")).not.toBeNull();
    expect(robotsPathMatchLength("/a.pdf?x=1", "/*.pdf$")).toBeNull();
    const r = parseRobotsTxt("User-agent: *\nDisallow: /*.pdf$\n");
    expect(checkBotBlockedParsed(r, "Googlebot", "/files/report.pdf")).toBe(true);
    expect(checkBotBlockedParsed(r, "Googlebot", "/files/report.html")).toBe(false);
  });
  it("parses Sitemap lines", () => {
    const r = parseRobotsTxt("Sitemap: https://x.com/sitemap.xml\nUser-agent: *\nDisallow:\n");
    expect(r.sitemaps).toContain("https://x.com/sitemap.xml");
  });
});

describe("URL normalization / skip / page-type", () => {
  it("normalizes and strips fragments, rejects non-http", () => {
    expect(normalizePageUrl("/about#team", "https://x.com")).toBe("https://x.com/about");
    expect(normalizePageUrl("mailto:a@b.com", "https://x.com")).toBeNull();
    expect(normalizePageUrl("javascript:void(0)", "https://x.com")).toBeNull();
  });
  it("skips assets, feeds, admin, and >2 query params", () => {
    expect(shouldSkipUrl("https://x.com/a.pdf")).toBe(true);
    expect(shouldSkipUrl("https://x.com/style.css")).toBe(true);
    expect(shouldSkipUrl("https://x.com/feed/")).toBe(true);
    expect(shouldSkipUrl("https://x.com/wp-login.php")).toBe(true);
    expect(shouldSkipUrl("https://x.com/?attachment_id=910")).toBe(true);
    expect(shouldSkipUrl("https://x.com/?p=123")).toBe(true);
    expect(shouldSkipUrl("https://x.com/category/real-estate/")).toBe(true);
    expect(shouldSkipUrl("https://x.com/tag/tax/")).toBe(true);
    expect(shouldSkipUrl("https://x.com/p?a=1&b=2&c=3")).toBe(true);
    expect(shouldSkipUrl("https://x.com/practice/real-estate")).toBe(false);
  });
  it("classifies law-firm page types", () => {
    expect(classifyPageType("https://x.com/")).toBe("homepage");
    expect(classifyPageType("https://x.com/contact-us")).toBe("contact");
    expect(classifyPageType("https://x.com/practice-areas/family")).toBe("practice");
    expect(classifyPageType("https://x.com/practices/professional-regulation-and-liability")).toBe("practice");
    expect(classifyPageType("https://x.com/tax-law/")).toBe("practice");
    expect(classifyPageType("https://x.com/real-estate-law/")).toBe("practice");
    expect(classifyPageType("https://x.com/wills-and-estates/")).toBe("practice");
    expect(classifyPageType("https://x.com/notary-services/")).toBe("practice");
    expect(classifyPageType("https://x.com/our-team/jane-doe")).toBe("attorney");
    expect(classifyPageType("https://x.com/locations/toronto")).toBe("location");
    expect(classifyPageType("https://x.com/faq")).toBe("faq");
    expect(classifyPageType("https://x.com/blog/post-1")).toBe("blog");
    expect(classifyPageType("https://x.com/privacy")).toBe("policy");
    expect(classifyPageType("https://x.com/something-else")).toBe("other");
  });
  it("never classifies a query-string URL as the homepage (jsmlaw fuseaction case)", () => {
    // ColdFusion routes whole page trees through the root path. Classifying
    // /?fuseaction=... as "homepage" gave utility cruft top crawl priority
    // and produced five "/" homepage rows in one 50-page report.
    expect(classifyPageType("https://www.jsmlaw.ca/?fuseaction=store.terms")).toBe("policy");
    expect(classifyPageType("https://www.jsmlaw.ca/?fuseaction=store.shipping")).toBe("policy");
    expect(classifyPageType("https://www.jsmlaw.ca/?fuseaction=store.returns")).toBe("policy");
    expect(classifyPageType("https://x.com/?fuseaction=member.contactUs")).toBe("contact");
    expect(classifyPageType("https://x.com/?fuseaction=content.page&id=4")).toBe("other");
    // The bare root stays the homepage.
    expect(classifyPageType("https://x.com/")).toBe("homepage");
  });
  it("detects WordPress starter content by slug AND body fingerprint (chaabanelaw case)", () => {
    const sampleBody = `<html><body><h1>Sample Page</h1><p>This is an example page. As a new WordPress user, you should go to your dashboard...</p></body></html>`;
    const helloBody = `<html><body><h1>Hello world!</h1><p>Welcome to WordPress. This is your first post. Edit or delete it, then start writing!</p></body></html>`;
    // Slug + boilerplate body => default content.
    expect(isWpDefaultContent("https://x.com/sample-page/", sampleBody)).toBe(true);
    expect(isWpDefaultContent("https://x.com/2020/09/02/hello-world/", helloBody)).toBe(true);
    // Right slug but the firm replaced the body with real content => NOT default
    // (a firm can edit the Sample Page in place and keep the slug).
    const realContent = `<html><body><h1>Criminal Defence</h1><p>Our firm represents clients across Toronto in serious criminal matters.</p></body></html>`;
    expect(isWpDefaultContent("https://x.com/sample-page/", realContent)).toBe(false);
    expect(isWpDefaultContent("https://x.com/2020/09/02/hello-world/", realContent)).toBe(false);
    // Real page that merely mentions the boilerplate phrase but is not the slug.
    expect(isWpDefaultContent("https://x.com/practice/family-law", sampleBody)).toBe(false);
    // Boilerplate body stripped but the default TITLE remains and no real
    // content was written (field case: chaabanelaw's hello-world lost its
    // default text yet still titles itself "Hello world!").
    const strippedTitleOnly = `<html><head><title>Hello world! | Nadia Chaabane Law</title></head><body><h1>Hello world!</h1></body></html>`;
    expect(isWpDefaultContent("https://x.com/2020/09/02/hello-world/", strippedTitleOnly)).toBe(true);
    // Repurposed in place: real title + real content => scored normally.
    const repurposed = `<html><head><title>Criminal Defence in Toronto | Firm</title></head><body><h1>Criminal Defence</h1><p>Real content here.</p></body></html>`;
    expect(isWpDefaultContent("https://x.com/sample-page/", repurposed)).toBe(false);
  });
  it("skips transactional pages routed through query strings (jsmlaw newsletter form)", () => {
    // /?fuseaction=member.registerShort is a newsletter-signup form, correctly
    // noindexed. Crawling it burned a page slot and fired a Critical
    // "remove the noindex" finding on a page that must stay noindexed.
    expect(shouldSkipUrl("https://www.jsmlaw.ca/?fuseaction=member.registerShort")).toBe(true);
    expect(shouldSkipUrl("https://x.com/?fuseaction=member.login")).toBe(true);
    expect(shouldSkipUrl("https://x.com/newsletter-signup")).toBe(true);
    expect(shouldSkipUrl("https://x.com/unsubscribe")).toBe(true);
    // Real content pages with a single benign query param still crawl.
    expect(shouldSkipUrl("https://x.com/?fuseaction=content.page&id=4")).toBe(false);
    expect(shouldSkipUrl("https://x.com/practice/real-estate")).toBe(false);
  });
  it("dedupes crawl URL variants across protocol, www, slash, and query order", () => {
    expect(crawlUrlKey("http://www.x.com/contact-us")).toBe(crawlUrlKey("https://x.com/contact-us/"));
    expect(crawlUrlKey("https://x.com/a?b=2&a=1#frag")).toBe(crawlUrlKey("https://www.x.com/a/?a=1&b=2"));
  });
  it("priority ranks homepage and contact above blog", () => {
    expect(scoreUrlPriority("https://x.com/")).toBeGreaterThan(scoreUrlPriority("https://x.com/blog/x"));
    expect(scoreUrlPriority("https://x.com/contact")).toBeGreaterThan(scoreUrlPriority("https://x.com/blog/x"));
  });
});

describe("AI search vs policy split", () => {
  const mk = (status: CheckItem["status"], label: string): CheckItem => ({ label, status, detail: "" });
  it("excludes training-bot control from search; uses it alone for policy", () => {
    const items: CheckItem[] = [
      mk("pass", "AI search bot access"),
      mk("pass", "Entity description"),
      mk("fail", "AI training bot control"),
    ];
    const { search, policy } = aiScoresFromItems(items);
    expect(search).toBe(100); // both search items pass
    expect(policy).toBe(10); // training control fails
  });
  it("returns safe defaults on empty items", () => {
    const { search, policy } = aiScoresFromItems([]);
    expect(search).toBe(0);
    expect(policy).toBe(50);
    expect(Number.isNaN(search)).toBe(false);
  });
});

describe("computeWeightedScore guards", () => {
  it("returns 0 (not NaN) for empty categories", () => {
    const s = computeWeightedScore([]);
    expect(s).toBe(0);
    expect(Number.isNaN(s)).toBe(false);
  });
  it("handles zero-max categories without NaN", () => {
    const s = computeWeightedScore([{ name: "On-Page SEO", score: 0, maxScore: 0, items: [] }]);
    expect(Number.isNaN(s)).toBe(false);
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes the Squarespace title-separator entity to a single character", () => {
    // Field case marathonlaw.ca: "Contact &mdash; Marathon Law" counted the
    // entity as 7 characters and printed it verbatim in reports.
    const decoded = decodeHtmlEntities("Contact &mdash; Marathon Law");
    expect(decoded).toBe(`Contact ${String.fromCharCode(0x2014)} Marathon Law`);
    expect(decoded.length).toBe(22);
  });

  it("decodes named, decimal, and hex entities", () => {
    expect(decodeHtmlEntities("Smith &amp; Jones")).toBe("Smith & Jones");
    expect(decodeHtmlEntities("A&#8212;B")).toBe(`A${String.fromCharCode(0x2014)}B`);
    expect(decodeHtmlEntities("A&#x2014;B")).toBe(`A${String.fromCharCode(0x2014)}B`);
    expect(decodeHtmlEntities("It&rsquo;s")).toBe("It’s");
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a b");
  });

  it("passes unknown entities and plain text through unchanged", () => {
    expect(decodeHtmlEntities("a &unknownthing; b")).toBe("a &unknownthing; b");
    expect(decodeHtmlEntities("no entities here")).toBe("no entities here");
    expect(decodeHtmlEntities("bad numeric &#xZZ; stays")).toBe("bad numeric &#xZZ; stays");
  });
});
