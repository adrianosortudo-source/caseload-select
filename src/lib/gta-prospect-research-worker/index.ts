import { createHash } from "node:crypto";

import type { GtaProspectResearchWorkItem } from "@/lib/gta-prospect-research-work-queue";

/**
 * This module deliberately performs public, read-only HTTP GET requests only.
 * It does not submit forms, open chats, set cookies, authenticate to a target,
 * or use a target's contact/intake surface.
 */
export const GTA_PROSPECT_RESEARCH_WORKER_USER_AGENT = "CaseLoadSelectResearch/1.0 (+https://caseloadselect.ca/research-policy)";

export type NoPublishedTermsEvidence = Readonly<{
  /** A conventional terms endpoint reviewed before candidate research. */
  url: string;
  /** Only a definitive missing-response can support this policy state. */
  status: 404 | 410;
  /** SHA-256 of the reviewed response body, including an empty body. */
  bodySha256: string;
}>;

export type NoPublishedTermsReview = Readonly<{
  kind: "no_published_terms";
  /** Every conventional endpoint below must have been reviewed and be missing. */
  attemptedUrls: readonly NoPublishedTermsEvidence[];
}>;

export type HostResearchPolicy = Readonly<{
  host: string;
  reviewedAt: string;
  expiresAt: string;
  /** Present only when a current published terms page was reviewed. */
  termsUrl?: string;
  termsSha256?: string;
  /** Present only after a bounded, documented review finds no published terms. */
  noPublishedTermsReview?: NoPublishedTermsReview;
  /** Exact same-origin paths the separate terms reviewer approved. */
  allowedPathPrefixes: readonly string[];
  /** Explicitly reviewed apex/www twin only; no arbitrary cross-host redirects. */
  allowedHostAliases?: readonly string[];
}>;

export type PolicyReviewSnapshot = Readonly<{
  kind: "published_terms";
  termsUrl: string;
  termsSha256: string;
}> | Readonly<{
  kind: "no_published_terms";
  reviewedAt: string;
  attemptedUrls: readonly NoPublishedTermsEvidence[];
}>;

export type WorkerEvidence = Readonly<{
  url: string;
  fetchedAt: string;
  status: number;
  contentType: string | null;
  bodySha256: string;
  body: string;
}>;

export type VisibleSignal = Readonly<{
  kind: "lawyer_route" | "team_route" | "owner_title" | "owner_name" | "public_email" | "phone" | "form" | "booking" | "chat" | "messaging";
  value: string;
  sourceUrl: string;
  excerpt: string | null;
}>;

/**
 * Raw handoff only. The worker does not infer Downtown eligibility from a
 * Toronto label, postal code, or the presence of an address string. A separate
 * geocoder/boundary evaluator must attach coordinate source and Plan 41 result.
 */
export type GeographyEvidenceHandoff = Readonly<{
  candidateAddress: string | null;
  sourceUrl: string;
  observedAt: string;
  status: "address_observed" | "address_missing";
  coordinate: null;
  boundary: null;
}>;

export type GtaProspectResearchCapsule = Readonly<{
  schemaVersion: "gta-prospect-research-capsule-v1";
  workItemId: string;
  sourceSystem: string;
  sourceRecordKey: string;
  candidateName: string;
  canonicalDomain: string | null;
  observedAt: string;
  workerId: string;
  evidence: readonly WorkerEvidence[];
  visibleSignals: readonly VisibleSignal[];
  geographyHandoff: readonly GeographyEvidenceHandoff[];
  policyReview: PolicyReviewSnapshot | null;
  failure: string | null;
  actionsNotPerformed: readonly string[];
}>;

export type ResearchWorkerFailure = Readonly<{ code: string; message: string; retryAfterMinutes: number }>;

export type ResearchResult = Readonly<{ capsule: GtaProspectResearchCapsule; failure: ResearchWorkerFailure | null }>;

