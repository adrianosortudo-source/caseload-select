/**
 * channel-validation.ts: proves each validator answers only the question
 * it can actually answer. Website/PDF validators make a real fetch call
 * (mocked here) and can genuinely pass or fail; the social validator
 * (LinkedIn/GBP) never claims a live check it cannot perform and reports
 * "unverifiable" rather than fabricating "verified".
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));

import {
  validateWebsiteReceipt,
  validatePdfReceipt,
  validateSocialReceipt,
  validateReceiptForDestination,
} from "@/lib/channel-validation";
import type { PublicationReceipt } from "@/lib/types";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetchOnce(response: Partial<Response> & { url?: string }) {
  global.fetch = vi.fn().mockResolvedValue({
    status: 200,
    url: "https://drglaw.ca/journal/example",
    headers: new Headers(),
    arrayBuffer: async () => new ArrayBuffer(0),
    ...response,
  } as Response);
}

describe("validateWebsiteReceipt", () => {
  it("fails immediately when the receipt has no public_url (never fetches)", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const result = await validateWebsiteReceipt({ public_url: null });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toMatch(/no public_url/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("verifies a live 200 page with no expected host constraint", async () => {
    mockFetchOnce({ status: 200, url: "https://drglaw.ca/journal/example" });
    const result = await validateWebsiteReceipt({ public_url: "https://drglaw.ca/journal/example" });
    expect(result.outcome).toBe("verified");
    expect(result.checks.status).toBe(200);
  });

  it("fails on a non-200 status", async () => {
    mockFetchOnce({ status: 404, url: "https://drglaw.ca/journal/missing" });
    const result = await validateWebsiteReceipt({ public_url: "https://drglaw.ca/journal/missing" });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("404");
  });

  it("fails when the live page resolves to a different host than the firm's own domain", async () => {
    mockFetchOnce({ status: 200, url: "https://someoneelse.com/journal/example" });
    const result = await validateWebsiteReceipt(
      { public_url: "https://someoneelse.com/journal/example" },
      "drglaw.ca",
    );
    expect(result.outcome).toBe("failed");
    expect(result.reason).toMatch(/not the firm's own domain/);
  });

  it("verifies when the resolved host matches the expected host", async () => {
    mockFetchOnce({ status: 200, url: "https://drglaw.ca/journal/example" });
    const result = await validateWebsiteReceipt(
      { public_url: "https://drglaw.ca/journal/example" },
      "drglaw.ca",
    );
    expect(result.outcome).toBe("verified");
    expect(result.checks.host_matches).toBe(true);
  });

  it("fails, not throws, when the fetch itself errors (network down)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await validateWebsiteReceipt({ public_url: "https://drglaw.ca/journal/example" });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toMatch(/could not reach/);
  });

  it("refuses a public_url pointing at the cloud metadata address without ever calling fetch (SSRF)", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const result = await validateWebsiteReceipt({ public_url: "https://169.254.169.254/latest/meta-data/" });
    expect(result.outcome).toBe("failed");
    expect(result.checks.fetch_error).toMatch(/blocked/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a non-https public_url (SSRF: scheme check)", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const result = await validateWebsiteReceipt({ public_url: "http://drglaw.ca/journal/example" });
    expect(result.outcome).toBe("failed");
    expect(result.checks.fetch_error).toMatch(/unsupported protocol/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to follow a redirect into a blocked address, never reaching it (SSRF via redirect)", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: "http://169.254.169.254/steal" }),
      } as unknown as Response);
    global.fetch = fetchSpy;
    const result = await validateWebsiteReceipt({ public_url: "https://drglaw.ca/redirector" });
    expect(result.outcome).toBe("failed");
    expect(result.checks.fetch_error).toMatch(/unsupported protocol|blocked/);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // the malicious hop was never requested
  });

  it("follows a legitimate same-host www redirect and lands on the correct final host", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        status: 301,
        headers: new Headers({ location: "https://www.drglaw.ca/journal/example" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        url: "https://www.drglaw.ca/journal/example",
      } as unknown as Response);
    global.fetch = fetchSpy;
    const result = await validateWebsiteReceipt({ public_url: "https://drglaw.ca/journal/example" }, "www.drglaw.ca");
    expect(result.outcome).toBe("verified");
    expect(result.checks.resolved_host).toBe("www.drglaw.ca");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("validatePdfReceipt", () => {
  it("fails when content-type is not application/pdf", async () => {
    mockFetchOnce({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
    });
    const result = await validatePdfReceipt({ public_url: "https://drglaw.ca/resources/checklist.pdf" });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toMatch(/expected application\/pdf/);
  });

  it("reports unverifiable (never a fabricated 'verified') when no trusted hash exists to check the live bytes against", async () => {
    mockFetchOnce({
      status: 200,
      headers: new Headers({ "content-type": "application/pdf" }),
      arrayBuffer: async () => new TextEncoder().encode("pdf bytes").buffer,
    });
    const result = await validatePdfReceipt({ public_url: "https://drglaw.ca/resources/checklist.pdf" });
    expect(result.outcome).toBe("unverifiable");
    expect(result.checks.sha256_checked).toBe(false);
    expect(result.reason).toMatch(/no trusted sha256/);
  });

  it("verifies when the live file's sha256 matches the approved artifact's sha256", async () => {
    const bytes = new TextEncoder().encode("the real approved pdf bytes");
    const expectedSha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    mockFetchOnce({
      status: 200,
      headers: new Headers({ "content-type": "application/pdf" }),
      arrayBuffer: async () => bytes.buffer,
    });
    const result = await validatePdfReceipt(
      { public_url: "https://drglaw.ca/resources/checklist.pdf" },
      expectedSha256,
    );
    expect(result.outcome).toBe("verified");
    expect(result.checks.sha256_matches).toBe(true);
  });

  it("fails when the live file's sha256 does NOT match the approved artifact (someone swapped the file)", async () => {
    mockFetchOnce({
      status: 200,
      headers: new Headers({ "content-type": "application/pdf" }),
      arrayBuffer: async () => new TextEncoder().encode("a different, unapproved file").buffer,
    });
    const result = await validatePdfReceipt(
      { public_url: "https://drglaw.ca/resources/checklist.pdf" },
      "0000000000000000000000000000000000000000000000000000000000000000".slice(0, 64),
    );
    expect(result.outcome).toBe("failed");
    expect(result.reason).toMatch(/does not match/);
  });
});

describe("validateSocialReceipt: never fabricates a live check it cannot perform", () => {
  it("fails when the receipt has neither a url nor an external post id", () => {
    const result = validateSocialReceipt({ public_url: null, external_post_id: null, evidence_storage_path: null });
    expect(result.outcome).toBe("failed");
  });

  it("reports unverifiable, not verified, even when a url IS present", () => {
    const result = validateSocialReceipt({
      public_url: "https://linkedin.com/posts/example",
      external_post_id: null,
      evidence_storage_path: null,
    });
    expect(result.outcome).toBe("unverifiable");
    expect(result.method).toBe("operator_attestation");
    expect(result.reason).toMatch(/no authorized read API/);
  });
});

describe("validateReceiptForDestination: dispatch", () => {
  const baseReceipt = {
    public_url: null,
    external_post_id: null,
    evidence_storage_path: null,
  } as unknown as PublicationReceipt;

  it("routes firm_website + required_artifact_type pdf to the PDF validator, not the website validator", async () => {
    mockFetchOnce({ status: 200, headers: new Headers({ "content-type": "text/html" }) });
    // A PDF-typed placement fetching an HTML page should fail on content-type,
    // proving the PDF validator (not the website validator, which has no
    // content-type check) actually ran.
    const result = await validateReceiptForDestination(
      "firm_website",
      { ...baseReceipt, public_url: "https://drglaw.ca/resources/checklist.pdf" },
      { requiredArtifactType: "pdf" },
    );
    expect(result.reason).toMatch(/application\/pdf/);
  });

  it("routes firm_website with no required_artifact_type to the website validator", async () => {
    mockFetchOnce({ status: 200, url: "https://drglaw.ca/journal/example" });
    const result = await validateReceiptForDestination(
      "firm_website",
      { ...baseReceipt, public_url: "https://drglaw.ca/journal/example" },
      {},
    );
    expect(result.outcome).toBe("verified");
  });

  it("routes linkedin_post and google_business_profile to the social validator", async () => {
    const li = await validateReceiptForDestination("linkedin_post", {
      ...baseReceipt,
      public_url: "https://linkedin.com/posts/x",
    });
    const gbp = await validateReceiptForDestination("google_business_profile", {
      ...baseReceipt,
      public_url: "https://business.google.com/posts/x",
    });
    expect(li.outcome).toBe("unverifiable");
    expect(gbp.outcome).toBe("unverifiable");
  });
});
