import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, lstatSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEMA = "screen-public-build-v1";
const ASSET_BASE = "/screen-demo-app/";
const REPOSITORY = "adrianosortudo-source/caseload-screen-sandbox";
const sha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const manifestPath = root => join(root, "config", "screen-public-build.manifest.json");
const assetRoot = root => join(root, "public", "screen-demo-app");

function walk(root, prefix = "") {
  if (!existsSync(root)) return [];
  return readdirSync(root).sort().flatMap(name => {
    const path = join(root, name), rel = prefix ? prefix + "/" + name : name;
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) throw new Error("Generated SCREEN assets must not contain symbolic links.");
    return stats.isDirectory() ? walk(path, rel) : [rel];
  });
}

export function validateScreenPublicBuild(root) {
  const errors = [], location = manifestPath(root);
  if (!existsSync(location)) return ["SCREEN build manifest is missing. Run sync:screen-public with the pushed sandbox worktree."];
  const manifest = JSON.parse(readFileSync(location, "utf8"));
  if (manifest.schemaVersion !== SCHEMA || manifest.assetBase !== ASSET_BASE || manifest.canonicalPath !== "/tools/screen") errors.push("Unexpected SCREEN artifact contract.");
  if (manifest.sourceRepository !== REPOSITORY || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? "")) errors.push("SCREEN source must name a complete sandbox commit.");
  const expected = new Set();
  for (const file of manifest.files ?? []) {
    if (typeof file.path !== "string" || file.path.includes("\\") || file.path.split("/").includes("..") || isAbsolute(file.path)) {
      errors.push("SCREEN manifest contains an unsafe asset path."); continue;
    }
    expected.add(file.path);
    const path = join(assetRoot(root), file.path);
    if (!existsSync(path)) errors.push("Missing SCREEN asset: " + file.path);
    else if (sha256(path) !== file.sha256) errors.push("SCREEN asset hash mismatch: " + file.path);
  }
  if (!expected.has("index.html")) errors.push("SCREEN entry document is missing from the manifest.");
  for (const file of walk(assetRoot(root))) if (!expected.has(file)) errors.push("Untracked generated SCREEN asset: " + file);
  const indexPath = join(assetRoot(root), "index.html");
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, "utf8");
    if (html.includes("fonts.googleapis.com") || html.includes("fonts.gstatic.com")) errors.push("SCREEN must use its approved local font files.");
    if (html.includes('src="/assets/') || html.includes('href="/assets/')) errors.push("SCREEN asset URLs are not scoped to the app artifact.");
    if (!html.includes(ASSET_BASE + "assets/")) errors.push("SCREEN entry does not reference its packaged assets.");
  }
  return errors;
}

export function syncScreenPublicBuild(root, source) {
  const sandbox = resolve(source);
  const git = (...args) => execFileSync("git", args, { cwd: sandbox, encoding: "utf8" }).trim();
  const remote = git("remote", "get-url", "origin");
  if (!remote.includes(REPOSITORY)) throw new Error("The supplied source is not the canonical SCREEN sandbox repository.");
  if (git("status", "--porcelain")) throw new Error("Commit and push the sandbox changes before packaging its frontend.");
  const commit = git("rev-parse", "HEAD");
  if (!git("branch", "-r", "--contains", commit)) throw new Error("The SCREEN source commit has not been pushed.");
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm run build -- --base=/screen-demo-app/"]
    : ["run", "build", "--", "--base=/screen-demo-app/"];
  const built = spawnSync(command, args, { cwd: sandbox, stdio: "inherit" });
  if (built.status !== 0) throw new Error("The canonical SCREEN frontend build failed.");
  if (git("status", "--porcelain") || git("rev-parse", "HEAD") !== commit) throw new Error("The sandbox source changed during packaging.");
  const destination = resolve(assetRoot(root));
  if (relative(resolve(root), destination) !== join("public", "screen-demo-app")) throw new Error("Unexpected generated SCREEN output path.");
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error("The generated output path must not be a symbolic link.");
  // This exact, validated directory contains only the generated frontend.
  if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  const dist = join(sandbox, "dist");
  const paths = walk(dist).filter(path => path !== "demo.html");
  for (const file of paths) {
    if (file.startsWith("api/") || file.split("/").some(part => part.startsWith(".env"))) throw new Error("Server configuration cannot be packaged as a public asset.");
    const to = join(destination, file);
    mkdirSync(dirname(to), { recursive: true });
    if (/\.(?:html|css|js|json|svg|txt)$/.test(file)) {
      writeFileSync(to, readFileSync(join(dist, file), "utf8").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n"));
    } else copyFileSync(join(dist, file), to);
  }
  const manifest = {
    schemaVersion: SCHEMA,
    canonicalPath: "/tools/screen",
    assetBase: ASSET_BASE,
    sourceRepository: REPOSITORY,
    sourceCommit: commit,
    files: paths.map(path => ({ path, sha256: sha256(join(destination, path)) })),
  };
  mkdirSync(dirname(manifestPath(root)), { recursive: true });
  writeFileSync(manifestPath(root), JSON.stringify(manifest, null, 2) + "\n");
  const errors = validateScreenPublicBuild(root);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Packaged canonical SCREEN source " + commit + " (" + paths.length + " verified files).");
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  if (process.argv[2] === "--sync") {
    const source = process.argv[3] || process.env.SANDBOX_REPO;
    if (!source) throw new Error("Pass the pushed sandbox worktree path to sync:screen-public.");
    syncScreenPublicBuild(root, source);
  } else {
    const errors = validateScreenPublicBuild(root);
    if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
    else console.log("Canonical SCREEN public artifact: PASS");
  }
}
