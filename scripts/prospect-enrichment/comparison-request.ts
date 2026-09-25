import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { buildProspectEnrichmentClientItems, parseProspectEnrichmentEnvelope, type ProspectEnrichmentEnvelope } from "../../src/lib/prospect-enrichment-contract";
import { validateLegacyAssessmentProjectionClaims, type LegacyAssessmentProjectionClaim } from "./legacy-projections";
import { assertEnvelopeProfile, profileConfig, wholeFirmRunId, type EnrichmentProfile } from "./profiles";
import { canonicalJson, object, protocolHash, sha256, within } from "./model";
import type { ExpectedRunManifest } from "./run-manifest";
import { heldEvidenceDigest } from "./run-manifest";

export type ComparisonRequestPackage = {envelope:ProspectEnrichmentEnvelope;payloadSha256:string;legacyAssessmentProjectionClaims:LegacyAssessmentProjectionClaim[]};
export type ComparisonRequest = {schemaVersion:"prospect-enrichment-comparison-request/v1";manifest:ExpectedRunManifest;packages:ComparisonRequestPackage[]};
const hash=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const nonempty=(value:unknown)=>typeof value==="string"&&value.length>0;
const exact=(value:Record<string,unknown>,keys:string[])=>keys.every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>keys.includes(k));
function fail(code:string):never {throw Error(code);}
function validManifest(value:unknown,profile:EnrichmentProfile): asserts value is ExpectedRunManifest {
  if(!object(value)||!exact(value,["schemaVersion","runId","sourceSystem","sourceName","sourceManifestSha256","generatedAt","expectedPackageCount","entries","manifestSha256"])||value.schemaVersion!=="prospect-enrichment-run-manifest/v1"||!hash(value.sourceManifestSha256)||!hash(value.manifestSha256)||typeof value.generatedAt!=="string"||!/^\d{4}-\d\d-\d\dT.*Z$/.test(value.generatedAt)||!Number.isFinite(Date.parse(value.generatedAt))||!Number.isSafeInteger(value.expectedPackageCount)||Number(value.expectedPackageCount)<0||!Array.isArray(value.entries)||value.entries.length>10000)fail("comparison_request_manifest_schema_invalid");
  const {manifestSha256,...content}=value,config=profileConfig(profile);
  if(protocolHash(content)!==manifestSha256)fail("comparison_request_manifest_hash_mismatch");
  if(value.sourceSystem!==config.sourceSystem||value.sourceName!==config.sourceName||value.runId!==(profile==="whole-firm"?wholeFirmRunId(String(value.sourceManifestSha256)):"backfill-"+String(value.sourceManifestSha256).slice(0,48)))fail("comparison_request_manifest_profile_mismatch");
  const entries=new Set<string>(),packages=new Set<string>();
  for(const entry of value.entries){
    if(!object(entry)||!exact(entry,["entryId","researchKey","clientPackageId","expectedPayloadSha256","itemCount","clientItems","initialDisposition","source","errorCodes"])||!nonempty(entry.entryId)||entries.has(String(entry.entryId))||!(entry.researchKey===null||nonempty(entry.researchKey))||!(entry.clientPackageId===null||nonempty(entry.clientPackageId))||!(entry.expectedPayloadSha256===null||hash(entry.expectedPayloadSha256))||!Number.isSafeInteger(entry.itemCount)||Number(entry.itemCount)<0||!Array.isArray(entry.clientItems)||entry.itemCount!==entry.clientItems.length||!nonempty(entry.initialDisposition)||!Array.isArray(entry.errorCodes)||!entry.errorCodes.every(nonempty)||!object(entry.source)||!exact(entry.source,["sourceRoot","relativePath","sourcePointer","fileSha256"])||!(entry.source.sourceRoot===null||nonempty(entry.source.sourceRoot))||typeof entry.source.relativePath!=="string"||typeof entry.source.sourcePointer!=="string"||!(entry.source.fileSha256===null||hash(entry.source.fileSha256)))fail("comparison_request_manifest_entry_invalid");
    entries.add(String(entry.entryId));
    const ids=new Set<string>();
    for(const item of entry.clientItems){
      if(!object(item)||!exact(item,["clientItemId","itemKind","sourceEventKey","semanticSha256"])||!nonempty(item.clientItemId)||ids.has(String(item.clientItemId))||!["source","observation","assessment"].includes(String(item.itemKind))||!nonempty(item.sourceEventKey)||!hash(item.semanticSha256))fail("comparison_request_manifest_item_invalid");
      ids.add(String(item.clientItemId));
    }
    if(entry.clientPackageId===null){if(entry.expectedPayloadSha256!==null||entry.itemCount!==0|| (entry.researchKey===null ? heldEvidenceDigest(entry)!==null : !hash(heldEvidenceDigest(entry))))fail("comparison_request_nonpackage_entry_invalid");}
    else {if(entry.researchKey===null||entry.expectedPayloadSha256===null||packages.has(String(entry.clientPackageId))||heldEvidenceDigest(entry)!==null)fail("comparison_request_package_coverage_mismatch");packages.add(String(entry.clientPackageId));}
  }
  if(packages.size!==value.expectedPackageCount)fail("comparison_request_package_coverage_mismatch");
}
/** Serializes the protected Admin read request only; it grants no authentication or submission authority. */
export function serializeComparisonRequest(manifest:unknown,packages:unknown,profile:EnrichmentProfile="legacy-backfill",maxBodyBytes=16*1024*1024) {
  validManifest(manifest,profile);
  if(!Array.isArray(packages)||packages.length>1000||packages.length!==manifest.expectedPackageCount)fail("comparison_request_package_coverage_mismatch");
  const seen=new Set<string>(),values:ComparisonRequestPackage[]=[];
  for(const raw of packages){
    if(!object(raw)||!exact(raw,["envelope","payloadSha256","legacyAssessmentProjectionClaims"])||!hash(raw.payloadSha256)||!Array.isArray(raw.legacyAssessmentProjectionClaims))fail("comparison_request_package_schema_invalid");
    const parsed=parseProspectEnrichmentEnvelope(raw.envelope);
    if(!parsed.ok)fail("comparison_request_envelope_invalid");
    const envelope=parsed.envelope;assertEnvelopeProfile(envelope,profile);
    const entry=manifest.entries.find(e=>e.clientPackageId===envelope.packageId),lineage=buildProspectEnrichmentClientItems(envelope);
    if(seen.has(envelope.packageId)||envelope.runId!==manifest.runId||envelope.sourceName!==manifest.sourceName||envelope.sourceSystem!==manifest.sourceSystem||protocolHash(envelope)!==raw.payloadSha256||!entry||entry.expectedPayloadSha256!==raw.payloadSha256||entry.researchKey!==envelope.subject.researchKey||entry.itemCount!==lineage.length||protocolHash(entry.clientItems)!==protocolHash(lineage))fail("comparison_request_package_manifest_mismatch");
    if(validateLegacyAssessmentProjectionClaims(envelope,raw.legacyAssessmentProjectionClaims).length)fail("comparison_request_projection_claim_invalid");
    values.push({envelope,payloadSha256:String(raw.payloadSha256),legacyAssessmentProjectionClaims:raw.legacyAssessmentProjectionClaims as LegacyAssessmentProjectionClaim[]});seen.add(envelope.packageId);
  }
  const request:ComparisonRequest=JSON.parse(canonicalJson({schemaVersion:"prospect-enrichment-comparison-request/v1",manifest,packages:values}));
  const body=canonicalJson(request)+"\n";
  if(Buffer.byteLength(body)>maxBodyBytes)fail("comparison_request_too_large");
  return{request,body,bodySha256:sha256(body)};
}
/** New private file via fully written same-volume temporary inode and atomic non-replacing link. */
export async function writeComparisonRequest(options:{manifestPath:string;packagesPath:string;outputPath:string;profile?:EnrichmentProfile;privateRoot:string;gzip?:boolean}) {
  const profile=options.profile??"legacy-backfill",root=path.resolve(options.privateRoot),output=path.resolve(options.outputPath);
  if(!within(root,output)||output===root)fail("comparison_request_output_outside_private_root");
  const [manifestBytes,packageBytes]=await Promise.all([fs.readFile(options.manifestPath),fs.readFile(options.packagesPath)]);
  const serialized=serializeComparisonRequest(JSON.parse(manifestBytes.toString("utf8").replace(/^\uFEFF/,"")),JSON.parse(packageBytes.toString("utf8").replace(/^\uFEFF/,"")),profile,options.gzip?32*1024*1024:16*1024*1024);
  const artifactBytes=options.gzip?gzipSync(Buffer.from(serialized.body,"utf8")):Buffer.from(serialized.body,"utf8");
  const artifactSha256=sha256(artifactBytes);
  const rootReal=await fs.realpath(root);
  if(rootReal.toLowerCase()!==root.toLowerCase())fail("comparison_request_private_root_redirected");
  const parent=path.dirname(output);
  let checked=rootReal;
  for(const part of path.relative(root,parent).split(path.sep).filter(Boolean)){
    checked=path.join(checked,part);
    try{const stat=await fs.lstat(checked);if(!stat.isDirectory()||stat.isSymbolicLink())fail("comparison_request_output_directory_invalid");}
    catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;await fs.mkdir(checked);}
    if((await fs.realpath(checked)).toLowerCase()!==checked.toLowerCase())fail("comparison_request_output_outside_private_root");
  }
  const parentReal=await fs.realpath(parent);
  if(!within(rootReal,parentReal))fail("comparison_request_output_outside_private_root");
  const temporary=await fs.mkdtemp(path.join(parentReal,".comparison-request-")),pending=path.join(temporary,"request.json");
  try{
    const handle=await fs.open(pending,"wx");
    try{await handle.writeFile(artifactBytes);await handle.sync();}finally{await handle.close();}
    const [manifestNow,packagesNow]=await Promise.all([fs.readFile(options.manifestPath),fs.readFile(options.packagesPath)]);
    if(!manifestNow.equals(manifestBytes)||!packagesNow.equals(packageBytes))fail("comparison_request_inputs_changed");
    await fs.link(pending,path.join(parentReal,path.basename(output)));
  } finally {
    await fs.unlink(pending).catch(e=>{if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;});
    await fs.rmdir(temporary);
  }
  return{outputPath:output,schemaVersion:serialized.request.schemaVersion,bodySha256:serialized.bodySha256,artifactSha256,contentEncoding:options.gzip?"gzip":"identity",decodedBytes:Buffer.byteLength(serialized.body),artifactBytes:artifactBytes.byteLength,manifestSha256:serialized.request.manifest.manifestSha256,packages:serialized.request.packages.length,networkRequests:0};
}
