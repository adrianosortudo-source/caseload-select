import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEXT_EXTENSIONS = new Set([".css", ".js", ".jsx", ".mjs", ".scss", ".ts", ".tsx"]);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function collectTextFiles(root) {
  if (!existsSync(root)) return [];
  const result = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) result.push(...collectTextFiles(path));
    else if (TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) result.push(path);
  }
  return result;
}

export function findForbiddenReferences(records, forbiddenPatterns) {
  const errors = [];
  for (const record of records) {
    for (const pattern of forbiddenPatterns) {
      if (record.text.includes(pattern)) {
        errors.push(`${record.path}: forbidden remote build dependency reference: ${pattern}`);
      }
    }
  }
  return errors;
}

export function validateBuildAssets(repoRoot) {
  const errors = [];
  const manifestPath = join(repoRoot, "config", "build-assets.manifest.json");
  if (!existsSync(manifestPath)) return [`missing build asset manifest: ${manifestPath}`];

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));

  if (manifest.schemaVersion !== "caseload-build-assets-v1") {
    errors.push("build asset manifest schemaVersion must be caseload-build-assets-v1");
  }

  for (const asset of manifest.localFiles ?? []) {
    const assetPath = join(repoRoot, asset.path);
    if (!existsSync(assetPath)) errors.push(`missing repository asset: ${asset.path}`);
    else if (sha256(assetPath) !== asset.sha256) errors.push(`repository asset hash mismatch: ${asset.path}`);
  }

  for (const dependency of manifest.packages ?? []) {
    const declared = packageJson.dependencies?.[dependency.name];
    if (declared !== dependency.version) {
      errors.push(`${dependency.name} must be pinned exactly to ${dependency.version}`);
    }
    const locked = packageLock.packages?.[`node_modules/${dependency.name}`];
    if (!locked) errors.push(`${dependency.name} is absent from package-lock.json`);
    else {
      if (locked.version !== dependency.version) errors.push(`${dependency.name} lockfile version mismatch`);
      if (locked.integrity !== dependency.integrity) errors.push(`${dependency.name} lockfile integrity mismatch`);
    }
  }

  const records = [];
  for (const scanRoot of manifest.scanRoots ?? []) {
    const absoluteRoot = join(repoRoot, scanRoot);
    for (const path of collectTextFiles(absoluteRoot)) {
      records.push({ path: relative(repoRoot, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") });
    }
  }
  errors.push(...findForbiddenReferences(records, manifest.forbiddenSourcePatterns ?? []));
  return errors;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const errors = validateBuildAssets(repoRoot);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("Self-contained build asset contract: PASS");
}