export type WorkerTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type HostResolver = (hostname: string) => Promise<readonly string[]>;

export type GtaProspectResearchWorkerOptions = Readonly<{
  workerId: string;
  policies: readonly HostResearchPolicy[];
  fetch?: WorkerTransport;
  resolveHost?: HostResolver;
  now?: () => Date;
  maxPages?: number;
  maxBodyBytes?: number;
  requestTimeoutMs?: number;
}>;

const DEFAULT_MAX_PAGES = 8;
const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;`nconst REQUIRED_NO_TERMS_PATHS = Object.freeze(["/terms", "/terms-of-use", "/terms-and-conditions", "/terms-of-service"] as const);
const INTERNAL_ROUTE = /(?:lawyer|attorney|team|people|professional|profile|our-firm|about|contact|book|consult)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi;
const OWNER = /\b(founder|co-founder|owner|principal|managing partner|managing lawyer|partner)\b/i;

function normalizeHost(value: string): string {
  const parsed = new URL(`https://${value}`);
  if (parsed.hostname !== value.toLowerCase() || parsed.port || parsed.username || parsed.password) throw new Error("Research policy host must be a bare lowercase hostname.");
  return parsed.hostname;
}

type ApprovedHostResearchPolicy = HostResearchPolicy & Readonly<{
  host: string;
  approvedHosts: readonly string[];
}>;

function approvedHosts(host: string, aliases: readonly string[] | undefined): readonly string[] {
  if (aliases === undefined) return Object.freeze([host]);
  if (!Array.isArray(aliases)) throw new Error(`Research policy for ${host} has invalid host aliases.`);
  const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  const approved = new Set([host]);
  for (const rawAlias of aliases) {
    const alias = normalizeHost(rawAlias);
    if (alias !== twin) throw new Error(`Research policy for ${host} may only authorize its explicit apex/www twin: ${twin}.`);
    approved.add(alias);
  }
  return Object.freeze([...approved]);
}

function validateNoPublishedTermsReview(review: NoPublishedTermsReview, host: string, allowedHosts: readonly string[]): void {
  if (!review || review.kind !== "no_published_terms" || !Array.isArray(review.attemptedUrls)) throw new Error(`Research policy for ${host} has an invalid no-published-terms review.`);
  const reviewedPaths = new Set<string>();
  for (const evidence of review.attemptedUrls) {
    if (!evidence || (evidence.status !== 404 && evidence.status !== 410) || !/^[a-f0-9]{64}$/.test(evidence.bodySha256)) throw new Error(`Research policy for ${host} has invalid no-published-terms evidence.`);
    const url = new URL(evidence.url);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !allowedHosts.includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash || !REQUIRED_NO_TERMS_PATHS.includes(url.pathname as typeof REQUIRED_NO_TERMS_PATHS[number])) {
      throw new Error(`Research policy for ${host} has an unsafe or incomplete no-published-terms review.`);
    }
    reviewedPaths.add(url.pathname);
  }
  if (REQUIRED_NO_TERMS_PATHS.some((path) => !reviewedPaths.has(path))) throw new Error(`Research policy for ${host} must document every conventional terms endpoint before using no-published-terms.`);
}

