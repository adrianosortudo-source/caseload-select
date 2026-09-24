import { compileCandidate } from "../compiler";
import { candidate, snapshot } from "./synthetic";
import { canonicalJson, sha256 } from "../model";
import { compileWholeFirmSnapshot, freezeWholeFirmExport, type WholeFirmCoordinatorExport } from "../whole-firm";
import { chunkExpectedRunManifest } from "../run-manifest";
import { validateManifestChunks } from "../manifest-delivery";
import type { WholeFirmApprovalManifest } from "../outbox";

export function wholeFirmFixture() {
  const statuses = ["qualified", "held", "rejected", "incomplete"];
  const revisions = statuses.map((status, i) => {
    const originalRevision = { workKey: "synthetic-whole-" + i, firmName: "Synthetic " + i, status };
    const standardEnvelope = compileCandidate(candidate(originalRevision), snapshot).packages[0].envelope;
    return { revisionId: "synthetic-revision-" + i, originalRevision, standardEnvelope };
  });
  const exported: WholeFirmCoordinatorExport = { schemaVersion: "prospect-whole-firm-coordinator-export/v1", snapshotAt: snapshot.snapshotAt, expectedRevisions: revisions.map((r, i) => ({ revisionId: r.revisionId, researchKey: "synthetic-whole-" + i })), revisions };
  const source = freezeWholeFirmExport(exported, sha256(canonicalJson(exported)));
  const compiled = compileWholeFirmSnapshot(source);
  const chunks = validateManifestChunks(chunkExpectedRunManifest(compiled.expected, 2, 1_048_576, "whole-firm"), "whole-firm");
  const approval: WholeFirmApprovalManifest = { schemaVersion: "prospect-whole-firm-delivery-approval/v1", scope: "whole-firm-run", targetOrigin: "https://admin.caseloadselect.ca", projectId: "ssxryjxifwiivghglqer", runId: compiled.expected.runId, sourceManifestSha256: source.manifestSha256, runManifestSha256: compiled.expected.manifestSha256, expectedRevisionCount: source.expectedRevisionCount, approvalReference: "synthetic-whole-firm-test-only", packages: compiled.packages.map(p => ({ clientPackageId: p.envelope.packageId, payloadSha256: p.payloadSha256 })) };
  return { exported, source, compiled, chunks, approval };
}
