import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearSecureImportResumeState,
  isMatchingSecureImportResume,
  loadSecureImportResumeState,
  nextSecureImportResumeIndex,
  saveSecureImportResumeState,
  secureImportChunk,
  secureImportResumeStorageKey,
  type SecureImportCounts,
} from "../secure-import-resume";

const FIRM_ID = "firm-resume-test";
const BATCH_ID = "batch-26-rows";
const FILE_HASH = "01".repeat(32);
const componentPath = path.resolve(__dirname, "../SecureImportRoom.tsx");
const componentSource = fs.readFileSync(componentPath, "utf8");

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const COUNTS_25: SecureImportCounts = {
  processed: 25,
  created: 25,
  existing: 0,
  held: 0,
  invalid: 0,
  failed: 0,
  reconcile: 0,
};

describe("SecureImportRoom resumable browser state", () => {
  it("reloads a firm-scoped 26-row checkpoint and plans only the final row", () => {
    const storage = memoryStorage();
    saveSecureImportResumeState(FIRM_ID, {
      batchId: BATCH_ID,
      fileHash: FILE_HASH,
      rowCount: 26,
      resumeIndex: 25,
      counts: COUNTS_25,
    }, storage);

    expect(secureImportResumeStorageKey(FIRM_ID)).toBe(`secure-import:v1:${FIRM_ID}`);
    expect(loadSecureImportResumeState("another-firm", storage)).toBeNull();

    // A new component instance after a page reload reads the same browser checkpoint.
    const reloaded = loadSecureImportResumeState(FIRM_ID, storage);
    expect(reloaded).toMatchObject({
      batchId: BATCH_ID,
      fileHash: FILE_HASH,
      rowCount: 26,
      resumeIndex: 25,
      counts: COUNTS_25,
    });
    expect(isMatchingSecureImportResume(reloaded, FILE_HASH, 26)).toBe(true);

    const rows = Array.from({ length: 26 }, (_, index) => ({ rowNumber: index + 2 }));
    expect(secureImportChunk(rows, reloaded!.resumeIndex)).toEqual([{ rowNumber: 27 }]);
  });

  it("persists an accepted chunk and clears the checkpoint only after completion", () => {
    const storage = memoryStorage();
    const counts26 = { ...COUNTS_25, processed: 26, created: 26 };
    const nextIndex = nextSecureImportResumeIndex(25);

    saveSecureImportResumeState(FIRM_ID, {
      batchId: BATCH_ID,
      fileHash: FILE_HASH,
      rowCount: 26,
      resumeIndex: nextIndex,
      counts: counts26,
    }, storage);
    expect(loadSecureImportResumeState(FIRM_ID, storage)).toMatchObject({
      resumeIndex: 50,
      counts: counts26,
    });

    clearSecureImportResumeState(FIRM_ID, storage);
    expect(loadSecureImportResumeState(FIRM_ID, storage)).toBeNull();
  });

  it("does not restore a checkpoint for a different file hash or row count", () => {
    const state = {
      batchId: BATCH_ID,
      fileHash: FILE_HASH,
      rowCount: 26,
      resumeIndex: 25,
      counts: COUNTS_25,
    };

    expect(isMatchingSecureImportResume(state, "ff".repeat(32), 26)).toBe(false);
    expect(isMatchingSecureImportResume(state, FILE_HASH, 27)).toBe(false);
  });

  it("wires the pure resume contract into file reselection, chunk sending, and completion UI", () => {
    expect(componentSource).toContain("loadSecureImportResumeState(firmId)");
    expect(componentSource).toContain("isMatchingSecureImportResume(saved, hash, parsed.rows.length)");
    expect(componentSource).toContain("setResumeIndex(Number(saved.resumeIndex ?? 0))");
    expect(componentSource).toContain("setCounts(saved.counts ?? EMPTY_COUNTS)");
    expect(componentSource).toContain('setStatus("importing")');
    expect(componentSource).toContain("await runChunks(batchId, resumeIndex)");
    expect(componentSource).toContain("rows: secureImportChunk(rows, index)");

    const loopStart = componentSource.indexOf("for (let index = startIndex");
    const clearIndex = componentSource.indexOf("clearSecureImportResumeState(firmId)", loopStart);
    const resultsIndex = componentSource.indexOf('setStatus("results")', clearIndex);
    expect(loopStart).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(loopStart);
    expect(resultsIndex).toBeGreaterThan(clearIndex);
  });
});
