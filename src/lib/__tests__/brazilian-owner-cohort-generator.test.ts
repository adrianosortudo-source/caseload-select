import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const updateRow = (canonicalPersonId: string, id: string) => ({
  operation: "update",
  id,
  canonical_person_id: canonicalPersonId,
  canonical_firm_id: `BAO-F-${id}`,
  owner_authority: "O1",
  owner_authority_evidence: [`E-${id}`],
  research_eligibility: "primary_owner_cohort",
  research_state: "eligible",
  interview_state: "not_started",
  evidence_confidence: "corroborated",
  domain_relationships: [{ url: `https://${id}.example/`, state: "current_primary", confidence: "corroborated" }],
  contact_source_provenance: [{ field: "website", value: `https://${id}.example/`, source_url: `https://${id}.example/about`, evidence_ids: [`E-${id}`], confidence: "corroborated" }],
  explicit_unknowns: [],
});

describe("Brazilian owner-cohort snapshot generator", () => {
  it("normalizes and sorts an approved JSONL fixture deterministically", () => {
    const directory = mkdtempSync(join(tmpdir(), "caseload-owner-cohort-"));
    tempDirectories.push(directory);
    const source = join(directory, "approved.jsonl");
    const destinationOne = join(directory, "one.ts");
    const destinationTwo = join(directory, "two.ts");
    writeFileSync(source, [updateRow("BAO-P-000002", "second"), updateRow("BAO-P-000001", "first")].map((row) => JSON.stringify(row)).join("\n"));
    const script = resolve("scripts/generate-brazilian-owner-cohort-snapshot.mjs");

    execFileSync(process.execPath, [script, source, destinationOne], { stdio: "pipe" });
    execFileSync(process.execPath, [script, source, destinationTwo], { stdio: "pipe" });
    const first = readFileSync(destinationOne, "utf8");
    const second = readFileSync(destinationTwo, "utf8");

    expect(first).toBe(second);
    expect(first.indexOf("BAO-P-000001")).toBeLessThan(first.indexOf("BAO-P-000002"));
    expect(first).toContain('host": "first.example"');
    expect(first).toContain("satisfies readonly ProspectOwnerCohortUpdate[]");
  });

  it("rejects duplicate canonical people", () => {
    const directory = mkdtempSync(join(tmpdir(), "caseload-owner-cohort-"));
    tempDirectories.push(directory);
    const source = join(directory, "duplicates.jsonl");
    const destination = join(directory, "snapshot.ts");
    writeFileSync(source, [updateRow("BAO-P-SAME", "one"), updateRow("BAO-P-SAME", "two")].map((row) => JSON.stringify(row)).join("\n"));
    const script = resolve("scripts/generate-brazilian-owner-cohort-snapshot.mjs");

    expect(() => execFileSync(process.execPath, [script, source, destination], { stdio: "pipe" })).toThrow();
  });
});
