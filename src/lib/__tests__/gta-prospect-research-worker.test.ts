import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { GtaProspectResearchWorkItem } from "../gta-prospect-research-work-queue";
import { researchGtaProspectWorkItem } from "../gta-prospect-research-worker";

const item: GtaProspectResearchWorkItem = {
  id: "00000000-0000-0000-0000-000000000001",
  sourceSystem: "legacy_gta_domain_discovery_v1",
  sourceRecordKey: "legacy-gta-directory-2026-07:example",
  candidateName: "Example Law",
  canonicalDomain: "example.test",
  candidateAddress: "1 Example Street, Toronto, ON",
  sourceUrls: ["https://example.test/"],
  candidateSnapshot: {},
  priority: 1,
  state: "leased",
  leaseOwner: "worker-a",
  leaseExpiresAt: "2026-09-14T13:00:00Z",
  attemptCount: 1,
  nextAttemptAt: null,
  lastError: null,
  resolution: null,
  canonicalFirmId: null,
};

const now = () => new Date("2026-09-14T12:00:00.000Z");
const terms = "Terms reviewed for public research.";
const policy = {
  host: "example.test",
  reviewedAt: "2026-09-13T12:00:00.000Z",
  expiresAt: "2026-10-14T12:00:00.000Z",
  termsUrl: "https://example.test/terms",
  termsSha256: createHash("sha256").update(terms).digest("hex"),
  allowedPathPrefixes: ["/"],
};

const resolver = async () => ["93.184.216.34"];

