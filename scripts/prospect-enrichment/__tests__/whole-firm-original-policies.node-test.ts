import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { assertSafeOriginalCompilerAttributes, verifyWholeFirmOriginalCompilerFiles } from "../whole-firm-original-derivation-gate";
import test from "node:test";
import assert from "node:assert/strict";
import { wholeFirmFixture } from "../fixtures/whole-firm";
import { assertWholeFirmManifestCoverage, compileWholeFirmSnapshot, deriveWholeFirmBoundedSource, freezeWholeFirmExport } from "../whole-firm";
import { readProspectOriginalContent } from "../../../src/lib/prospect-enrichment-original-content";
import { canonicalJson, protocolHash, sha256 } from "../model";
import { chunkExpectedRunManifest } from "../run-manifest";
import { validateManifestChunks } from "../manifest-delivery";
import { main } from "../cli";
const provenance = { compilerCommit: "a".repeat(40), compilerFileSha256: "b".repeat(64), baselineLedgerSha256: "c".repeat(64) };
function undatedSource(completedAt?: unknown) {
  const fixture = wholeFirmFixture(), exported = structuredClone(fixture.exported);
  const wrapper = exported.revisions[0] as { originalRevision: Record<string, unknown>; standardEnvelope: typeof fixture.compiled.packages[0]["envelope"] };
  wrapper.originalRevision.result = { ...(completedAt === undefined ? {} : { completedAt }), record: { researchTiming: { packageCompletedAt: "2026-08-12T03:04:05Z" }, unknown: null, permission: false } };
  wrapper.standardEnvelope = { ...wrapper.standardEnvelope, originalResearch: { ...wrapper.standardEnvelope.originalResearch, content: wrapper.originalRevision as never, contentSha256: protocolHash(wrapper.originalRevision) } };
  return freezeWholeFirmExport(exported,sha256(canonicalJson(exported) + "\n"));
}
test("explicit bounded derivation preserves all wrappers and inventories while changing transport identities", () => {
  const source = wholeFirmFixture().source, before = canonicalJson(source);
  const derived = deriveWholeFirmBoundedSource(source,provenance), compiled = compileWholeFirmSnapshot(derived);
  assert.equal(canonicalJson(source),before);
  assert.deepEqual(derived.originalExport.revisions,source.originalExport.revisions);
  assert.deepEqual(derived.originalExport.expectedRevisions,source.originalExport.expectedRevisions);
  assert.equal(derived.snapshotAt,source.snapshotAt);
  assert.notEqual(derived.manifestSha256,source.manifestSha256);
  assert.equal(compiled.packages.length,4);
  for (const [index,pkg] of compiled.packages.entries()) {
    assert.equal(pkg.envelope.schemaVersion,"prospect-enrichment/v2");
    assert.deepEqual(readProspectOriginalContent(pkg.envelope),(source.originalExport.revisions[index] as { originalRevision: unknown }).originalRevision);
    assert.notEqual(pkg.envelope.packageId,wholeFirmFixture().compiled.packages[index].envelope.packageId);
  }
  const chunks = validateManifestChunks(chunkExpectedRunManifest(compiled.expected,2,1_048_576,"whole-firm"),"whole-firm");
  assert.doesNotThrow(() => assertWholeFirmManifestCoverage(derived,chunks));
});
test("default missing completion remains held; only an exact selected policy retains original-only evidence", () => {
  const source = undatedSource(), id = source.originalExport.expectedRevisions[0].revisionId;
  assert.equal(compileWholeFirmSnapshot(source).packages.length,3);
  assert.equal(compileWholeFirmSnapshot(deriveWholeFirmBoundedSource(source,provenance)).packages.length,3);
  const derived = deriveWholeFirmBoundedSource(source,provenance,[id]), compiled = compileWholeFirmSnapshot(derived);
  const pkg = compiled.packages.find(value => value.envelope.subject.researchKey === source.originalExport.expectedRevisions[0].researchKey)!;
  assert.equal(pkg.state,"evidence_hold");
  assert.deepEqual(pkg.envelope.sources,[]); assert.deepEqual(pkg.envelope.observations,[]); assert.equal(pkg.envelope.assessment,null);
  assert.equal(pkg.envelope.subject.identityState,"unresolved"); assert.equal(pkg.envelope.subject.databaseFirmId,null);
  assert.equal(pkg.envelope.subject.stableFirmId,null); assert.deepEqual(pkg.legacyAssessmentProjectionClaims,[]);
  const saved = (source.originalExport.revisions[0] as { standardEnvelope: typeof pkg.envelope }).standardEnvelope.originalResearch;
  assert.equal(pkg.envelope.originalResearch.sourcePath,saved.sourcePath); assert.equal(pkg.envelope.originalResearch.sourcePointer,saved.sourcePointer); assert.equal(pkg.envelope.originalResearch.sourceSha256,saved.sourceSha256);
  assert.ok(pkg.issues.some(issue => issue.code === "result_completed_at_not_recorded"));
  assert.deepEqual(readProspectOriginalContent(pkg.envelope),(source.originalExport.revisions[0] as { originalRevision: unknown }).originalRevision);
  const retention = derived.originalExport.compilerUnknownCompletionRetentionPolicy!.revisions[0];
  assert.equal(retention.resultCompletedAt,null); assert.equal(retention.completionState,"unknown");
  assert.deepEqual(retention.telemetry,[{ sourcePointer: "/originalExport/revisions/0/originalRevision/result/record/researchTiming/packageCompletedAt", value: "2026-08-12T03:04:05Z", semantics: "researcher_recorded_package_completion", historicalSemanticsVerified: false }]);
});
test("retention rejects absent results, invalid or supported completion dates, repeated IDs and unknown revision IDs", () => {
  const source = wholeFirmFixture().source, id = source.originalExport.expectedRevisions[0].revisionId;
  for (const [s,ids] of [[source,[id]],[undatedSource("bad-date"),[id]],[undatedSource("2026-08-12"),[id]],[undatedSource(),[id,id]],[undatedSource(),["unknown-id"]]] as const) assert.throws(() => deriveWholeFirmBoundedSource(s,provenance,ids),/retention_scope_invalid/);
});
test("changed wrappers, compiler policy keys and telemetry cannot enter a rehashed derived manifest", () => {
  const source = undatedSource(), derived = deriveWholeFirmBoundedSource(source,provenance,[source.originalExport.expectedRevisions[0].revisionId]);
  for (const mutate of [
    (e: typeof derived.originalExport) => { (e.revisions[0] as { originalRevision: Record<string, unknown> }).originalRevision.injected = true; },
    (e: typeof derived.originalExport) => { (e.compilerOriginalRepresentationPolicy as unknown as Record<string,unknown>).extra = true; },
    (e: typeof derived.originalExport) => { e.compilerUnknownCompletionRetentionPolicy!.revisions[0].telemetry[0].value = "2026-08-13"; },
    (e: typeof derived.originalExport) => { e.compilerUnknownCompletionRetentionPolicy!.baselineLedgerSha256 = "d".repeat(64); },
  ]) {
    const exported = structuredClone(derived.originalExport); mutate(exported);
    const tampered = freezeWholeFirmExport(exported,sha256(canonicalJson(exported) + "\n"));
    assert.throws(() => compileWholeFirmSnapshot(tampered),/policy.*(invalid|mismatch)/);
  }
});
test("offline derivation rejects network execution and token flags", async () => {
  await assert.rejects(() => main(["derive-source","--profile","whole-firm","--execute"]),/offline_original_derivation_scope_invalid/);
  await assert.rejects(() => main(["derive-source","--profile","whole-firm","--token-file","never-read"]),/offline_original_derivation_scope_invalid/);
});

