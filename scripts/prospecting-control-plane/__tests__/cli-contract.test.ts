import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const cli = readFileSync(resolve(process.cwd(), "scripts/prospecting-control-plane/cli.ts"), "utf8");

describe("prospecting provisioning CLI safety contract", () => {
  it("never overwrites a final receipt and enforces the effective SQL payload limit", () => {
    expect(cli).toContain('import { link, readFile, unlink, writeFile } from "node:fs/promises"');
    expect(cli).toContain("await link(temporaryPath, path)");
    expect(cli).not.toContain("await rename(temporaryPath, path)");
    expect(cli).toContain("SQL_EFFECTIVE_SOURCE_PAYLOAD_LIMIT_BYTES = 50_000");
    expect(cli).toContain("person_email_attribution: record.person?.email_attribution ?? null");
    expect(cli).toContain("assertSqlEffectivePayloadLimit(manifest.records)");
  });
});