describe("GTA prospect research worker", () => {
  it("fails closed when the host has no reviewed terms policy", async () => {
    const fetch = vi.fn();
    const result = await researchGtaProspectWorkItem(item, { workerId: "worker-a", policies: [], fetch, resolveHost: resolver, now });
    expect(result.failure).toMatchObject({ code: "terms_review_required" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses private DNS answers before making public HTTP requests", async () => {
    const fetch = vi.fn();
    const result = await researchGtaProspectWorkItem(item, { workerId: "worker-a", policies: [policy], fetch, resolveHost: async () => ["127.0.0.1"], now });
    expect(result.failure).toMatchObject({ code: "transient_fetch_failure" });
    expect(result.capsule.failure).toContain("Unsafe DNS result");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops before the candidate page when robots disallow it", async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      const value = url.toString();
      if (value.endsWith("/terms")) return new Response(terms, { status: 200 });
      if (value.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /", { status: 200 });
      throw new Error(`unexpected request ${value}`);
    });
    const result = await researchGtaProspectWorkItem(item, { workerId: "worker-a", policies: [policy], fetch, resolveHost: resolver, now });
    expect(result.failure).toMatchObject({ code: "robots_disallow" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("captures source evidence and visible signals using GET-only, same-host requests", async () => {
    const calls: RequestInit[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      const value = url.toString();
      if (value.endsWith("/terms")) return new Response(terms, { status: 200, headers: { "content-type": "text/html" } });
      if (value.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200 });
      if (value === "https://example.test/") return new Response('<a href="/team">Our team</a><a href="mailto:founder@example.test">Email</a><form action="/contact"></form><script src="https://widget.intercom.io/x.js"></script>Jane Doe, Founder and Managing Partner', { status: 200 });
      if (value === "https://example.test/team") return new Response('<a href="tel:+14165550123">Call</a><a href="https://calendly.com/example">Book</a>', { status: 200 });
      throw new Error(`unexpected request ${value}`);
    });

    const result = await researchGtaProspectWorkItem(item, { workerId: "worker-a", policies: [policy], fetch, resolveHost: resolver, now });
    expect(result.failure).toBeNull();
    expect(result.capsule.evidence.map((entry) => entry.url)).toEqual(["https://example.test/terms", "https://example.test/robots.txt", "https://example.test/", "https://example.test/team"]);
    expect(result.capsule.visibleSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "public_email", value: "founder@example.test" }),
      expect.objectContaining({ kind: "owner_name", value: "Jane Doe" }),
      expect.objectContaining({ kind: "form" }),
      expect.objectContaining({ kind: "chat" }),
      expect.objectContaining({ kind: "booking" }),
    ]));
    expect(result.capsule.geographyHandoff).toEqual([expect.objectContaining({ candidateAddress: item.candidateAddress, coordinate: null, boundary: null })]);
    expect(calls.every((request) => request.method === "GET" && request.redirect === "manual" && request.credentials === "omit")).toBe(true);
  });

  it("defers rather than using a terms page whose reviewed hash changed", async () => {
    const fetch = vi.fn(async () => new Response("changed terms", { status: 200 }));
    const result = await researchGtaProspectWorkItem(item, { workerId: "worker-a", policies: [policy], fetch, resolveHost: resolver, now });
    expect(result.failure).toMatchObject({ code: "terms_changed", retryAfterMinutes: 10_080 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("allows only an explicitly reviewed apex-to-www redirect", async () => {
    const aliasPolicy = {
      ...policy,
      allowedHostAliases: ["www.example.test"],
      termsUrl: "https://www.example.test/terms",
    };
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      const value = url.toString();
      if (value === "https://www.example.test/terms") return new Response(terms, { status: 200 });
      if (value === "https://example.test/robots.txt") return new Response(null, { status: 301, headers: { location: "https://www.example.test/robots.txt" } });
      if (value === "https://www.example.test/robots.txt") return new Response("User-agent: *\nAllow: /", { status: 200 });
      if (value === "https://example.test/") return new Response(null, { status: 301, headers: { location: "https://www.example.test/" } });
      if (value === "https://www.example.test/") return new Response('<a href="/team">Our team</a>', { status: 200 });
      if (value === "https://www.example.test/team") return new Response("Team", { status: 200 });
      throw new Error(`unexpected request ${value}`);
    });

    const result = await researchGtaProspectWorkItem(item, { workerId: "worker-a", policies: [aliasPolicy], fetch, resolveHost: resolver, now });

    expect(result.failure).toBeNull();
    expect(result.capsule.evidence.map((entry) => entry.url)).toEqual([
      "https://www.example.test/terms",
      "https://www.example.test/robots.txt",
      "https://www.example.test/",
      "https://www.example.test/team",
    ]);
  });

  it("rejects an apex-to-www redirect unless that alias was explicitly reviewed", async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      const value = url.toString();
      if (value.endsWith("/terms")) return new Response(terms, { status: 200 });
      if (value.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200 });
      if (value === "https://example.test/") return new Response(null, { status: 301, headers: { location: "https://www.example.test/" } });
      throw new Error(`unexpected request ${value}`);
    });

    const result = await researchGtaProspectWorkItem(item, { workerId: "worker-a", policies: [policy], fetch, resolveHost: resolver, now });

    expect(result.failure).toMatchObject({ code: "transient_fetch_failure" });
    expect(result.capsule.failure).toContain("Unsafe or unapproved research target");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects arbitrary aliases before making an HTTP request", async () => {
    const fetch = vi.fn();
    const result = await researchGtaProspectWorkItem(item, {
      workerId: "worker-a",
      policies: [{ ...policy, allowedHostAliases: ["cdn.example.test"] }],
      fetch,
      resolveHost: resolver,
      now,
    });

    expect(result.failure).toMatchObject({ code: "terms_review_required" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("permits only a complete documented no-published-terms review, without fetching a terms page", async () => {
    const missingHash = createHash("sha256").update("reviewed missing response").digest("hex");
    const noTermsPolicy = {
      host: "example.test",
      reviewedAt: "2026-09-13T12:00:00.000Z",
      expiresAt: "2026-10-14T12:00:00.000Z",
      noPublishedTermsReview: {
        kind: "no_published_terms" as const,
        attemptedUrls: ["/terms", "/terms-of-use", "/terms-and-conditions", "/terms-of-service"].map((pathname) => ({
          url: `https://example.test${pathname}`,
          status: 404 as const,
          bodySha256: missingHash,
        })),
      },
      allowedPathPrefixes: ["/"],
    };
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      const value = url.toString();
      if (value === "https://example.test/robots.txt") return new Response("User-agent: *\nAllow: /", { status: 200 });
      if (value === "https://example.test/") return new Response('<a href="/team">Our team</a>', { status: 200 });
      if (value === "https://example.test/team") return new Response("Team", { status: 200 });
      throw new Error(`unexpected request ${value}`);
    });

    const result = await researchGtaProspectWorkItem(item, { workerId: "worker-a", policies: [noTermsPolicy], fetch, resolveHost: resolver, now });

    expect(result.failure).toBeNull();
    expect(result.capsule.policyReview).toMatchObject({ kind: "no_published_terms", reviewedAt: noTermsPolicy.reviewedAt });
    expect(result.capsule.evidence.map((entry) => entry.url)).toEqual(["https://example.test/robots.txt", "https://example.test/", "https://example.test/team"]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("fails closed when a no-published-terms review omits a conventional endpoint", async () => {
    const fetch = vi.fn();
    const incompletePolicy = {
      host: "example.test",
      reviewedAt: "2026-09-13T12:00:00.000Z",
      expiresAt: "2026-10-14T12:00:00.000Z",
      noPublishedTermsReview: {
        kind: "no_published_terms" as const,
        attemptedUrls: [{
          url: "https://example.test/terms",
          status: 404 as const,
          bodySha256: createHash("sha256").update("missing").digest("hex"),
        }],
      },
      allowedPathPrefixes: ["/"],
    };

    const result = await researchGtaProspectWorkItem(item, { workerId: "worker-a", policies: [incompletePolicy], fetch, resolveHost: resolver, now });

    expect(result.failure).toMatchObject({ code: "terms_review_required" });
    expect(fetch).not.toHaveBeenCalled();
  });
});