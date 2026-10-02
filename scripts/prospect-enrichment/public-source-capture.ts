import { createHash } from "node:crypto";
import { lookup as nodeDnsLookup, type LookupAddress } from "node:dns";
import fs from "node:fs/promises";
import https from "node:https";
import type { LookupFunction } from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { ipInBlockedRange, validateOutboundUrl } from "../../src/lib/ssrf";

const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type PublicCaptureRequest = {
  schemaVersion: "prospect-public-source-request/v1";
  requestedUrl: string;
  allowedOrigins: string[];
};

export type PublicSourceCaptureReceipt = {
  schemaVersion: "prospect-public-source-capture/v1";
  requestedUrl: string;
  finalUrl: string;
  retrievedAt: string;
  startedAt: string;
  httpStatus: number;
  contentType: string | null;
  bytes: number;
  bodySha256: string;
  bodyFile: string;
  method: "public-https-get";
  observationsVerified: false;
};

export type PublicCaptureFailureReason =
  | "invalid-request" | "unsafe-url" | "origin-not-allowed" | "cross-origin-redirect"
  | "redirect-limit" | "redirect-location-missing" | "timeout" | "body-limit"
  | "empty-body" | "authentication-required" | "access-restricted" | "http-error"
  | "dns-blocked" | "dns-error" | "network-error" | "artifact-write-failed"
  | "artifact-integrity-conflict";

export type PublicSourceCaptureAttempt = {
  schemaVersion: "prospect-public-source-attempt/v1";
  requestedUrl: string | null;
  finalUrl: string | null;
  startedAt: string;
  completedAt: string;
  httpStatus: number | null;
  contentType: string | null;
  reason: PublicCaptureFailureReason;
  method: "public-https-get";
  observationsVerified: false;
  networkRequests: number;
  redirects: number;
  bytes: number;
  bodySha256: string | null;
  bodyFile: string | null;
};

export type PublicCaptureTransportResponse = {
  httpStatus: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  cancel: () => void;
};
export type PublicCaptureTransport = (
  url: URL,
  options: { signal: AbortSignal; lookup: LookupFunction },
) => Promise<PublicCaptureTransportResponse>;
type DnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/** Dependency injection is for deterministic, network-free tests; capture bounds are fixed. */
export type PublicCaptureDependencies = {
  transport?: PublicCaptureTransport;
  dnsLookup?: DnsLookup;
  now?: () => Date;
  monotonicNow?: () => number;
};
export type PublicCaptureResult =
  | { ok: true; receipt: PublicSourceCaptureReceipt; receiptPath: string; receiptSha256: string; networkRequests: number }
  | { ok: false; attempt: PublicSourceCaptureAttempt; attemptPath: string; attemptSha256: string; networkRequests: number };

class CaptureFailure extends Error {
  constructor(readonly reason: PublicCaptureFailureReason) { super(`public_capture_${reason}`); }
}
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}
function safeUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192 || value.trim() !== value) throw new CaptureFailure("unsafe-url");
  let url: URL;
  try { url = new URL(value); } catch { throw new CaptureFailure("unsafe-url"); }
  if (!validateOutboundUrl(url).ok || url.hash) throw new CaptureFailure("unsafe-url");
  return url;
}

/** Parses the exact request contract without making a DNS lookup or network request. */
export function parsePublicCaptureRequest(value: unknown): PublicCaptureRequest {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "requestedUrl", "allowedOrigins"]) || value.schemaVersion !== "prospect-public-source-request/v1"
    || !Array.isArray(value.allowedOrigins) || value.allowedOrigins.length === 0 || value.allowedOrigins.length > 100) throw new CaptureFailure("invalid-request");
  const requested = safeUrl(value.requestedUrl);
  const allowedOrigins: string[] = [];
  for (const origin of value.allowedOrigins) {
    const url = safeUrl(origin);
    if (origin !== url.origin || allowedOrigins.includes(url.origin)) throw new CaptureFailure("invalid-request");
    allowedOrigins.push(url.origin);
  }
  if (!allowedOrigins.includes(requested.origin)) throw new CaptureFailure("origin-not-allowed");
  return { schemaVersion: "prospect-public-source-request/v1", requestedUrl: value.requestedUrl as string, allowedOrigins };
}

