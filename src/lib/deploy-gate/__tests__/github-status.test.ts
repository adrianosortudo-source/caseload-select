/**
 * Tests for fetchCheckRuns, including the optional GITHUB_TOKEN upgrade
 * path: unset by default (unauthenticated, 60 req/hr), used automatically
 * when present (5000 req/hr), with no other behavior change either way.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchCheckRuns } from "../github-status";

const originalFetch = global.fetch;
const originalToken = process.env.GITHUB_TOKEN;

beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
});

function mockFetchOnce(response: { ok: boolean; json?: () => Promise<unknown> }) {
  const fn = vi.fn().mockResolvedValue(response);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("fetchCheckRuns", () => {
  it("sends no Authorization header when GITHUB_TOKEN is unset", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ check_runs: [{ status: "completed", conclusion: "success" }] }),
    });

    await fetchCheckRuns("adrianosortudo-source", "caseload-select", "abc123");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("sends an Authorization header when GITHUB_TOKEN is set", async () => {
    process.env.GITHUB_TOKEN = "ghp_test_token";
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ check_runs: [{ status: "completed", conclusion: "success" }] }),
    });

    await fetchCheckRuns("adrianosortudo-source", "caseload-select", "abc123");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer ghp_test_token");
  });

  it("returns null on a non-ok response", async () => {
    mockFetchOnce({ ok: false });
    const result = await fetchCheckRuns("o", "r", "sha");
    expect(result).toBeNull();
  });

  it("returns null when there are no check runs yet", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ check_runs: [] }) });
    const result = await fetchCheckRuns("o", "r", "sha");
    expect(result).toBeNull();
  });

  it("maps completed/success check runs correctly", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        check_runs: [
          { status: "completed", conclusion: "success" },
          { status: "in_progress", conclusion: null },
          { status: "completed", conclusion: "failure" },
        ],
      }),
    });
    const result = await fetchCheckRuns("o", "r", "sha");
    expect(result).toEqual([
      { completed: true, success: true },
      { completed: false, success: false },
      { completed: true, success: false },
    ]);
  });
});