function ensurePolicy(policy: HostResearchPolicy, at: Date): ApprovedHostResearchPolicy {
  const host = normalizeHost(policy.host);
  const allowedHosts = approvedHosts(host, policy.allowedHostAliases);
  const reviewedAt = Date.parse(policy.reviewedAt);
  const expiresAt = Date.parse(policy.expiresAt);
  if (!Number.isFinite(reviewedAt) || !Number.isFinite(expiresAt) || reviewedAt > at.getTime() || expiresAt <= at.getTime()) throw new Error(`Research policy for ${host} is missing, future-dated, or expired.`);
  const hasPublishedTerms = typeof policy.termsUrl === "string" && typeof policy.termsSha256 === "string";
  if (hasPublishedTerms) {
    if (policy.noPublishedTermsReview || policy.termsSha256.length !== 64 || !/^[a-f0-9]{64}$/.test(policy.termsSha256)) throw new Error(`Research policy for ${host} has an invalid terms review.`);
    const terms = new URL(policy.termsUrl);
    if (terms.protocol !== "https:" && terms.protocol !== "http:") throw new Error(`Research policy for ${host} has an unsafe terms URL.`);
    if (!allowedHosts.includes(terms.hostname)) throw new Error(`Research policy for ${host} must point to its reviewed host or explicit apex/www twin.`);
  } else {
    if (policy.termsUrl !== undefined || policy.termsSha256 !== undefined || !policy.noPublishedTermsReview) throw new Error(`Research policy for ${host} needs either reviewed published terms or documented no-published-terms evidence.`);
    validateNoPublishedTermsReview(policy.noPublishedTermsReview, host, allowedHosts);
  }
  if (!Array.isArray(policy.allowedPathPrefixes) || policy.allowedPathPrefixes.length === 0 || policy.allowedPathPrefixes.some((path) => !path.startsWith("/") || path.includes("//"))) {
    throw new Error(`Research policy for ${host} needs at least one safe allowed path prefix.`);
  }
  return { ...policy, host, approvedHosts: allowedHosts };
}

function policyReviewSnapshot(policy: ApprovedHostResearchPolicy): PolicyReviewSnapshot {
  return policy.noPublishedTermsReview
    ? Object.freeze({ kind: "no_published_terms" as const, reviewedAt: policy.reviewedAt, attemptedUrls: Object.freeze([...policy.noPublishedTermsReview.attemptedUrls]) })
    : Object.freeze({ kind: "published_terms" as const, termsUrl: policy.termsUrl!, termsSha256: policy.termsSha256! });
}