/** Every DNS result is checked in the actual socket lookup, closing the DNS-rebinding gap. */
function validatingLookup(resolve: DnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    const all = !!options.all;
    resolve(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error || !Array.isArray(addresses) || addresses.length === 0) {
        callback(Object.assign(new Error("public_capture_dns_error"), { code: "ECAPTUREDNS" }), all ? [] : "", 0);
        return;
      }
      if (addresses.some(address => ![4, 6].includes(address.family) || ipInBlockedRange(address.address))) {
        callback(Object.assign(new Error("public_capture_dns_blocked"), { code: "ECAPTUREDNSBLOCKED" }), all ? [] : "", 0);
        return;
      }
      if (all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

const nativeTransport: PublicCaptureTransport = (url, options) => new Promise((resolve, reject) => {
  // No cookie jar, proxy, credentials, custom headers, forms or automatic redirects.
  const request = https.request(url, {
    method: "GET", agent: false, lookup: options.lookup, signal: options.signal, rejectUnauthorized: true,
    headers: { Accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.5", "Accept-Encoding": "identity" },
  }, response => {
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(response.headers)) headers[key] = Array.isArray(value) ? value.join(", ") : value;
    resolve({ httpStatus: response.statusCode ?? 0, headers, body: response, cancel: () => response.destroy() });
  });
  request.on("error", reject);
  request.end();
});

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function rejectRedirectedAncestors(target: string): Promise<void> {
  let current = path.resolve(target);
  for (;;) {
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new CaptureFailure("artifact-write-failed");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
async function prepareRoot(outputRoot: string): Promise<string> {
  if (!path.isAbsolute(outputRoot)) throw new CaptureFailure("artifact-write-failed");
  await rejectRedirectedAncestors(outputRoot);
  await fs.mkdir(outputRoot, { recursive: true });
  if ((await fs.lstat(outputRoot)).isSymbolicLink()) throw new CaptureFailure("artifact-write-failed");
  const root = await fs.realpath(outputRoot);
  for (const name of ["bodies", "receipts", "attempts"]) {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    if ((await fs.lstat(dir)).isSymbolicLink() || !within(root, await fs.realpath(dir))) throw new CaptureFailure("artifact-write-failed");
  }
  return root;
}
async function writeImmutable(file: string, bytes: Buffer): Promise<void> {
  try {
    const handle = await fs.open(file, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const info = await fs.lstat(file);
    if (info.isSymbolicLink() || !info.isFile() || info.size !== bytes.length
      || !(await readBoundedRegularFile(file, bytes.length)).equals(bytes)) throw new CaptureFailure("artifact-integrity-conflict");
  }
}
async function saveBody(root: string, bytes: Buffer): Promise<{ bodySha256: string; bodyFile: string }> {
  const bodySha256 = hash(bytes), bodyFile = `bodies/${bodySha256}.body`;
  await writeImmutable(path.join(root, bodyFile), bytes);
  return { bodySha256, bodyFile };
}
async function saveJson(root: string, directory: "receipts" | "attempts", value: unknown): Promise<{ file: string; sha256: string }> {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"), sha256 = hash(bytes);
  const file = path.join(root, directory, `${sha256}.json`);
  await writeImmutable(file, bytes);
  return { file, sha256 };
}
function transportReason(error: unknown, timedOut: boolean): PublicCaptureFailureReason {
  if (timedOut) return "timeout";
  if (error instanceof CaptureFailure) return error.reason;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "ECAPTUREDNSBLOCKED") return "dns-blocked";
  if (code === "ECAPTUREDNS") return "dns-error";
  return "network-error";
}

/** Captures a bounded public response. Failures are immutable attempt records, never implicit retries. */
export async function capturePublicSource(input: {
  request: PublicCaptureRequest;
  outputRoot: string;
  dependencies?: PublicCaptureDependencies;
}): Promise<PublicCaptureResult> {
  const dependencies = input.dependencies ?? {}, now = dependencies.now ?? (() => new Date());
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const startedAt = now().toISOString(), deadline = monotonicNow() + TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const expired = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new CaptureFailure("timeout")), { once: true }));
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    if (monotonicNow() >= deadline) { timedOut = true; controller.abort(); }
    if (controller.signal.aborted) throw new CaptureFailure("timeout");
    const result = await Promise.race([promise, expired]);
    if (monotonicNow() >= deadline) { timedOut = true; controller.abort(); throw new CaptureFailure("timeout"); }
    return result;
  };
  // The rejection is consumed even when validation fails before the first bounded request.
  void expired.catch(() => undefined);
  let root: string | null = null, requestedUrl: string | null = null, finalUrl: string | null = null;
  let httpStatus: number | null = null, contentType: string | null = null, networkRequests = 0, redirects = 0;
  let activeResponse: PublicCaptureTransportResponse | null = null;
  const chunks: Buffer[] = [];
  let capturedBytes = 0;
  try {
    root = await prepareRoot(input.outputRoot);
    const request = parsePublicCaptureRequest(input.request);
    requestedUrl = request.requestedUrl;
    const requestedOrigin = new URL(requestedUrl).origin;
    let current = new URL(requestedUrl);
    const lookup = validatingLookup(dependencies.dnsLookup ?? nodeDnsLookup);
    const transport = dependencies.transport ?? nativeTransport;
    for (;;) {
      finalUrl = current.href;
      // Validate immediately before every attempted connection, including redirected targets.
      safeUrl(current.href);
      if (!request.allowedOrigins.includes(current.origin)) throw new CaptureFailure("origin-not-allowed");
      if (current.origin !== requestedOrigin) throw new CaptureFailure("cross-origin-redirect");
      if (monotonicNow() >= deadline) throw new CaptureFailure("timeout");
      networkRequests++;
      const pendingResponse = transport(current, { signal: controller.signal, lookup }).then(response => {
        // A test/custom transport may ignore AbortSignal and resolve after the deadline.
        if (controller.signal.aborted) { response.cancel(); throw new CaptureFailure("timeout"); }
        activeResponse = response;
        return response;
      });
      // Consume rejection even if the deadline expires before bounded() attaches its race.
      void pendingResponse.catch(() => undefined);
      activeResponse = await bounded(pendingResponse);
      httpStatus = activeResponse.httpStatus;
      contentType = activeResponse.headers["content-type"] ?? null;
      if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) throw new CaptureFailure("http-error");
      if ([301, 302, 303, 307, 308].includes(httpStatus)) {
        const location = activeResponse.headers.location;
        activeResponse.cancel(); activeResponse = null;
        if (redirects >= MAX_REDIRECTS) throw new CaptureFailure("redirect-limit");
        if (!location) throw new CaptureFailure("redirect-location-missing");
        let next: URL;
        try { next = new URL(location, current); } catch { throw new CaptureFailure("unsafe-url"); }
        safeUrl(next.href);
        if (next.origin !== requestedOrigin) throw new CaptureFailure("cross-origin-redirect");
        if (!request.allowedOrigins.includes(next.origin)) throw new CaptureFailure("origin-not-allowed");
        redirects++;
        current = next;
        continue;
      }
      if (httpStatus < 200 || httpStatus >= 300) {
        if ([401, 407].includes(httpStatus)) throw new CaptureFailure("authentication-required");
        if ([403, 451].includes(httpStatus)) throw new CaptureFailure("access-restricted");
        throw new CaptureFailure("http-error");
      }
      const declaredLength = activeResponse.headers["content-length"];
      if (declaredLength && /^\d+$/.test(declaredLength) && BigInt(declaredLength) > BigInt(MAX_BODY_BYTES)) throw new CaptureFailure("body-limit");
      const iterator = activeResponse.body[Symbol.asyncIterator]();
      for (;;) {
        const step = await bounded(iterator.next());
        if (step.done) break;
        if (!(step.value instanceof Uint8Array)) throw new CaptureFailure("network-error");
        if (capturedBytes + step.value.byteLength > MAX_BODY_BYTES) {
          const remaining = MAX_BODY_BYTES - capturedBytes;
          if (remaining) chunks.push(Buffer.from(step.value.subarray(0, remaining)));
          capturedBytes += remaining;
          throw new CaptureFailure("body-limit");
        }
        const bytes = Buffer.from(step.value);
        chunks.push(bytes); capturedBytes += bytes.length;
      }
      if (!capturedBytes) throw new CaptureFailure("empty-body");
      const retrievedAt = now().toISOString();
      clearTimeout(timer);
      const body = await saveBody(root, Buffer.concat(chunks, capturedBytes));
      const receipt: PublicSourceCaptureReceipt = {
        schemaVersion: "prospect-public-source-capture/v1", requestedUrl, finalUrl,
        retrievedAt, startedAt, httpStatus, contentType, bytes: capturedBytes, ...body,
        method: "public-https-get", observationsVerified: false,
      };
      const saved = await saveJson(root, "receipts", receipt);
      return { ok: true, receipt, receiptPath: saved.file, receiptSha256: saved.sha256, networkRequests };
    }
  } catch (error) {
    clearTimeout(timer);
    activeResponse?.cancel();
    // Local artifact failures cannot claim a durable hold unless its attempt was actually saved.
    if (!root) throw new Error("public_capture_artifact_write_failed");
    let reason = transportReason(error, timedOut);
    if (!(error instanceof CaptureFailure) && ["EACCES", "EPERM", "ENOENT", "ENOSPC", "EIO"].includes((error as NodeJS.ErrnoException | null)?.code ?? "")) reason = "artifact-write-failed";
    try {
      const body = capturedBytes ? await saveBody(root, Buffer.concat(chunks, capturedBytes)) : { bodySha256: null, bodyFile: null };
      const attempt: PublicSourceCaptureAttempt = {
        schemaVersion: "prospect-public-source-attempt/v1", requestedUrl, finalUrl, startedAt,
        completedAt: now().toISOString(), httpStatus, contentType, reason, method: "public-https-get",
        observationsVerified: false, networkRequests, redirects, bytes: capturedBytes, ...body,
      };
      const saved = await saveJson(root, "attempts", attempt);
      return { ok: false, attempt, attemptPath: saved.file, attemptSha256: saved.sha256, networkRequests };
    } catch {
      throw new Error("public_capture_attempt_not_saved");
    }
  } finally {
    clearTimeout(timer);
    activeResponse?.cancel();
  }
}

