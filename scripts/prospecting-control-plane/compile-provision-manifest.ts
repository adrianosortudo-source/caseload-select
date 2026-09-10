import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { compileProvisionManifest, serializeProvisionManifest, summarizeProvisionManifest, type CompileReport } from "./provision-compiler-core";
export { compileProvisionManifest, serializeProvisionManifest, summarizeProvisionManifest } from "./provision-compiler-core";

async function load(file: string) {
  const raw = await readFile(file, "utf8");
  try {
    return { value: JSON.parse(raw), sha256: createHash("sha256").update(raw).digest("hex") };
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function compileProvisionManifestFiles(paths: { ba: string; ae: string; evidence: string; out: string }): Promise<CompileReport> {
  const [ba, ae, evidence] = await Promise.all([load(paths.ba), load(paths.ae), load(paths.evidence)]);
  const raw = serializeProvisionManifest(compileProvisionManifest({
    baManifest: ba.value,
    aeManifest: ae.value,
    evidenceManifest: evidence.value,
    inputSha256: { ba: ba.sha256, ae: ae.sha256, evidence: evidence.sha256 },
  }));
  await mkdir(path.dirname(paths.out), { recursive: true });
  const temporary = `${paths.out}.tmp-${process.pid}`;
  await writeFile(temporary, raw, "utf8");
  await rename(temporary, paths.out);
  return summarizeProvisionManifest(raw);
}

function parseArgs(argv: string[]): { ba: string; ae: string; evidence: string; out: string } {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || !["--ba", "--ae", "--evidence", "--out"].includes(flag)) throw new Error(`Invalid compiler argument: ${flag ?? "<missing>"}.`);
    result[flag.slice(2)] = path.resolve(value);
  }
  for (const key of ["ba", "ae", "evidence", "out"]) if (!result[key]) throw new Error(`--${key} is required.`);
  return result as { ba: string; ae: string; evidence: string; out: string };
}

async function main() {
  const paths = parseArgs(process.argv.slice(2));
  const report = await compileProvisionManifestFiles(paths);
  process.stdout.write(`${JSON.stringify({ output: paths.out, ...report }, null, 2)}\n`);
}

if (process.argv.includes("--ba")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
