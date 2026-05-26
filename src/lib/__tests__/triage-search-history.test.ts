import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import {
  loadSearchHistory,
  pushSearchHistory,
  removeSearchHistoryEntry,
  clearSearchHistory,
} from "../triage-search-history";

const FIRM_A = "firm-a";
const FIRM_B = "firm-b";

// Vitest defaults to node environment for this project; localStorage is not
// available there. Install a minimal in-memory shim before all tests.
beforeAll(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    const shim: Storage = {
      get length() { return store.size; },
      clear: () => store.clear(),
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (key: string) => { store.delete(key); },
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
    };
    vi.stubGlobal("localStorage", shim);
  }
});

beforeEach(() => {
  localStorage.clear();
});

describe("triage-search-history", () => {
  it("returns empty array when nothing stored", () => {
    expect(loadSearchHistory(FIRM_A)).toEqual([]);
  });

  it("push adds a query to the head", () => {
    pushSearchHistory(FIRM_A, "patel");
    expect(loadSearchHistory(FIRM_A)).toEqual(["patel"]);
  });

  it("push bumps an existing entry to the head, deduped case-insensitively", () => {
    pushSearchHistory(FIRM_A, "patel");
    pushSearchHistory(FIRM_A, "lee");
    pushSearchHistory(FIRM_A, "Patel");
    expect(loadSearchHistory(FIRM_A)).toEqual(["Patel", "lee"]);
  });

  it("push ignores queries shorter than 2 characters", () => {
    pushSearchHistory(FIRM_A, "a");
    pushSearchHistory(FIRM_A, "");
    pushSearchHistory(FIRM_A, "  ");
    expect(loadSearchHistory(FIRM_A)).toEqual([]);
  });

  it("history caps at 8 entries (most recent wins)", () => {
    for (let i = 0; i < 12; i++) {
      pushSearchHistory(FIRM_A, `query-${i}`);
    }
    const history = loadSearchHistory(FIRM_A);
    expect(history.length).toBe(8);
    expect(history[0]).toBe("query-11");
  });

  it("removeSearchHistoryEntry removes by exact match", () => {
    pushSearchHistory(FIRM_A, "patel");
    pushSearchHistory(FIRM_A, "lee");
    removeSearchHistoryEntry(FIRM_A, "patel");
    expect(loadSearchHistory(FIRM_A)).toEqual(["lee"]);
  });

  it("clearSearchHistory empties the history", () => {
    pushSearchHistory(FIRM_A, "patel");
    pushSearchHistory(FIRM_A, "lee");
    clearSearchHistory(FIRM_A);
    expect(loadSearchHistory(FIRM_A)).toEqual([]);
  });

  it("history is scoped per firm", () => {
    pushSearchHistory(FIRM_A, "patel");
    pushSearchHistory(FIRM_B, "lee");
    expect(loadSearchHistory(FIRM_A)).toEqual(["patel"]);
    expect(loadSearchHistory(FIRM_B)).toEqual(["lee"]);
  });

  it("trims whitespace before storing", () => {
    pushSearchHistory(FIRM_A, "  patel  ");
    expect(loadSearchHistory(FIRM_A)).toEqual(["patel"]);
  });

  it("survives corrupted storage gracefully", () => {
    localStorage.setItem("caseload-triage-search-history:firm-a", "{not json");
    expect(loadSearchHistory(FIRM_A)).toEqual([]);
    // Still allows push to recover.
    pushSearchHistory(FIRM_A, "patel");
    expect(loadSearchHistory(FIRM_A)).toEqual(["patel"]);
  });
});
