import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  capturePublicSource, loadPublicCapture, parsePublicCaptureRequest,
  type PublicCaptureDependencies, type PublicCaptureRequest, type PublicCaptureTransport,
  type PublicCaptureTransportResponse,
} from "../public-source-capture";

const request: PublicCaptureRequest = {
  schemaVersion: "prospect-public-source-request/v1", requestedUrl: "https://synthetic.example/team",
  allowedOrigins: ["https://synthetic.example"],
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function workspace(t: { after: (fn: () => Promise<void>) => void }) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp");
  await fs.mkdir(root, { recursive: true });
  const outputRoot = await fs.mkdtemp(path.join(root, "pe-public-capture-synthetic-"));
  t.after(async () => {
    const real = await fs.realpath(outputRoot), relative = path.relative(root, real);
    assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(real).startsWith("pe-public-capture-synthetic-"));
    await fs.rm(real, { recursive: true, force: true });
  });
  return outputRoot;
}
function response(body: Uint8Array | Uint8Array[] = Buffer.from("Synthetic page"), httpStatus = 200, headers: Record<string, string> = {}) {
  const chunks = Array.isArray(body) ? body : [body];
  let canceled = false;
  const result: PublicCaptureTransportResponse = {
    httpStatus, headers: { "content-type": "text/html; charset=utf-8", ...headers },
    body: { async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; } },
    cancel: () => { canceled = true; },
  };
  return { result, canceled: () => canceled };
}
function dependencies(transport: PublicCaptureTransport, extra: Partial<PublicCaptureDependencies> = {}): PublicCaptureDependencies {
  let tick = 0;
  return {
    transport, monotonicNow: () => 0,
    now: () => new Date(Date.UTC(2026, 9, 2, 14, 0, 0, tick++)),
    dnsLookup: (_hostname, _options, callback) => callback(null, [{ address: "93.184.216.34", family: 4 }]),
    ...extra,
  };
}
async function resolveConnection(transport: Parameters<PublicCaptureTransport>[1], hostname: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    transport.lookup(hostname, { family: 0, all: true }, error => error ? reject(error) : resolve());
  });
}

test("successful capture preserves exact bytes, remains unverified, and reloads without a request", async t => {
  const outputRoot = await workspace(t), body = Buffer.from([0x00, 0x0a, 0xc3, 0xa9, 0xff]);
  let requests = 0;
  const deps = dependencies(async (url, options) => {
    assert.equal(url.href, request.requestedUrl);
    await resolveConnection(options, url.hostname); requests++;
    return response([body.subarray(0, 2), body.subarray(2)]).result;
  });
  const result = await capturePublicSource({ request, outputRoot, dependencies: deps });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(requests, 1); assert.equal(result.networkRequests, 1);
  assert.equal(result.receipt.observationsVerified, false);
  assert.equal(result.receipt.bodySha256, sha(body));
  assert.equal(result.receipt.bytes, body.length);
  assert.equal(path.basename(result.receiptPath), `${result.receiptSha256}.json`);
  assert.equal(sha(await fs.readFile(result.receiptPath)), result.receiptSha256);
  const loaded = await loadPublicCapture(result.receiptPath, result.receiptSha256);
  assert.ok(loaded.body.equals(body)); assert.equal(loaded.networkRequests, 0); assert.equal(requests, 1);
  const replay = await capturePublicSource({ request, outputRoot, dependencies: deps });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.receipt.bodyFile, result.receipt.bodyFile);
  assert.notEqual(replay.receiptPath, result.receiptPath);
  assert.equal((await fs.readdir(path.join(outputRoot, "bodies"))).length, 1);
  assert.equal((await fs.readdir(path.join(outputRoot, "receipts"))).length, 2);
});

test("request validation rejects credentials, private literals, fragments and absent exact origins before transport", async t => {
  const outputRoot = await workspace(t);
  let requests = 0;
  const deps = dependencies(async () => { requests++; return response().result; });
  for (const invalid of [
    { ...request, requestedUrl: "http://synthetic.example/team" },
    { ...request, requestedUrl: "https://user:secret@synthetic.example/team" },
    { ...request, requestedUrl: "https://127.0.0.1/team", allowedOrigins: ["https://127.0.0.1"] },
    { ...request, requestedUrl: "https://[::ffff:127.0.0.1]/team", allowedOrigins: ["https://[::ffff:127.0.0.1]"] },
    { ...request, requestedUrl: "https://synthetic.example/team#section" },
    { ...request, allowedOrigins: ["https://synthetic.example/path"] },
    { ...request, allowedOrigins: ["https://other.example"] },
    { ...request, cookie: "never" },
  ]) {
    const result = await capturePublicSource({ request: invalid as PublicCaptureRequest, outputRoot, dependencies: deps });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.networkRequests, 0); assert.equal(result.attempt.bytes, 0);
      assert.equal(sha(await fs.readFile(result.attemptPath)), result.attemptSha256);
      assert.equal(result.attempt.observationsVerified, false);
    }
  }
  assert.equal(requests, 0);
  assert.deepEqual(parsePublicCaptureRequest(request), request);
});