test("compiler seal rejects changes to CLI and recorded-date helpers", () => {
  const paths = ["cli", "model", "whole-firm", "whole-firm-original-policies", "whole-firm-original-derivation-gate"].map(name => "scripts/prospect-enrichment/" + name + ".ts");
  const files = paths.map(path => ({ path, current: Buffer.from("exact committed bytes"), committed: Buffer.from("exact committed bytes") }));
  assert.match(verifyWholeFirmOriginalCompilerFiles(files),/^[a-f0-9]{64}$/);
  for (const name of ["cli","model"]) assert.throws(() => verifyWholeFirmOriginalCompilerFiles(files.map(file => file.path.endsWith("/" + name + ".ts") ? { ...file, current: Buffer.from("changed date or delivery logic") } : file)),/uncommitted_compiler/);
});

test("no-envelope retention needs exactly one immutable coordinator result and preserves its direct pointer", () => {
  const source = undatedSource(), exported = structuredClone(source.originalExport);
  const wrapper = exported.revisions[0] as { originalRevision: Record<string,unknown>; standardEnvelope?: unknown };
  const context = { key: exported.expectedRevisions[0].researchKey, name: "Synthetic archived candidate" };
  wrapper.originalRevision.candidateContext = context; delete wrapper.standardEnvelope;
  exported.sourceInventory = { provenance: { sourcePath: "synthetic/whole_firm_state.json", sourceSha256: "d".repeat(64) }, state: { schemaVersion: "whole-firm-coordinator-v1", candidates: [{ ...context, results: [wrapper.originalRevision.result] }] } };
  const frozen = freezeWholeFirmExport(exported,sha256(canonicalJson(exported) + "\n"));
  const derived = deriveWholeFirmBoundedSource(frozen,provenance,[exported.expectedRevisions[0].revisionId]);
  const pkg = compileWholeFirmSnapshot(derived).packages.find(value => value.envelope.subject.researchKey === context.key)!;
  assert.equal(pkg.envelope.originalResearch.sourcePath,"synthetic/whole_firm_state.json");
  assert.equal(pkg.envelope.originalResearch.sourcePointer,"/candidates/0/results/0");
  assert.equal(pkg.envelope.originalResearch.sourceSha256,"d".repeat(64));
  const inventory = exported.sourceInventory as { state: { candidates: { results: unknown[] }[] } };
  inventory.state.candidates[0].results.push(wrapper.originalRevision.result);
  const ambiguous = freezeWholeFirmExport(exported,sha256(canonicalJson(exported) + "\n"));
  assert.throws(() => deriveWholeFirmBoundedSource(ambiguous,provenance,[exported.expectedRevisions[0].revisionId]),/source_ambiguous/);
});

