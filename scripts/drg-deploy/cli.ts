/** DR-122 bundle-driven private placement CLI. Never publishes or notifies. */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createSupabaseAdmin, loadDotEnv } from "../weekly-publish/lib/env";
import {
  applyDeployment, canonicalJsonSha256, loadAndValidateBundle, prepareDeployment,
  proveDeployment, validateAuthorization,
} from "./deployment-bundle";

function flag(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function main() {
  const command = process.argv[2];
  if (!["prepare", "gate", "apply", "prove", "run"].includes(command)) {
    throw new Error("Usage: cli.ts <prepare|gate|apply|prove|run> --bundle <file> --root <weekly-run> --authorization <file>");
  }
  const root = path.resolve(flag("root"));
  if (!statSync(root).isDirectory()) throw new Error("--root must be a directory");
  const bundlePath = path.resolve(flag("bundle"));
  const authorizationPath = path.resolve(flag("authorization"));
  const loaded = loadAndValidateBundle(bundlePath, root);
  const authorization = JSON.parse(readFileSync(authorizationPath, "utf8"));
  const authorizationSha256 = validateAuthorization(authorization, loaded.bundle, loaded.canonicalSha256);

  loadDotEnv(path.resolve(__dirname, "../../.env.local"));
  const supabase = createSupabaseAdmin();

  if (command === "prepare" || command === "gate") {
    const report = await prepareDeployment(supabase, loaded.bundle, { bundleFileSha256: loaded.fileSha256, bundleCanonicalSha256: loaded.canonicalSha256, authorizationSha256 });
    console.log(JSON.stringify({ ...report, bundleFileSha256: loaded.fileSha256, bundleCanonicalSha256: loaded.canonicalSha256, authorizationSha256, publicationAuthorized: false }, null, 2));
    return;
  }
  if (command === "apply") {
    console.log(JSON.stringify(await applyDeployment(supabase, loaded.bundle, loaded.fileSha256, loaded.canonicalSha256, authorization, authorizationSha256, root), null, 2));
    return;
  }
  if (command === "prove") {
    console.log(JSON.stringify(await proveDeployment(supabase, loaded.bundle, loaded.fileSha256), null, 2));
    return;
  }

  const prepared = await prepareDeployment(supabase, loaded.bundle, { bundleFileSha256: loaded.fileSha256, bundleCanonicalSha256: loaded.canonicalSha256, authorizationSha256 });
  const applied = await applyDeployment(supabase, loaded.bundle, loaded.fileSha256, loaded.canonicalSha256, authorization, authorizationSha256, root);
  const proved = await proveDeployment(supabase, loaded.bundle, loaded.fileSha256);
  const replay = await applyDeployment(supabase, loaded.bundle, loaded.fileSha256, loaded.canonicalSha256, authorization, authorizationSha256, root);
  if (Number(replay.totalWrites) !== 0) throw new Error(`identical replay performed ${replay.totalWrites} writes`);
  console.log(JSON.stringify({ prepared, applied, proved, replay, publicationAuthorized: false }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