test("the actual connection lookup blocks private DNS answers and rejects a mixed public/private answer", async t => {
  const outputRoot = await workspace(t);
  for (const addresses of [
    [{ address: "10.0.0.4", family: 4 }],
    [{ address: "93.184.216.34", family: 4 }, { address: "::1", family: 6 }],
  ]) {
    let httpRequests = 0;
    const deps = dependencies(async (url, options) => {
      await resolveConnection(options, url.hostname); httpRequests++;
      return response().result;
    }, { dnsLookup: (_host, _options, callback) => callback(null, addresses) });
    const result = await capturePublicSource({ request, outputRoot, dependencies: deps });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.attempt.reason, "dns-blocked");
    assert.equal(httpRequests, 0);
  }
});

test("three same-origin redirects are allowed and the fourth stays a durable hold", async t => {
  const outputRoot = await workspace(t);
  for (const redirectCount of [3, 4]) {
    let requests = 0;
    const deps = dependencies(async () => {
      const index = requests++;
      return index < redirectCount ? response([], 302, { location: `/hop-${index}` }).result : response().result;
    });
    const result = await capturePublicSource({ request, outputRoot, dependencies: deps });
    assert.equal(requests, 4);
    assert.equal(result.ok, redirectCount === 3);
    if (!result.ok) { assert.equal(result.attempt.reason, "redirect-limit"); assert.equal(result.attempt.redirects, 3); }
  }
});

test("cross-origin redirects are held before a request even when both origins are allowlisted", async t => {
  const outputRoot = await workspace(t); let requests = 0;
  const redirect = response([], 302, { location: "https://other.example/team" });
  const result = await capturePublicSource({ request: { ...request, allowedOrigins: [...request.allowedOrigins, "https://other.example"] }, outputRoot,
    dependencies: dependencies(async () => { requests++; return redirect.result; }) });
  assert.equal(result.ok, false); assert.equal(requests, 1); assert.equal(redirect.canceled(), true);
  if (!result.ok) assert.equal(result.attempt.reason, "cross-origin-redirect");
});

test("declared and streamed oversized bodies produce holds and saved partial bytes stay within 5 MiB", async t => {
  const outputRoot = await workspace(t), maximum = 5 * 1024 * 1024;
  for (const res of [response([], 200, { "content-length": String(maximum + 1) }), response([Buffer.alloc(maximum, 1), Buffer.from([2])])]) {
    const result = await capturePublicSource({ request, outputRoot, dependencies: dependencies(async () => res.result) });
    assert.equal(result.ok, false); assert.equal(res.canceled(), true);
    if (!result.ok) {
      assert.equal(result.attempt.reason, "body-limit"); assert.ok(result.attempt.bytes <= maximum);
      if (result.attempt.bodyFile) {
        const body = await fs.readFile(path.join(outputRoot, result.attempt.bodyFile));
        assert.equal(body.length, maximum); assert.equal(sha(body), result.attempt.bodySha256);
      }
    }
  }
});

test("the 20-second deadline is shared across redirects and body reads", async t => {
  const outputRoot = await workspace(t); let elapsed = 0, requests = 0;
  const body: PublicCaptureTransportResponse = {
    httpStatus: 200, headers: {}, cancel: () => undefined,
    body: { async *[Symbol.asyncIterator]() { elapsed = 20_001; yield Buffer.from("late bytes"); } },
  };
  const result = await capturePublicSource({ request, outputRoot, dependencies: dependencies(async () => {
    requests++; elapsed = 12_000;
    return response([], 302, { location: "/after-redirect" }).result;
  }, { monotonicNow: () => elapsed, transport: async () => {
    requests++;
    if (requests === 1) { elapsed = 12_000; return response([], 302, { location: "/after-redirect" }).result; }
    return body;
  } }) });
  assert.equal(result.ok, false); assert.equal(requests, 2);
  if (!result.ok) { assert.equal(result.attempt.reason, "timeout"); assert.equal(result.attempt.bytes, 0); }
});

