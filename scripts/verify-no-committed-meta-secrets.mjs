import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const textExtensions = new Set([
  ".cjs", ".css", ".env", ".html", ".js", ".json", ".jsx", ".md", ".mjs",
  ".ps1", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml"
]);
const placeholder = "[stored in Vercel production environment; never commit]";
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const failures = [];

const obviouslySynthetic = (value) => {
  const normalized = value.toLowerCase();
  return !value
    || value.startsWith("[")
    || value.startsWith("<")
    || value.startsWith("${")
    || normalized.includes("process.env")
    || /(?:test|fixture|synthetic|example|placeholder|dummy|fake|mock|\.\.\.)/.test(normalized);
};

for (const file of tracked) {
  if (!textExtensions.has(extname(file).toLowerCase()) && !file.startsWith(".env")) continue;
  let buffer;
  try {
    buffer = readFileSync(file);
  } catch {
    continue;
  }
  if (buffer.includes(0)) continue;
  const lines = buffer.toString("utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/cls_(?:msgr|ig_dm|wa|whatsapp)_[a-z0-9]{16,}/i.test(line)) {
      failures.push(`${file}:${index + 1}: literal Meta verify-token value`);
      return;
    }
    const appSecret = line.match(/(?:META_APP_SECRET|(?:Meta\s+)?App Secret)\s*(?:\||:|=)\s*`?["']?([^`"'|\s]+)/i)?.[1];
    if (appSecret && appSecret !== placeholder && !obviouslySynthetic(appSecret) && /^[a-f0-9]{20,}$/i.test(appSecret)) {
      failures.push(`${file}:${index + 1}: literal Meta App Secret value`);
    }
    const verifyToken = line.match(/(?:META_(?:MESSENGER|INSTAGRAM|WHATSAPP)_VERIFY_TOKEN|(?:Messenger|Instagram|WhatsApp) verify token)\s*(?:\||:|=)\s*`?["']?([^`"'|\s]+)/i)?.[1];
    if (verifyToken && !obviouslySynthetic(verifyToken) && verifyToken.length >= 16) {
      failures.push(`${file}:${index + 1}: literal Meta verify-token assignment`);
    }
  });
}

if (failures.length) {
  console.error(`FAIL: ${failures.length} committed Meta credential assignment(s) found.`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`PASS: ${tracked.length} tracked paths checked; no committed Meta credential assignment found.`);
