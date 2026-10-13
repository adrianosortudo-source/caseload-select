import test from "node:test";
import assert from "node:assert/strict";
import { requestWorkflowOidcToken, workflowTokenRequestUrl } from "../github-actions-oidc-client";

test("OIDC requests support the GitHub runner's direct and regional hosts", () => {
  for (const host of ["pipelines.actions.githubusercontent.com", "pipelinesghubeus13.actions.githubusercontent.com"]) {
    const url = workflowTokenRequestUrl(`https://${host}/token?api-version=2.0&audience=old`);
    assert.equal(url.hostname, host);
    assert.equal(url.searchParams.get("audience"), "caseload-prospect-comparison-read/v1");
    assert.equal(url.searchParams.get("api-version"), "2.0");
  }
});

test("invalid OIDC hosts cannot receive runner credentials", async () => {
  const invalid = [
    "http://pipelines.actions.githubusercontent.com/token",
    "https://pipelines.actions.githubusercontent.com.evil.example/token",
    "https://evil.example/pipelines.actions.githubusercontent.com/token",
    "https://nested.pipelines.actions.githubusercontent.com/token",
    "https://user:pass@pipelines.actions.githubusercontent.com/token",
    "https://pipelines.actions.githubusercontent.com:8443/token",
    "https://pipelines.actions.githubusercontent.com/token#fragment",
    "not a URL",
  ];
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw Error("must not fetch"); };
  for (const url of invalid) await assert.rejects(requestWorkflowOidcToken(url, "private-runner-credential", fetcher));
  assert.equal(calls, 0);
});

test("OIDC retrieval forbids redirects and binds the audience before sending credentials", async () => {
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(options?.redirect, "error");
    assert.equal(new URL(String(url)).searchParams.get("audience"), "caseload-prospect-comparison-read/v1");
    assert.equal(new Headers(options?.headers).get("authorization"), "Bearer private-runner-credential");
    return new Response(JSON.stringify({ value: "header.payload.signature" }));
  };
  assert.equal(await requestWorkflowOidcToken("https://pipelinesghubeus13.actions.githubusercontent.com/token", "private-runner-credential", fetcher), "header.payload.signature");
  const rejected: typeof fetch = async (_url, options) => {
    assert.equal(options?.redirect, "error");
    throw Error("redirect to external URL containing sensitive data");
  };
  await assert.rejects(requestWorkflowOidcToken("https://pipelines.actions.githubusercontent.com/token", "private-runner-credential", rejected), { message: "github_oidc_token_request_failed" });
});

test("OIDC token responses reject redirects, invalid JSON, malformed tokens and oversized bodies", async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
    new Response("not JSON"),
    new Response(JSON.stringify({ value: "" })),
    new Response(JSON.stringify({ value: "Bearer token" })),
    new Response(JSON.stringify({ value: "a".repeat(16_385) })),
    new Response("a".repeat(32_769)),
  ]) {
    await assert.rejects(requestWorkflowOidcToken("https://pipelines.actions.githubusercontent.com/token", "private-runner-credential", async () => response));
  }
});