test("empty, authentication and HTTP failure responses retain truthful status without retry", async t => {
  const outputRoot = await workspace(t);
  for (const [status, reason] of [[200, "empty-body"], [401, "authentication-required"], [403, "access-restricted"], [503, "http-error"]] as const) {
    let requests = 0;
    const result = await capturePublicSource({ request, outputRoot, dependencies: dependencies(async () => { requests++; return response([], status).result; }) });
    assert.equal(result.ok, false); assert.equal(requests, 1);
    if (!result.ok) { assert.equal(result.attempt.httpStatus, status); assert.equal(result.attempt.reason, reason); }
  }
});

test("a transport resolving after the shared deadline is canceled without saving a successful receipt", async t => {
  const outputRoot = await workspace(t), late = response();
  let resolveTransport!: (value: PublicCaptureTransportResponse) => void;
  const pending = new Promise<PublicCaptureTransportResponse>(resolve => { resolveTransport = resolve; });
  let clockReads = 0;
  const result = await capturePublicSource({ request, outputRoot, dependencies: dependencies(async () => pending, {
    monotonicNow: () => ++clockReads >= 3 ? 20_001 : 0,
  }) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.attempt.reason, "timeout");
  resolveTransport(late.result);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(late.canceled(), true);
  assert.deepEqual(await fs.readdir(path.join(outputRoot, "receipts")), []);
});

test("network errors are redacted in durable attempts", async t => {
  const outputRoot = await workspace(t);
  const result = await capturePublicSource({ request, outputRoot, dependencies: dependencies(async () => { throw new Error("cookie=secret source record details"); }) });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.attempt.reason, "network-error");
    assert.equal(result.attempt.httpStatus, null);
    assert.ok(!(await fs.readFile(result.attemptPath, "utf8")).includes("secret"));
  }
});

test("direct capture refuses a redirected ancestor before writing or making a request", async t => {
  const root = await workspace(t), actual = path.join(root, "actual"), link = path.join(root, "redirect");
  await fs.mkdir(actual);
  await fs.symlink(actual, link, "junction");
  let requests = 0;
  await assert.rejects(capturePublicSource({ request, outputRoot: path.join(link, "output"),
    dependencies: dependencies(async () => { requests++; return response().result; }) }), /public_capture_artifact_write_failed/);
  assert.equal(requests, 0);
  await assert.rejects(fs.lstat(path.join(actual, "output")), error => (error as NodeJS.ErrnoException).code === "ENOENT");
});

test("reloading rejects receipt/body tampering and a claimed content-verification upgrade", async t => {
  const outputRoot = await workspace(t);
  const result = await capturePublicSource({ request, outputRoot, dependencies: dependencies(async () => response().result) });
  assert.equal(result.ok, true); if (!result.ok) return;
  const original = await fs.readFile(result.receiptPath);
  await fs.appendFile(result.receiptPath, " ");
  await assert.rejects(loadPublicCapture(result.receiptPath, result.receiptSha256), /public_capture_receipt_hash_mismatch/);
  await fs.writeFile(result.receiptPath, original);
  await fs.writeFile(path.join(outputRoot, result.receipt.bodyFile), "different");
  await assert.rejects(loadPublicCapture(result.receiptPath, result.receiptSha256), /public_capture_body_hash_mismatch/);
  const forged = Buffer.from(JSON.stringify({ ...result.receipt, observationsVerified: true })), forgedSha = sha(forged);
  const forgedPath = path.join(outputRoot, "receipts", `${forgedSha}.json`);
  await fs.writeFile(forgedPath, forged);
  await assert.rejects(loadPublicCapture(forgedPath, forgedSha), /public_capture_receipt_invalid/);
});

test("reloading rejects receipt fields, traversal, unsupported methods, excessive duration and bounds", async t => {
  const outputRoot = await workspace(t);
  const result = await capturePublicSource({ request, outputRoot, dependencies: dependencies(async () => response().result) });
  assert.equal(result.ok, true); if (!result.ok) return;
  for (const change of [
    { ignoredMetadata: true }, { bodyFile: "../../outside.body" }, { method: "browser" },
    { httpStatus: 503 }, { bytes: 0 }, { bytes: 5 * 1024 * 1024 + 1 },
    { retrievedAt: "2026-10-02T14:00:30.000Z" }, { finalUrl: "https://other.example/" },
    { startedAt: "2026-99-02T14:00:00.000Z" },
  ]) {
    const bytes = Buffer.from(JSON.stringify({ ...result.receipt, ...change })), sha256 = sha(bytes);
    const file = path.join(outputRoot, "receipts", `${sha256}.json`);
    await fs.writeFile(file, bytes);
    await assert.rejects(loadPublicCapture(file, sha256), /public_capture_receipt_(invalid|url_invalid)/);
  }
  await assert.rejects(loadPublicCapture(result.receiptPath, "f".repeat(64)), /public_capture_receipt_path_invalid/);
});