function invalidReceipt(reason: string): never { throw new Error(`public_capture_${reason}`); }
function validTime(value: unknown): value is string {
  return typeof value === "string" && UTC.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function validateReceipt(value: unknown): PublicSourceCaptureReceipt {
  const fields = ["schemaVersion", "requestedUrl", "finalUrl", "retrievedAt", "startedAt", "httpStatus", "contentType", "bytes", "bodySha256", "bodyFile", "method", "observationsVerified"];
  if (!record(value) || !exactKeys(value, fields) || value.schemaVersion !== "prospect-public-source-capture/v1"
    || value.method !== "public-https-get" || value.observationsVerified !== false
    || !validTime(value.startedAt) || !validTime(value.retrievedAt) || Date.parse(value.retrievedAt) < Date.parse(value.startedAt)
    || Date.parse(value.retrievedAt) - Date.parse(value.startedAt) > TIMEOUT_MS
    || !Number.isInteger(value.httpStatus) || (value.httpStatus as number) < 200 || (value.httpStatus as number) >= 300
    || !(value.contentType === null || (typeof value.contentType === "string" && value.contentType.length <= 16_384))
    || !Number.isInteger(value.bytes) || (value.bytes as number) <= 0 || (value.bytes as number) > MAX_BODY_BYTES
    || typeof value.bodySha256 !== "string" || !HASH.test(value.bodySha256)
    || value.bodyFile !== `bodies/${value.bodySha256}.body`) invalidReceipt("receipt_invalid");
  let requested: URL, final: URL;
  try { requested = safeUrl(value.requestedUrl); final = safeUrl(value.finalUrl); } catch { return invalidReceipt("receipt_url_invalid"); }
  if (requested.origin !== final.origin || value.finalUrl !== final.href) invalidReceipt("receipt_url_invalid");
  return value as PublicSourceCaptureReceipt;
}

async function readBoundedRegularFile(file: string, maximum: number): Promise<Buffer> {
  const info = await fs.lstat(file);
  if (info.isSymbolicLink() || !info.isFile() || info.size > maximum) invalidReceipt("artifact_invalid");
  const handle = await fs.open(file, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maximum) invalidReceipt("artifact_invalid");
    // Reading at most maximum+1 keeps a changing file bounded too.
    const buffer = Buffer.alloc(maximum + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maximum) invalidReceipt("artifact_invalid");
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}

/** Loads exact immutable capture bytes. It never changes observationsVerified or makes a request. */
export async function loadPublicCapture(receiptPath: string, expectedReceiptSha256: string): Promise<{
  receipt: PublicSourceCaptureReceipt;
  receiptPath: string;
  receiptSha256: string;
  body: Buffer;
  networkRequests: 0;
}> {
  if (!HASH.test(expectedReceiptSha256) || !path.isAbsolute(receiptPath)
    || path.basename(receiptPath) !== `${expectedReceiptSha256}.json`
    || path.basename(path.dirname(receiptPath)) !== "receipts") invalidReceipt("receipt_path_invalid");
  try {
    const receiptDir = path.dirname(receiptPath), root = path.dirname(receiptDir);
    await rejectRedirectedAncestors(receiptPath);
    if ((await fs.lstat(root)).isSymbolicLink() || (await fs.lstat(receiptDir)).isSymbolicLink()) invalidReceipt("artifact_invalid");
    const actualRoot = await fs.realpath(root);
    if (!within(actualRoot, await fs.realpath(receiptPath))) invalidReceipt("artifact_invalid");
    const bytes = await readBoundedRegularFile(receiptPath, MAX_RECEIPT_BYTES);
    if (hash(bytes) !== expectedReceiptSha256) invalidReceipt("receipt_hash_mismatch");
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch { return invalidReceipt("receipt_invalid"); }
    const receipt = validateReceipt(parsed), bodyPath = path.join(actualRoot, receipt.bodyFile);
    if ((await fs.lstat(path.dirname(bodyPath))).isSymbolicLink() || !within(actualRoot, await fs.realpath(bodyPath))) invalidReceipt("artifact_invalid");
    const body = await readBoundedRegularFile(bodyPath, MAX_BODY_BYTES);
    if (body.length !== receipt.bytes || hash(body) !== receipt.bodySha256) invalidReceipt("body_hash_mismatch");
    return { receipt, receiptPath: path.resolve(receiptPath), receiptSha256: expectedReceiptSha256, body, networkRequests: 0 };
  } catch (error) {
    if (error instanceof Error && /^public_capture_[a-z_]+$/.test(error.message)) throw error;
    throw new Error("public_capture_artifact_read_failed");
  }
}