test("checkout byte seal admits only exact Git EOL conversion and rejects source or filter changes", () => {
  const names = ["cli","model","whole-firm","whole-firm-original-policies","whole-firm-original-derivation-gate"];
  const files = names.map(name => ({ path: "scripts/prospect-enrichment/" + name + ".ts", committed: Buffer.from("const x = 1;\n"), expectedCheckout: Buffer.from("const x = 1;\r\n"), current: Buffer.from("const x = 1;\r\n") }));
  assert.match(verifyWholeFirmOriginalCompilerFiles(files),/^[a-f0-9]{64}$/);
  assert.throws(() => verifyWholeFirmOriginalCompilerFiles([...files,{ path: "scripts/synthetic.mjs", committed: Buffer.from("x\n"), expectedCheckout: Buffer.from("x\n"), current: Buffer.from("x\r\n") }]),/uncommitted_compiler/);
  assert.throws(() => verifyWholeFirmOriginalCompilerFiles(files.map(file => ({ ...file, current: Buffer.from("const x = 2;\r\n") }))),/uncommitted_compiler/);
  assert.doesNotThrow(() => assertSafeOriginalCompilerAttributes("cli.ts\0text\0unspecified\0cli.ts\0eol\0crlf\0cli.ts\0filter\0unspecified\0"));
  for (const attribute of ["filter","ident","working-tree-encoding"]) assert.throws(() => assertSafeOriginalCompilerAttributes("cli.ts\0" + attribute + "\0custom\0"),/unsafe_checkout_conversion/);
});

test("real Git NUL attribute framing verifies every requested path and attribute", () => {
  const paths = ["scripts/prospect-enrichment/cli.ts","scripts/check-self-contained-build-assets.mjs"];
  const result = execFileSync("git",["check-attr","-z","--stdin","text","eol","filter","ident","working-tree-encoding"],{ input: paths.join("\0") + "\0", encoding: "utf8" });
  assert.doesNotThrow(() => assertSafeOriginalCompilerAttributes(result,paths));
  assert.ok(result.includes(paths[1] + "\0eol\0lf\0"));
  assert.throws(() => assertSafeOriginalCompilerAttributes(result,paths.slice(0,1)),/attributes_invalid/);
  assert.throws(() => assertSafeOriginalCompilerAttributes(result.split("\0").slice(0,-4).join("\0") + "\0",paths),/attributes_invalid/);
});

test("real Git non-batch filtering yields complete expected checkout bytes for CRLF and pinned LF files", () => {
  const paths = ["scripts/prospect-enrichment/model.ts","scripts/check-self-contained-build-assets.mjs"];
  for (const path of paths) {
    const oid = execFileSync("git",["rev-parse","HEAD:" + path],{ encoding: "utf8" }).trim();
    const committed = execFileSync("git",["cat-file","blob",oid]);
    const checkout = execFileSync("git",["cat-file","--filters","--path=" + path,oid]);
    assert.ok(checkout.equals(readFileSync(path)),"complete expected checkout bytes: " + path);
    assert.equal(checkout.toString("utf8").replaceAll("\r\n","\n"),committed.toString("utf8").replaceAll("\r\n","\n"));
    if (path.endsWith(".mjs")) assert.ok(checkout.equals(committed),"explicit eol=lf stays byte identical");
  }
});
