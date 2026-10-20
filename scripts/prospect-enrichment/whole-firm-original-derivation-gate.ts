import fs from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { protocolHash, sha256 } from "./model";
export type OriginalCompilerFile = { path: string; current: Uint8Array; committed: Uint8Array; expectedCheckout?: Uint8Array };
const scope = ["src", "scripts", "package.json", "package-lock.json", "tsconfig.json"];
const included = (path: string) => /\.(?:[cm]?[jt]sx?|json(?:\.gz)?|wasm)$/.test(path) || path.split("/").at(-1) === ".gitattributes";
const mandatory = ["scripts/prospect-enrichment/cli.ts", "scripts/prospect-enrichment/model.ts", "scripts/prospect-enrichment/whole-firm.ts", "scripts/prospect-enrichment/whole-firm-original-policies.ts", "scripts/prospect-enrichment/whole-firm-original-derivation-gate.ts"];
/** Compare exact expected checkout bytes; retain separate committed and executing byte hashes. */
export function wholeFirmOriginalCompilerByteProof(files: readonly OriginalCompilerFile[], checkoutProof: unknown = null) {
  if (new Set(files.map(file => file.path)).size !== files.length || mandatory.some(path => !files.some(file => file.path === path))) throw Error("offline_original_derivation_compiler_inventory_invalid");
  for (const file of files) if (!Buffer.from(file.current).equals(Buffer.from(file.expectedCheckout ?? file.committed))) throw Object.assign(Error("offline_original_derivation_uncommitted_compiler"),{ sourcePath: file.path });
  return { schemaVersion: "prospect-original-compiler-byte-seal/v1", checkoutProof, files: files.map(file => ({ path: file.path, committedSha256: sha256(file.committed), executedSha256: sha256(file.current) })).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
}
export function verifyWholeFirmOriginalCompilerFiles(files: readonly OriginalCompilerFile[], checkoutProof: unknown = null): string {
  return protocolHash(wholeFirmOriginalCompilerByteProof(files,checkoutProof));
}
/** Map in input order, limiting subprocess fan-out and waiting for started work on failure. */
export async function mapConcurrentOrdered<T, R>(items: readonly T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("offline_original_derivation_concurrency_invalid");
  const results = new Array<R>(items.length);
  let next = 0, failed = false, firstFailure: unknown;
  const worker = async () => {
    while (!failed) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await mapper(items[index],index); }
      catch (error) { if (!failed) { failed = true; firstFailure = error; } }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit,items.length) },worker));
  if (failed) throw firstFailure;
  return results;
}
function filteredCheckoutBytes(path: string, oid: string): Promise<Buffer> {
  return new Promise((resolve,reject) => execFile("git",["cat-file","--filters","--path=" + path,oid],{ encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },(error,stdout) => {
    if (error) reject(error); else resolve(stdout);
  }));
}
export function expectedOriginalCompilerCheckoutBytes(path: string, oid: string, committed: Uint8Array, current: Uint8Array): Promise<Buffer> {
  const committedBytes = Buffer.from(committed), currentBytes = Buffer.from(current);
  return currentBytes.equals(committedBytes) ? Promise.resolve(committedBytes) : filteredCheckoutBytes(path,oid);
}
function parseBatch(batch: Buffer, files: readonly string[]): { path: string; oid: string; bytes: Buffer }[] {
  let offset = 0;
  const records = files.map(path => {
    const end = batch.indexOf(10,offset), header = batch.subarray(offset,end).toString("utf8"), match = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(header);
    if (!match) throw Error("offline_original_derivation_compiler_blob_invalid");
    const size = Number(match[2]), begin = end + 1, finish = begin + size;
    if (!Number.isSafeInteger(size) || finish >= batch.length || batch[finish] !== 10) throw Error("offline_original_derivation_compiler_blob_invalid");
    offset = finish + 1; return { path, oid: match[1], bytes: batch.subarray(begin,finish) };
  });
  if (offset !== batch.length) throw Error("offline_original_derivation_compiler_blob_invalid");
  return records;
}
export function assertSafeOriginalCompilerAttributes(bytes: string, expectedPaths?: readonly string[]): void {
  const fields = bytes.split("\0"); if (fields.at(-1) === "") fields.pop();
  if (fields.length % 3 !== 0) throw Error("offline_original_derivation_attributes_invalid");
  const pairs = new Set<string>(), attributes = ["text","eol","filter","ident","working-tree-encoding"];
  for (let i=0;i<fields.length;i+=3) {
    const path=fields[i], attribute=fields[i+1], value=fields[i+2], pair=JSON.stringify([path,attribute]);
    if (!attributes.includes(attribute) || pairs.has(pair) || (expectedPaths && !expectedPaths.includes(path))) throw Error("offline_original_derivation_attributes_invalid");
    pairs.add(pair);
    const allowed = attribute === "text" ? ["set","unset","auto","unspecified"] : attribute === "eol" ? ["lf","crlf","unspecified"] : ["unset","unspecified"];
    if (!allowed.includes(value)) throw Error("offline_original_derivation_unsafe_checkout_conversion");
  }
  if (expectedPaths && (pairs.size !== expectedPaths.length * attributes.length || expectedPaths.some(path => attributes.some(attribute => !pairs.has(JSON.stringify([path,attribute])))))) throw Error("offline_original_derivation_attributes_invalid");
}
/** An attributes file matters only when it can govern a sealed path; dependency-package attributes cannot. */
export function originalCompilerUntrackedPathRejected(path: string, sealedPaths: readonly string[]): boolean {
  if (path.split("/").at(-1) === ".gitattributes") {
    const prefix = path.slice(0,path.lastIndexOf("/") + 1);
    return sealedPaths.some(file => prefix === "" || file.startsWith(prefix));
  }
  return scope.some(root => path.startsWith(root + "/")) && /\.[cm]?[jt]sx?$/.test(path);
}
/** Wider tracked code/config seal; Git may apply only pinned text/EOL checkout conversion. */
export async function verifyPushedWholeFirmOriginalCompiler(commit: string): Promise<{ compilerFileSha256: string; fileCount: number; byteSealProof: ReturnType<typeof wholeFirmOriginalCompilerByteProof> }> {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error("offline_original_derivation_commit_invalid");
  const git = (...args: string[]) => execFileSync("git",args,{ encoding: "utf8", stdio: ["ignore","pipe","pipe"], maxBuffer: 64 * 1024 * 1024 });
  if (git("rev-parse","HEAD").trim() !== commit || !git("for-each-ref","--format=%(refname)","--contains",commit,"refs/remotes/origin/").trim()) throw Error("offline_original_derivation_requires_pushed_head");
  const allPaths = git("ls-tree","-r","--name-only","-z",commit).split("\0").filter(Boolean);
  const attributes = allPaths.filter(path => path.split("/").at(-1) === ".gitattributes");
  const files = allPaths.filter(path => included(path) && (attributes.includes(path) || scope.some(root => path === root || path.startsWith(root + "/"))));
  if (files.some(path => /[\r\n]/.test(path))) throw Error("offline_original_derivation_compiler_inventory_invalid");
  for (const flags of [["--others","--exclude-standard"],["--others","--ignored","--exclude-standard"]]) {
    const untracked = git("ls-files",...flags,"-z").split("\0").filter(Boolean);
    if (untracked.some(path => originalCompilerUntrackedPathRejected(path,files))) throw Error("offline_original_derivation_untracked_compiler");
  }
  const config = (key: string): string | null => {
    try { return git("config","--get",key).trim().toLowerCase(); }
    catch (error) { if ((error as { status?: number }).status === 1) return null; throw error; }
  };
  const checkout = { gitVersion: git("--version").trim(), platform: process.platform, autocrlf: config("core.autocrlf"), eol: config("core.eol"), safecrlf: config("core.safecrlf") };
  if (!([null,"true","false","input"] as (string|null)[]).includes(checkout.autocrlf) || !([null,"lf","crlf","native"] as (string|null)[]).includes(checkout.eol) || !([null,"true","false","warn"] as (string|null)[]).includes(checkout.safecrlf)) throw Error("offline_original_derivation_checkout_config_invalid");
  const attr = (pinned: boolean) => execFileSync("git",["check-attr",...(pinned ? ["--source=" + commit] : []),"-z","--stdin","text","eol","filter","ident","working-tree-encoding"],{ input: files.join("\0") + "\0", encoding: "utf8", stdio: ["pipe","pipe","pipe"] });
  const pinnedAttributes = attr(true), currentAttributes = attr(false);
  assertSafeOriginalCompilerAttributes(pinnedAttributes,files); assertSafeOriginalCompilerAttributes(currentAttributes,files);
  if (currentAttributes !== pinnedAttributes) throw Error("offline_original_derivation_attributes_changed");
  if (attributes.length) {
    try { git("diff","--no-ext-diff","--no-textconv","--quiet",commit,"--",...attributes); }
    catch { throw Error("offline_original_derivation_attributes_changed"); }
  }
  const batch = (input: string, filters = false) => execFileSync("git",["cat-file","--batch",...(filters ? ["--filters"] : [])],{ input, stdio: ["pipe","pipe","pipe"], maxBuffer: 64 * 1024 * 1024 });
  const committed = parseBatch(batch(files.map(path => commit + ":" + path + "\n").join("")),files);
  const records: OriginalCompilerFile[] = await mapConcurrentOrdered(committed,8,async file => {
    const current = await fs.readFile(file.path);
    // Exact committed bytes need no conversion; otherwise consume complete non-batch stdout.
    const expectedCheckout = await expectedOriginalCompilerCheckoutBytes(file.path,file.oid,file.bytes,current);
    return { path: file.path, committed: file.bytes, expectedCheckout, current };
  });
  if (attr(false) !== currentAttributes || checkout.autocrlf !== config("core.autocrlf") || checkout.eol !== config("core.eol") || checkout.safecrlf !== config("core.safecrlf")) throw Error("offline_original_derivation_checkout_changed");
  const byteSealProof = wholeFirmOriginalCompilerByteProof(records,{ ...checkout, attributesSha256: sha256(pinnedAttributes) });
  return { compilerFileSha256: protocolHash(byteSealProof), fileCount: records.length, byteSealProof };
}
