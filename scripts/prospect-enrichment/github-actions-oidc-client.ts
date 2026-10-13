const audience = "caseload-prospect-comparison-read/v1";

/** The runner supplies a regional endpoint; credentials must stay on GitHub's OIDC hosts. */
export function workflowTokenRequestUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.actions\.githubusercontent\.com$/.test(url.hostname) ||
      url.username || url.password || url.port || url.hash) throw Error("github_oidc_request_endpoint_invalid");
  url.searchParams.set("audience", audience);
  return url;
}

export async function requestWorkflowOidcToken(rawUrl: string, requestToken: string, fetcher: typeof fetch = fetch): Promise<string> {
  const url = workflowTokenRequestUrl(rawUrl);
  let response: Response;
  try {
    response = await fetcher(url, { headers: { authorization: `Bearer ${requestToken}` }, redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch { throw Error("github_oidc_token_request_failed"); }
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 32_768) throw Error("github_oidc_token_request_failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 32_768) throw Error("github_oidc_token_response_invalid");
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw Error("github_oidc_token_response_invalid"); }
  const token = value && typeof value === "object" ? (value as Record<string, unknown>).value : null;
  if (typeof token !== "string" || !/^[A-Za-z0-9._-]+$/.test(token) || token.length > 16_384) throw Error("github_oidc_token_response_invalid");
  return token;
}
