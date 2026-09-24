import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson, object, ordinal, pointerPart, protocolHash, sha256, within } from "./model";
import { produceWholeFirmExport, type CoordinatorReference } from "./whole-firm-producer";
import { freezeWholeFirmExport } from "./whole-firm";

const runner = "operations/luna_continuous_v1";
const stateRelative = runner + "/control/whole_firm_state.json";
const allowedReferences = [runner + "/workers", runner + "/control/evidence", "data/qualification"];
const extension = /\.(jsonl?|html?|txt|md|csv|pdf|png|jpe?g|webp)$/i;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
async function immutable(file: string, bytes: Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.writeFile(file, bytes, { flag: "wx" }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; if (!(await fs.readFile(file)).equals(bytes)) throw Error("coordinator_archive_conflict"); }
}
export function coordinatorReferences(state: unknown): {pointer:string;value:unknown;expectedSha256:string|null;hashRequired:boolean}[] {
  const result: {pointer:string;value:unknown;expectedSha256:string|null;hashRequired:boolean}[] = [];
  const walk = (v: unknown, p: string) => {
    if (Array.isArray(v)) { v.forEach((c,i)=>walk(c,p+"/"+i)); return; }
    if (!object(v)) return;
    for (const [k,c] of Object.entries(v)) {
      const at = p + "/" + pointerPart(k);
      if (k === "evidenceArtifacts") {
        if (Array.isArray(c)) c.forEach((value,i)=>result.push({pointer:at+"/"+i,value,expectedSha256:null,hashRequired:false}));
        else result.push({pointer:at,value:c,expectedSha256:null,hashRequired:false});
      } else if (k === "queryArtifact") result.push({pointer:at,value:c,expectedSha256:hash(v.queryArtifactSha256)?v.queryArtifactSha256:null,hashRequired:true});
      else if (k === "evidence" && /\/deferral$/.test(p)) result.push({pointer:at,value:c,expectedSha256:hash(v.evidenceSha256)?v.evidenceSha256:null,hashRequired:true});
      else walk(c,at);
    }
  };
  walk(state,"");
  return result.sort((a,b)=>ordinal(a.pointer,b.pointer));
}

/** Archives only explicit state/capture inputs. Never writes, locks, refreshes or executes the coordinator. */
export async function snapshotCoordinatorState(options: {statePath:string;outputRoot:string;snapshotAt?:string;beforeRecheck?:(file:string)=>Promise<void>}) {
  const statePath = path.resolve(options.statePath), sourceRoot = path.resolve(path.dirname(statePath),"../../.."), outputRoot = path.resolve(options.outputRoot);
  if (path.relative(sourceRoot,statePath).replace(/\\/g,"/") !== stateRelative) throw Error("coordinator_state_path_invalid");
  if (within(sourceRoot,outputRoot) || within(outputRoot,sourceRoot)) throw Error("coordinator_output_overlaps_source");
  const rootReal = await fs.realpath(sourceRoot), realState = await fs.realpath(statePath);
  if (!within(rootReal,realState)) throw Error("coordinator_state_path_out_of_scope");
  const snapshotAt = options.snapshotAt ?? new Date().toISOString();
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(snapshotAt) || !Number.isFinite(Date.parse(snapshotAt))) throw Error("coordinator_snapshot_time_invalid");
  const bytes = await fs.readFile(realState), sourceSha256 = sha256(bytes);
  const archive = async (body:Buffer) => { const digest=sha256(body), file=path.join(outputRoot,"coordinator-artifacts","sha256",digest.slice(0,2),digest+".bin"); await immutable(file,body); return file; };
  const stateArchive = await archive(bytes);
  let state: unknown;
  try { state=JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/,"")); } catch { throw Error("coordinator_state_json_invalid"); }
  const references: CoordinatorReference[] = [];
  const captured: {requestedPath:string;realPath:string;sha256:string}[] = [];
  for (const ref of coordinatorReferences(state)) {
    const item:CoordinatorReference={...ref,sourcePath:null,sourceSha256:null,archivePath:null,status:"reference_schema_invalid"};
    references.push(item);
    if (typeof ref.value !== "string" || !ref.value.trim()) continue;
    const target=path.resolve(sourceRoot,ref.value); item.sourcePath=target;
    if (!extension.test(target) || !allowedReferences.some(r=>within(path.join(sourceRoot,r),target))) { item.status="reference_out_of_scope"; continue; }
    try {
      const real=await fs.realpath(target);
      if (!allowedReferences.some(r=>within(path.join(rootReal,r),real))) { item.status="reference_out_of_scope"; continue; }
      if (!(await fs.stat(real)).isFile()) { item.status="reference_not_file"; continue; }
      const body=await fs.readFile(real); item.sourceSha256=sha256(body); item.archivePath=await archive(body);
      captured.push({requestedPath:target,realPath:real,sha256:item.sourceSha256});
      await options.beforeRecheck?.(real);
      try { if (sha256(await fs.readFile(real))!==item.sourceSha256) throw Error("source_changed_during_snapshot"); } catch { throw Error("source_changed_during_snapshot"); }
      item.status=ref.hashRequired && !ref.expectedSha256 ? "reference_expected_hash_invalid" : ref.expectedSha256 && ref.expectedSha256!==item.sourceSha256 ? "reference_hash_mismatch" : "snapshotted";
    } catch(e) {
      if (e instanceof Error && e.message==="source_changed_during_snapshot") throw e;
      item.status="reference_read_failed";
    }
  }
  await options.beforeRecheck?.(realState);
  try {
    for (const capture of captured) {
      if (await fs.realpath(capture.requestedPath)!==capture.realPath || sha256(await fs.readFile(capture.realPath))!==capture.sha256) throw Error("source_changed_during_snapshot");
    }
    if (await fs.realpath(statePath)!==realState || sha256(await fs.readFile(realState))!==sourceSha256) throw Error("source_changed_during_snapshot");
  } catch { throw Error("source_changed_during_snapshot"); }
  const produced=produceWholeFirmExport(state,{sourcePath:statePath,sourceSha256,references},snapshotAt);
  const exportBytes=Buffer.from(canonicalJson(produced.exported)+"\n"), exportSha256=sha256(exportBytes);
  const exportFile=path.join(outputRoot,"exports",exportSha256+".json");
  await immutable(exportFile,exportBytes);
  const source=freezeWholeFirmExport(produced.exported,exportSha256);
  const runDir=path.join(outputRoot,"runs",source.manifestSha256);
  await immutable(path.join(runDir,"source-manifest.json"),Buffer.from(JSON.stringify(source,null,2)+"\n"));
  await immutable(path.join(runDir,"coordinator-inventory.json"),Buffer.from(canonicalJson({schemaVersion:"prospect-whole-firm-coordinator-inventory/v1",sourcePath:statePath,sourceSha256,stateArchive,snapshotAt,candidateCount:produced.candidateCount,revisionCount:produced.revisionCount,references,issues:produced.issues,exportSha256,sourceManifestSha256:source.manifestSha256,inventorySha256:protocolHash({sourceSha256,references})})+"\n"));
  return {profile:"whole-firm",runDir,sourceManifestSha256:source.manifestSha256,expectedRevisionCount:source.expectedRevisionCount,sourceExportArchive:exportFile,stateArchive,candidateCount:produced.candidateCount,issues:produced.issues.length,networkRequests:0};
}
