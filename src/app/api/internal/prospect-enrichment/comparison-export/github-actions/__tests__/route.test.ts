import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ verify: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/client-import-server", () => ({ validateSameOrigin: vi.fn(() => true) }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: vi.fn(async () => null) }));
const invalidContentHeaders: Record<string, string>[] = [{ "content-type": "text/plain" }, { "content-encoding": "gzip" }];
vi.mock("@/lib/prospect-enrichment-github-oidc", () => ({ verifyProspectComparisonWorkflowToken: state.verify }));
vi.mock("../../../../../admin/prospect-enrichment/comparison-export/handler", () => ({ handleMachineComparisonExport: state.read }));
import { POST } from "../route";

const identity = {
  repository: "adrianosortudo-source/caseload-select", repositoryId: "1206232496", ref: "refs/heads/main",
  sha: "a".repeat(40), workflowRef: "adrianosortudo-source/caseload-select/.github/workflows/prospect-enrichment-comparison-read.yml@refs/heads/main",
  environment: "Prospect comparison read", eventName: "workflow_dispatch", runId: "123456", runAttempt: "1", jtiSha256: "b".repeat(64),
};
function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://caseloadselect.ca/api/internal/prospect-enrichment/comparison-export/github-actions", {
    method: "POST", headers: { authorization: "Bearer header.payload.signature", "content-type": "application/json", ...headers }, body: "{}\n",
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.verify.mockResolvedValue(identity);
  state.read.mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("machine comparison route", () => {
  it("rejects missing credentials before verification or private reads", async () => {
    expect((await POST(request({ authorization: "" }))).status).toBe(401);
    expect(state.verify).not.toHaveBeenCalled();
    expect(state.read).not.toHaveBeenCalled();
  });
  it.each(invalidContentHeaders)("requires canonical uncompressed JSON", async (headers) => {
    expect((await POST(request(headers))).status).toBe(400);
    expect(state.verify).not.toHaveBeenCalled();
    expect(state.read).not.toHaveBeenCalled();
  });
  it("cannot pass a rejected workflow identity to the shared read implementation", async () => {
    state.verify.mockRejectedValue(Error("invalid identity"));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(state.read).not.toHaveBeenCalled();
  });
  it("delegates only after verification and audits hashes without credentials", async () => {
    const audit = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const req = request();
      expect((await POST(req)).status).toBe(200);
      expect(state.verify).toHaveBeenCalledWith("header.payload.signature");
      expect(state.read).toHaveBeenCalledWith(req, identity);
      expect(state.verify.mock.invocationCallOrder[0]).toBeLessThan(state.read.mock.invocationCallOrder[0]);
      const logged = JSON.stringify(audit.mock.calls);
      expect(logged).toContain("read_complete");
      expect(logged).toContain(identity.jtiSha256);
      expect(logged).not.toContain("header.payload.signature");
    } finally { audit.mockRestore(); }
  });
});


it.each(["github_oidc_claims_rejected", "unexpected bearer secret"])("audits only an allowlisted authentication reason", async reason => {
  const audit = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    state.verify.mockRejectedValue(Error(reason));
    expect((await POST(request())).status).toBe(401);
    const logged = JSON.stringify(audit.mock.calls);
    expect(logged).toContain(reason.startsWith("github_oidc_") ? reason : "github_oidc_verification_failed");
    expect(logged).not.toContain("header.payload.signature");
    expect(logged).not.toContain("unexpected bearer secret");
    expect(state.read).not.toHaveBeenCalled();
  } finally { audit.mockRestore(); }
});
