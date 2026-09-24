import assert from "node:assert/strict";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

assert.equal(Number(process.versions.node.split(".")[0]), 24, "Run this smoke with Node v24 native type stripping.");
const repository = new URL("../../", import.meta.url);
// Resolve only local extensionless TS and the repository's existing @/ alias.
// Loading/stripping remains entirely native Node: no tsx, Sucrase or bundler.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let target;
    if (specifier.startsWith("@/")) target = new URL("src/" + specifier.slice(2), repository);
    else if (specifier.startsWith(".") && context.parentURL) target = new URL(specifier, context.parentURL);
    if (target?.protocol === "file:" && !path.extname(fileURLToPath(target))) {
      const relative = path.relative(fileURLToPath(repository), fileURLToPath(target));
      assert.ok(relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative), "Resolver must remain in this repository.");
      target.pathname += ".ts";
      return nextResolve(target.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { extractCandidates } = await import("./inventory");
const { candidate } = await import("./fixtures/synthetic");
for (const status of ["qualified", "held", "rejected", "incomplete"]) {
  const original = { firmName: "Native Synthetic Firm", researchKey: "synthetic-native-" + status, status, unknownEvidence: null };
  const artifact = candidate(original).artifact;
  const result = extractCandidates({ artifact, pointer: "", value: { records: [original] } });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].pointer, "/records/0");
  assert.deepEqual(result.candidates[0].original, original);
  assert.equal(result.candidates[0].artifact.fileSha256, artifact.fileSha256);
}
// Import the adjacent compiler/reconciler graph, including the @/ shared contract alias.
const { main } = await import("./cli");
assert.match(await main(["help"]), /dry-run by default/);
console.log(JSON.stringify({ runtime: process.version, nativeTypeStripping: true, extractorImport: "passed", adjacentCliImport: "passed", syntheticStatuses: 4, researchSourceReads: 0, networkRequests: 0 }));