function isPrivateAddress(value: string): boolean {
  const input = value.toLowerCase();
  if (input === "::1" || input === "::" || input.startsWith("fc") || input.startsWith("fd") || input.startsWith("fe80:" ) || input.startsWith("::ffff:127.")) return true;
  const octets = input.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function samePolicyUrl(url: URL, policy: ApprovedHostResearchPolicy, prefixes: readonly string[]): boolean {
  return policy.approvedHosts.includes(url.hostname)
    && (url.protocol === "https:" || url.protocol === "http:")
    && !url.username && !url.password
    && !url.port
    && prefixes.some((prefix) => url.pathname.startsWith(prefix));
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function htmlToText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim();
}

function unique<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const fingerprint = key(item);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

function safeExcerpt(text: string, needle: string): string | null {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return null;
  return text.slice(Math.max(0, index - 90), Math.min(text.length, index + needle.length + 160)).trim().slice(0, 400) || null;
}

function hrefs(html: string, base: URL): URL[] {
  const matches = html.matchAll(/\bhref\s*=\s*["']([^"'#]+)["']/gi);
  const result: URL[] = [];
  for (const match of matches) {
    try { result.push(new URL(match[1], base)); } catch { /* untrusted markup is ignored */ }
  }
  return result;
}

function extractSignals(evidence: readonly WorkerEvidence[]): readonly VisibleSignal[] {
  const signals: VisibleSignal[] = [];
  for (const page of evidence) {
    const text = htmlToText(page.body);
    for (const match of page.body.matchAll(/\bhref\s*=\s*["']mailto:([^"'?]+)[^"']*["']/gi)) {
      const email = decodeURIComponent(match[1]).trim().toLowerCase();
      if (EMAIL.test(email)) signals.push({ kind: "public_email", value: email, sourceUrl: page.url, excerpt: null });
    }
    for (const match of page.body.matchAll(/\bhref\s*=\s*["']mailto:([^"'?]+)[^"']*["']/gi)) {
      const email = decodeURIComponent(match[1]).trim().toLowerCase();
      if (EMAIL.test(email)) signals.push({ kind: "public_email", value: email, sourceUrl: page.url, excerpt: null });
    }
    for (const email of text.match(EMAIL) ?? []) signals.push({ kind: "public_email", value: email.toLowerCase(), sourceUrl: page.url, excerpt: safeExcerpt(text, email) });
    for (const match of page.body.matchAll(/\bhref\s*=\s*["']tel:([^"']+)["']/gi)) signals.push({ kind: "phone", value: decodeURIComponent(match[1]).replace(/\s+/g, " "), sourceUrl: page.url, excerpt: null });
    for (const match of page.body.matchAll(/<form\b[^>]*>/gi)) signals.push({ kind: "form", value: "visible_html_form", sourceUrl: page.url, excerpt: match[0].slice(0, 400) });
    for (const link of hrefs(page.body, new URL(page.url))) {
      const label = `${link.pathname}${link.search}`;
      if (/calendly|acuity|youcanbook|setmore|bookings/i.test(link.hostname + label)) signals.push({ kind: "booking", value: link.toString(), sourceUrl: page.url, excerpt: null });
      if (/wa\.me|whatsapp|m\.me|messenger/i.test(link.hostname + label)) signals.push({ kind: "messaging", value: link.toString(), sourceUrl: page.url, excerpt: null });
      if (INTERNAL_ROUTE.test(label)) signals.push({ kind: /lawyer|attorney|profile/i.test(label) ? "lawyer_route" : "team_route", value: link.toString(), sourceUrl: page.url, excerpt: null });
    }
    if (/intercom|drift|tawk\.to|livechat|olark|zendesk.*chat/i.test(page.body)) signals.push({ kind: "chat", value: "visible_chat_provider_marker", sourceUrl: page.url, excerpt: null });
    for (const match of text.matchAll(/([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,3})\s*[,:–-]\s*([^.!?]{0,100}\b(?:founder|co-founder|owner|principal|managing partner|managing lawyer|partner)\b[^.!?]{0,100})/gi)) {
      const ownerName = match[1].replace(/^(?:(?:our|team|email|contact)\s+)+/i, "").trim();
      if (ownerName) signals.push({ kind: "owner_name", value: ownerName, sourceUrl: page.url, excerpt: match[0].slice(0, 400) });
      signals.push({ kind: "owner_title", value: match[2].trim(), sourceUrl: page.url, excerpt: match[0].slice(0, 400) });
    }
    if (OWNER.test(text) && !signals.some((signal) => signal.sourceUrl === page.url && signal.kind === "owner_title")) {
      signals.push({ kind: "owner_title", value: "owner_or_leadership_title_visible", sourceUrl: page.url, excerpt: safeExcerpt(text, "founder") ?? safeExcerpt(text, "owner") ?? safeExcerpt(text, "principal") ?? safeExcerpt(text, "partner") });
    }
  }
  return Object.freeze(unique(signals, (signal) => `${signal.kind}\u0000${signal.value}\u0000${signal.sourceUrl}`));
}

function parseRobots(robots: string, userAgent: string, pathname: string): boolean {
  const blocks: { agents: string[]; rules: { directive: "allow" | "disallow"; value: string }[] }[] = [];
  let current: { agents: string[]; rules: { directive: "allow" | "disallow"; value: string }[] } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; blocks.push(current); }
      current.agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && current) current.rules.push({ directive: field, value });
  }
  const agent = userAgent.split(/[\s/]/)[0].toLowerCase();
  const applicable = blocks.filter((block) => block.agents.includes(agent) || block.agents.includes("*"));
  const exact = applicable.filter((block) => block.agents.includes(agent));
  const rules = (exact.length ? exact : applicable).flatMap((block) => block.rules).filter((rule) => rule.value);
  const matching = rules.filter((rule) => pathname.startsWith(rule.value));
  if (!matching.length) return true;
  matching.sort((left, right) => right.value.length - left.value.length || (left.directive === "allow" ? -1 : 1));
  return matching[0].directive === "allow";
}

async function defaultResolveHost(hostname: string): Promise<readonly string[]> {
  const { lookup } = await import("node:dns/promises");
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function assertPublicTarget(url: URL, policy: ApprovedHostResearchPolicy): void {
  if (!samePolicyUrl(url, policy, policy.allowedPathPrefixes)) throw new Error(`Unsafe or unapproved research target: ${url.toString()}`);
}

async function fetchText({ url, policy, fetcher, resolveHost, timeoutMs, maxBodyBytes, now }: Readonly<{ url: URL; policy: ApprovedHostResearchPolicy; fetcher: WorkerTransport; resolveHost: HostResolver; timeoutMs: number; maxBodyBytes: number; now: () => Date }>): Promise<WorkerEvidence> {
  assertPublicTarget(url, policy);
  const addresses = await resolveHost(url.hostname);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error(`Unsafe DNS result for ${url.hostname}.`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      signal: controller.signal,
      headers: { "User-Agent": GTA_PROSPECT_RESEARCH_WORKER_USER_AGENT, Accept: "text/html, text/plain;q=0.9, */*;q=0.1" },
    });
  } finally { clearTimeout(timeout); }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error(`Redirect without location from ${url.toString()}.`);
    const redirected = new URL(location, url);
    assertPublicTarget(redirected, policy);
    return fetchText({ url: redirected, policy, fetcher, resolveHost, timeoutMs, maxBodyBytes, now });
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url.toString()}.`);
  const claimed = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > maxBodyBytes) throw new Error(`Response body exceeds ${maxBodyBytes} bytes.`);
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > maxBodyBytes) throw new Error(`Response body exceeds ${maxBodyBytes} bytes.`);
  return Object.freeze({ url: url.toString(), fetchedAt: now().toISOString(), status: response.status, contentType: response.headers.get("content-type"), bodySha256: sha256(body), body });
}

function failure(item: GtaProspectResearchWorkItem, workerId: string, now: Date, code: string, message: string, retryAfterMinutes: number): ResearchResult {
  return {
    capsule: Object.freeze({ schemaVersion: "gta-prospect-research-capsule-v1", workItemId: item.id, sourceSystem: item.sourceSystem, sourceRecordKey: item.sourceRecordKey, candidateName: item.candidateName, canonicalDomain: item.canonicalDomain, observedAt: now.toISOString(), workerId, evidence: Object.freeze([]), visibleSignals: Object.freeze([]), geographyHandoff: Object.freeze([]), policyReview: null, failure: `${code}: ${message}`, actionsNotPerformed: Object.freeze(["form submission", "chat interaction", "booking", "message", "contact", "outreach", "CRM write"]) }),
    failure: Object.freeze({ code, message, retryAfterMinutes }),
  };
}

/**
 * Capture public website evidence for exactly one leased item.
 * The caller must persist the returned capsule before making any queue state
 * transition. A capsule is deliberately not an identity, qualification, or
 * import decision.
 */
export async function researchGtaProspectWorkItem(item: GtaProspectResearchWorkItem, options: GtaProspectResearchWorkerOptions): Promise<ResearchResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const workerId = options.workerId.trim().toLowerCase();
  if (!/^[-_a-z0-9]{1,120}$/.test(workerId)) throw new Error("workerId must be a lowercase queue worker identifier.");
  const candidateUrl = item.sourceUrls[0] ? new URL(item.sourceUrls[0]) : null;
  if (!candidateUrl || !item.canonicalDomain) return failure(item, workerId, startedAt, "candidate_url_missing", "The queue item has no canonical domain and usable source URL.", 24 * 60);
  let policy: ApprovedHostResearchPolicy;
  try {
    const rawPolicy = options.policies.find((candidate) => candidate.host === candidateUrl.hostname.toLowerCase());
    if (!rawPolicy) return failure(item, workerId, startedAt, "terms_review_required", `No current terms policy exists for ${candidateUrl.hostname}.`, 7 * 24 * 60);
    policy = ensurePolicy(rawPolicy, startedAt);
  } catch (error) {
    return failure(item, workerId, startedAt, "terms_review_required", error instanceof Error ? error.message : "The terms policy is invalid.", 7 * 24 * 60);
  }

  const fetcher = options.fetch ?? globalThis.fetch;
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 12) throw new Error("maxPages must be an integer from 1 to 12.");
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1_024 || maxBodyBytes > 5_000_000) throw new Error("maxBodyBytes must be 1,024 to 5,000,000.");

  try {
    const terms = policy.noPublishedTermsReview ? null : await fetchText({ url: new URL(policy.termsUrl!), policy, fetcher, resolveHost, timeoutMs, maxBodyBytes, now });
    if (terms && terms.bodySha256 !== policy.termsSha256) return failure(item, workerId, startedAt, "terms_changed", `The current terms hash for ${policy.host} no longer matches its reviewed policy.`, 7 * 24 * 60);
    const robotsUrl = new URL("/robots.txt", candidateUrl);
    const robots = await fetchText({ url: robotsUrl, policy: { ...policy, allowedPathPrefixes: [...policy.allowedPathPrefixes, "/robots.txt"] }, fetcher, resolveHost, timeoutMs, maxBodyBytes, now });
    const homePath = candidateUrl.pathname || "/";
    if (!parseRobots(robots.body, GTA_PROSPECT_RESEARCH_WORKER_USER_AGENT, homePath)) return failure(item, workerId, startedAt, "robots_disallow", `robots.txt does not permit ${homePath}.`, 30 * 24 * 60);
    const home = await fetchText({ url: candidateUrl, policy, fetcher, resolveHost, timeoutMs, maxBodyBytes, now });
    const allowedRoutes = hrefs(home.body, new URL(home.url))
      .filter((url) => samePolicyUrl(url, policy, policy.allowedPathPrefixes))
      .filter((url) => INTERNAL_ROUTE.test(url.pathname))
      .filter((url) => parseRobots(robots.body, GTA_PROSPECT_RESEARCH_WORKER_USER_AGENT, url.pathname));
    const pages = unique([home, ...await Promise.all(unique(allowedRoutes, (url) => url.toString()).slice(0, Math.max(0, maxPages - 1)).map((url) => fetchText({ url, policy, fetcher, resolveHost, timeoutMs, maxBodyBytes, now })))], (page) => page.url);
    const observedAt = startedAt.toISOString();
    const capsule: GtaProspectResearchCapsule = Object.freeze({ schemaVersion: "gta-prospect-research-capsule-v1", workItemId: item.id, sourceSystem: item.sourceSystem, sourceRecordKey: item.sourceRecordKey, candidateName: item.candidateName, canonicalDomain: item.canonicalDomain, observedAt, workerId, evidence: Object.freeze([...(terms ? [terms] : []), robots, ...pages]), visibleSignals: extractSignals(pages), geographyHandoff: Object.freeze([{
      candidateAddress: item.candidateAddress,
      sourceUrl: home.url,
      observedAt,
      status: item.candidateAddress ? "address_observed" as const : "address_missing" as const,
      coordinate: null,
      boundary: null,
    }]), policyReview: policyReviewSnapshot(policy), failure: null, actionsNotPerformed: Object.freeze(["form submission", "chat interaction", "booking", "message", "contact", "outreach", "CRM write"]) });
    return Object.freeze({ capsule, failure: null });
  } catch (error) {
    return failure(item, workerId, startedAt, "transient_fetch_failure", error instanceof Error ? error.message.slice(0, 1_500) : "Public fetch failed.", Math.min(24 * 60, Math.max(30, item.attemptCount * 30)));
  }
}