/**
 * publication-reconciliation.ts's checkRoute previously called the global
 * fetch() directly on artifact.public_url/deployment_url -- operator-
 * supplied, server-fetched input, the same trust class receipt.public_url
 * is in the corrective-release Workstream 3 hardening (ssrf.ts /
 * ssrf-fetch.ts). This proves it now routes through ssrfSafeFetch (SSRF
 * protection) instead of a raw fetch, using the public reconcileArtifact
 * entry point since checkRoute itself is private.
 *
 * The DNS-resolution-dependent cases (a domain name, not a literal IP)
 * deliberately do NOT mock global.fetch: ssrfSafeFetch's pinned-lookup
 * rejection only fires inside the REAL fetch/undici Agent machinery (the
 * mocked node:dns.lookup feeds that Agent's connect.lookup hook), so
 * mocking fetch away would make these tests pass for the wrong reason
 * (never exercising the actual protection at all).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const lookupMock = vi.fn();
vi.mock("node:dns", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

const insertedRows: unknown[] = [];
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (rows: unknown[]) => {
        insertedRows.push(...rows);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import { reconcileArtifact } from "@/lib/publication-reconciliation";
import type { PublicationArtifact } from "@/lib/types";

function baseArtifact(overrides: Partial<PublicationArtifact>): PublicationArtifact {
  return {
    id: "art-1",
    firm_id: "firm-1",
    deliverable_id: "deliv-1",
    version_id: "ver-1",
    artifact_type: "webpage",
    locale: null,
    destination: null,
    storage_bucket: null,
    storage_path: null,
    public_url: null,
    repository: null,
    repository_path: null,
    deployment_commit: null,
    deployment_url: null,
    mime_type: null,
    size_bytes: null,
    sha256: null,
    validation_result: null,
    created_by_role: "operator",
    created_by_id: null,
    created_at: new Date(0).toISOString(),
    superseded_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  insertedRows.length = 0;
  lookupMock.mockReset();
  // Default: any hostname resolves to a safe public IP (the callback-style
  // node:dns.lookup shape ssrf-fetch.ts's validatingDnsLookup expects).
  lookupMock.mockImplementation((_hostname, _options, callback) => {
    callback(null, [{ address: "93.184.216.34", family: 4 }]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("publication-reconciliation checkRoute is SSRF-safe", () => {
  it("fails route_check as \"error\" when public_url's DNS resolves to a private/metadata address (real fetch/Agent path, pinned lookup rejects the connection)", async () => {
    lookupMock.mockImplementation((_hostname, _options, callback) => {
      callback(null, [{ address: "169.254.169.254", family: 4 }]);
    });
    const fetchSpy = vi.spyOn(global, "fetch");
    const artifact = baseArtifact({ public_url: "https://attacker-controlled.example/latest/meta-data" });
    const result = await reconcileArtifact(artifact, "op-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const routeResult = result.results.find((r) => r.validator === "route_check");
      expect(routeResult?.result).toBe("error");
      // The real fetch WAS attempted (that is how the pinned lookup gets a
      // chance to run at all); the rejection happens inside it, before any
      // actual network I/O, not by skipping the call outright.
      expect(fetchSpy).toHaveBeenCalled();
    }
  });

  it("fails route_check as \"error\", never even attempting a fetch, when public_url is a literal private IP (structural pre-check)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const artifact = baseArtifact({ public_url: "https://10.0.0.5/internal" });
    const result = await reconcileArtifact(artifact, "op-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const routeResult = result.results.find((r) => r.validator === "route_check");
      expect(routeResult?.result).toBe("error");
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it("passes route_check for a normal public 200 response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      status: 200,
      ok: true,
      url: "https://drglaw.ca/journal/example",
      headers: new Headers(),
      body: null,
    } as Response);
    const artifact = baseArtifact({ public_url: "https://drglaw.ca/journal/example" });
    const result = await reconcileArtifact(artifact, "op-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const routeResult = result.results.find((r) => r.validator === "route_check");
      expect(routeResult?.result).toBe("pass");
    }
  });

  it("still checks deployment_url when public_url is absent, and it is also SSRF-checked", async () => {
    lookupMock.mockImplementation((_hostname, _options, callback) => {
      callback(null, [{ address: "10.0.0.5", family: 4 }]);
    });
    const artifact = baseArtifact({ public_url: null, deployment_url: "https://internal-deploy.example/x" });
    const result = await reconcileArtifact(artifact, "op-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const routeResult = result.results.find((r) => r.validator === "route_check");
      expect(routeResult?.result).toBe("error");
    }
  });
});
