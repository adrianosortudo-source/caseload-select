import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PublicationExecutionManifest } from "@/lib/publication-execution-manifest";
import type { PublicationReceipt, PlacementDestination } from "@/lib/types";

// channel-validation.ts (`import "server-only"`) has its own 19-test suite
// covering its real fetch/hash/evidence-presence behavior in depth
// (channel-validation.test.ts). Mocked here so this file only has to prove
// the adapter delegates to it correctly with the right destination/args --
// not re-prove its internals, and so this test file's module graph never
// needs to resolve "server-only" through two different import chains in
// the same run (observed to be unreliable in this Vitest/Vite setup when
// combined with publication-execution-manifest.ts's graph; unrelated to
// this module's actual behavior, which Next.js's real build always
// resolves correctly via its "react-server" export condition).
vi.mock("@/lib/channel-validation", () => ({
  validateReceiptForDestination: vi.fn(async (destination: string) => ({
    outcome: "unverifiable",
    method: "operator_attestation",
    checks: { destination },
    reason: "mocked for adapter delegation test",
  })),
  isManuallyVerifiableDestination: vi.fn(() => true),
}));

const { getPublicationAdapter, isLiveExecutionEnabled } = await import("@/lib/publication-adapter");

function baseManifest(overrides: Partial<PublicationExecutionManifest> = {}): PublicationExecutionManifest {
  return {
    schemaVersion: "publication-execution-manifest-1.0",
    generatedAt: "2026-07-18T00:00:00.000Z",
    generatedBy: { role: "operator", id: "op-1", name: "Op" },
    idempotencyKey: "key-abc",
    firmId: "firm-1",
    contentPeriodId: "period-1",
    periodLifecycle: "enforced",
    deliverableId: "deliverable-1",
    approvedVersionId: "version-1",
    versionBodyHash: "hash",
    releaseAuthorizationPath: "individual_approval",
    placementId: "placement-1",
    destination: "firm_website",
    destinationAccount: { configured: true, identifier: "https://drglaw.ca", note: "resolved" },
    locale: "en-CA",
    title: "Founder vesting in Ontario corporations",
    body: "<p>Body text.</p>",
    excerpt: "Excerpt",
    ctaTargetPath: null,
    canonicalUrl: "https://drglaw.ca/journal/founder-vesting-ontario",
    trackedUrl: "https://drglaw.ca/journal/founder-vesting-ontario?utm_content=placement-1",
    assets: [],
    scheduledPublishDate: null,
    scheduledTimezone: null,
    destinationMetadata: { bodyLength: 17, priorReceiptVerificationState: null },
    blocked: false,
    blockReasons: [],
    ...overrides,
  } as PublicationExecutionManifest;
}

const ALL_DESTINATIONS: PlacementDestination[] = [
  "firm_website",
  "linkedin_post",
  "linkedin_article",
  "linkedin_company_page",
  "google_business_profile",
  "email_delivery",
];

