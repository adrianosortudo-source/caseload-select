import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import {
  loadUserViews,
  saveUserView,
  deleteUserView,
  clearUserViews,
} from "../triage-search-views";

const FIRM_A = "firm-a";
const FIRM_B = "firm-b";

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

describe("triage-search-views", () => {
  it("returns empty array when nothing stored", () => {
    expect(loadUserViews(FIRM_A)).toEqual([]);
  });

  it("saveUserView adds a new view to the head", () => {
    saveUserView(FIRM_A, { label: "Patel pending", query: "patel", bands: ["A"], channels: [] });
    const views = loadUserViews(FIRM_A);
    expect(views.length).toBe(1);
    expect(views[0].label).toBe("Patel pending");
    expect(views[0].query).toBe("patel");
    expect(views[0].bands).toEqual(["A"]);
    expect(views[0].channels).toEqual([]);
    expect(typeof views[0].id).toBe("string");
    expect(typeof views[0].createdAt).toBe("string");
  });

  it("saveUserView with duplicate label replaces the existing view", () => {
    saveUserView(FIRM_A, { label: "My view", query: "patel", bands: ["A"], channels: [] });
    saveUserView(FIRM_A, { label: "My view", query: "lee", bands: ["B"], channels: ["voice"] });
    const views = loadUserViews(FIRM_A);
    expect(views.length).toBe(1);
    expect(views[0].query).toBe("lee");
    expect(views[0].bands).toEqual(["B"]);
  });

  it("dedup is case-insensitive on label", () => {
    saveUserView(FIRM_A, { label: "My View", query: "patel", bands: [], channels: [] });
    saveUserView(FIRM_A, { label: "my view", query: "lee", bands: [], channels: [] });
    expect(loadUserViews(FIRM_A).length).toBe(1);
  });

  it("saveUserView ignores empty / whitespace labels", () => {
    saveUserView(FIRM_A, { label: "", query: "patel", bands: [], channels: [] });
    saveUserView(FIRM_A, { label: "   ", query: "lee", bands: [], channels: [] });
    expect(loadUserViews(FIRM_A)).toEqual([]);
  });

  it("saveUserView trims label whitespace", () => {
    saveUserView(FIRM_A, { label: "  Patel  ", query: "patel", bands: [], channels: [] });
    expect(loadUserViews(FIRM_A)[0].label).toBe("Patel");
  });

  it("caps at 12 views — newest replaces oldest", () => {
    for (let i = 0; i < 15; i++) {
      saveUserView(FIRM_A, { label: `view-${i}`, query: "x", bands: [], channels: [] });
    }
    const views = loadUserViews(FIRM_A);
    expect(views.length).toBe(12);
    expect(views[0].label).toBe("view-14");
  });

  it("deleteUserView removes by id", () => {
    saveUserView(FIRM_A, { label: "First", query: "a", bands: [], channels: [] });
    saveUserView(FIRM_A, { label: "Second", query: "b", bands: [], channels: [] });
    const before = loadUserViews(FIRM_A);
    const idToDelete = before.find((v) => v.label === "First")!.id;
    deleteUserView(FIRM_A, idToDelete);
    const after = loadUserViews(FIRM_A);
    expect(after.length).toBe(1);
    expect(after[0].label).toBe("Second");
  });

  it("clearUserViews removes all", () => {
    saveUserView(FIRM_A, { label: "v1", query: "x", bands: [], channels: [] });
    saveUserView(FIRM_A, { label: "v2", query: "y", bands: [], channels: [] });
    clearUserViews(FIRM_A);
    expect(loadUserViews(FIRM_A)).toEqual([]);
  });

  it("views are scoped per firm", () => {
    saveUserView(FIRM_A, { label: "v-A", query: "x", bands: [], channels: [] });
    saveUserView(FIRM_B, { label: "v-B", query: "y", bands: [], channels: [] });
    expect(loadUserViews(FIRM_A).map((v) => v.label)).toEqual(["v-A"]);
    expect(loadUserViews(FIRM_B).map((v) => v.label)).toEqual(["v-B"]);
  });

  it("survives corrupted storage gracefully", () => {
    localStorage.setItem("caseload-triage-user-views:firm-a", "[not json");
    expect(loadUserViews(FIRM_A)).toEqual([]);
    saveUserView(FIRM_A, { label: "v1", query: "x", bands: [], channels: [] });
    expect(loadUserViews(FIRM_A).length).toBe(1);
  });

  it("filters out items that don't match the schema", () => {
    localStorage.setItem(
      "caseload-triage-user-views:firm-a",
      JSON.stringify([{ label: "ok", id: "x", query: "", bands: [], channels: [], createdAt: "now" }, "bogus", { id: 5 }]),
    );
    const views = loadUserViews(FIRM_A);
    expect(views.length).toBe(1);
    expect(views[0].label).toBe("ok");
  });
});
