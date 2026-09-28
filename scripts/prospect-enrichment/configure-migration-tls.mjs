import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATABASE_CA_PATH, verifyDatabaseCaFile } from "./database-ca.mjs";
import { findProjectEnvFiles, verifyDirectDatabaseUrl } from "./migration-gate.mjs";

// Only the reviewed public CA is added to an already authorized connection.
// Nothing here connects, requests credentials, or changes database state.
export function configureMigrationTls({ environment, projectEnvFiles = [], mask, persist }) {
  verifyDirectDatabaseUrl(environment.MIGRATION_DATABASE_URL, environment, projectEnvFiles);
  const certificate = verifyDatabaseCaFile();
  const url = new URL(environment.MIGRATION_DATABASE_URL);
  url.searchParams.set("sslrootcert", DATABASE_CA_PATH);
  const connection = verifyDirectDatabaseUrl(url.href, environment, projectEnvFiles);
  mask(url.href);
  persist(url.href);
  return { ...certificate, ...connection };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2 || !process.env.GITHUB_ENV || !process.env.RUNNER_TEMP ||
        !path.resolve(process.env.GITHUB_ENV).startsWith(path.resolve(process.env.RUNNER_TEMP) + path.sep)) throw Error("runner_environment_file_required");
    const proof = configureMigrationTls({ environment: process.env, projectEnvFiles: findProjectEnvFiles(),
      mask: value => process.stdout.write(`::add-mask::${value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}\n`),
      persist: value => fs.appendFileSync(process.env.GITHUB_ENV, `MIGRATION_DATABASE_URL=${value}\n`),
    });
    // The mask command stays in the log; the proof alone goes into the artifact.
    fs.writeFileSync(path.join(process.env.RUNNER_TEMP, "database-tls-check.json"), JSON.stringify(proof) + "\n");
  } catch {
    // Never print an exception that might embed a connection URL or password.
    process.stderr.write("migration_database_tls_configuration_failed\n");
    process.exitCode = 1;
  }
}