describe("publication-adapter — no external write is possible in this release", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PUBLICATION_OPERATOR_ENABLE_LIVE_EXECUTE;
  });

  it("execute() always returns ok:false and never calls fetch, for every destination", async () => {
    for (const destination of ALL_DESTINATIONS) {
      const adapter = getPublicationAdapter(destination);
      const result = await adapter.execute(baseManifest({ destination }));
      expect(result.ok).toBe(false);
      expect(result.error).toContain("structurally disabled");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("execute() stays disabled even if a live-execution env flag is forged to true", async () => {
    process.env.PUBLICATION_OPERATOR_ENABLE_LIVE_EXECUTE = "true";
    const adapter = getPublicationAdapter("linkedin_post");
    const result = await adapter.execute(baseManifest({ destination: "linkedin_post" }));
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("isLiveExecutionEnabled is false for every destination regardless of env state", () => {
    process.env.PUBLICATION_OPERATOR_ENABLE_LIVE_EXECUTE = "true";
    for (const destination of ALL_DESTINATIONS) {
      expect(isLiveExecutionEnabled(destination)).toBe(false);
    }
  });
});

describe("publication-adapter — validateConfiguration", () => {
  it("reports LinkedIn and GBP as never configured (no integration exists)", () => {
    for (const destination of ["linkedin_post", "linkedin_article", "linkedin_company_page", "google_business_profile"] as const) {
      const adapter = getPublicationAdapter(destination);
      const result = adapter.validateConfiguration(baseManifest({ destination }));
      expect(result.configured).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      // Config names are surfaced for operator visibility, never values.
      for (const name of result.requiredConfigNames) {
        expect(typeof name).toBe("string");
        expect(name).not.toMatch(/^[a-zA-Z0-9+/=]{20,}$/); // not a value-shaped token
      }
    }
  });

  it("reports website as configured when the manifest's destinationAccount is configured", () => {
    const adapter = getPublicationAdapter("firm_website");
    const result = adapter.validateConfiguration(baseManifest());
    expect(result.configured).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

describe("publication-adapter — renderDryRun", () => {
  it("every destination's dry run requires manual action and carries no secret in the payload preview", () => {
    for (const destination of ALL_DESTINATIONS) {
      const adapter = getPublicationAdapter(destination);
      const dryRun = adapter.renderDryRun(baseManifest({ destination }));
      expect(dryRun.requiresManualAction).toBe(true);
      const serialized = JSON.stringify(dryRun.payloadPreview);
      expect(serialized).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|api[_-]?key|secret|password|token/i);
    }
  });

  it("website dry run summary references the resolved canonical URL, never a guessed one", () => {
    const adapter = getPublicationAdapter("firm_website");
    const dryRun = adapter.renderDryRun(baseManifest());
    expect(dryRun.summary).toContain("https://drglaw.ca/journal/founder-vesting-ontario");
  });
});

describe("publication-adapter — preflight delegates to the shared taxonomy", () => {
  it("returns the same category evaluatePublicationPreflightStatus would for the manifest", () => {
    const adapter = getPublicationAdapter("firm_website");
    const status = adapter.preflight(baseManifest());
    expect(status.category).toBe("ready");
  });
});

describe("publication-adapter — reconcile wraps channel-validation.ts, never duplicates its fetch logic", () => {
  it("reconcile for a social destination reports unverifiable evidence-presence only, never a fabricated verified", async () => {
    const adapter = getPublicationAdapter("linkedin_post");
    const receipt: PublicationReceipt = {
      id: "r1",
      firm_id: "firm-1",
      period_id: null,
      deliverable_id: "deliverable-1",
      placement_id: "placement-1",
      destination: "linkedin_post",
      locale: "en-CA",
      approved_version_id: "version-1",
      claim_id: "claim-1",
      artifact_id: null,
      artifact_sha256: null,
      public_url: "https://linkedin.com/posts/123",
      external_post_id: null,
      published_at: "2026-07-18T00:00:00.000Z",
      actor_role: "operator",
      actor_id: "op-1",
      actor_name: "Op",
      verification_state: "unverified",
      verified_at: null,
      verification_method: null,
      evidence_storage_bucket: null,
      evidence_storage_path: null,
      failure_reason: null,
      reconciles_receipt_id: null,
      release_path: "individual_approval",
      standing_authorization_event_id: null,
      created_at: "2026-07-18T00:00:00.000Z",
    } as unknown as PublicationReceipt;
    const result = await adapter.reconcile(receipt);
    expect(result.outcome).toBe("unverifiable");
    expect(result.method).toBe("operator_attestation");
    // Delegation, not duplication: the adapter passed the receipt's own
    // destination through to channel-validation.ts rather than hardcoding
    // or guessing one.
    expect((result.checks as Record<string, unknown>).destination).toBe("linkedin_post");
  });
});

describe("publication-adapter — normalizeReceipt never invents evidence", () => {
  it("passes through only what the operator actually supplied", () => {
    const adapter = getPublicationAdapter("firm_website");
    const normalized = adapter.normalizeReceipt({ publicUrl: "https://drglaw.ca/journal/x" }, baseManifest());
    expect(normalized.publicUrl).toBe("https://drglaw.ca/journal/x");
    expect(normalized.externalPostId).toBe(null);
    expect(normalized.destination).toBe("firm_website");
  });
});
