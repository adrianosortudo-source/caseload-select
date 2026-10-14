import { describe, expect, it } from "vitest";
import { encodeOriginalJsonNodes, decodeOriginalJsonNodes, ORIGINAL_NODE_LIMITS } from "../prospect-enrichment-original-nodes";

type MutableDocument = { schemaVersion: string; nodeCount: number; nodes: { pointer: string; type: string; value: unknown; [key: string]: unknown }[] };

describe("bounded original JSON representation", () => {
  it.each([null, false, 0, "", [], {}, { "a/b": { "~key": [null, false, 0, "", [], {}] }, "0": "object key" }])("preserves scalar and container distinctions %j", value => {
    expect(decodeOriginalJsonNodes(encodeOriginalJsonNodes(value))).toEqual(value);
  });
  it("preserves empty keys, literal escape-like text and repeated acyclic values", () => {
    const shared = { value: null };
    const original = { "": { "~01": { "a/b": shared } }, left: shared, right: shared };
    expect(decodeOriginalJsonNodes(encodeOriginalJsonNodes(original))).toEqual(original);
  });
  it("retains deep receipt evidence without deeply nesting the transport", () => {
    const value: Record<string, unknown> = {}; let current = value;
    for (let i = 0; i < 16; i++) { current.child = {}; current = current.child as Record<string, unknown>; }
    current.answers = { yes: true, unknown: null, contacts: [] };
    const document = encodeOriginalJsonNodes(value);
    expect(decodeOriginalJsonNodes(document)).toEqual(value);
    function depth(value: unknown): number { return value && typeof value === "object" ? 1 + Math.max(0, ...Object.values(value).map(depth)) : 0; }
    expect(depth(document)).toBeLessThanOrEqual(5);
  });
  it("segments a large Unicode source string without dropping or splitting code points", () => {
    const source = "🧭".repeat(40_000);
    const document = encodeOriginalJsonNodes(source);
    expect(document.nodes[0].type).toBe("string_chunks");
    expect(decodeOriginalJsonNodes(document)).toBe(source);
    for (const segment of document.nodes[0].value as string[]) expect(new TextEncoder().encode(segment).byteLength).toBeLessThanOrEqual(ORIGINAL_NODE_LIMITS.stringBytes);
  });
  it.each([
    ["unknown version", (d: MutableDocument) => d.schemaVersion = "other"],
    ["wrong node count", (d: MutableDocument) => d.nodeCount++],
    ["duplicate root", (d: MutableDocument) => { d.nodes.push(d.nodes[0]); d.nodeCount++; }],
    ["missing root", (d: MutableDocument) => d.nodes[0].pointer = "/bad"],
    ["bad pointer escape", (d: MutableDocument) => d.nodes[1].pointer = "/~2"],
    ["missing parent", (d: MutableDocument) => d.nodes[2].pointer = "/missing/0"],
    ["sparse index", (d: MutableDocument) => d.nodes[2].pointer = "/a/2"],
    ["prototype key", (d: MutableDocument) => d.nodes[1].pointer = "/constructor"],
    ["container value", (d: MutableDocument) => d.nodes[0].value = "bad"],
    ["scalar parent", (d: MutableDocument) => { d.nodes[1].type = "string"; d.nodes[1].value = "text"; }],
    ["unknown node key", (d: MutableDocument) => d.nodes[0].hidden = true],
  ])("rejects %s explicitly rather than discarding evidence", (_name, mutate) => {
    const document = structuredClone(encodeOriginalJsonNodes({ a: [1, 2] })) as MutableDocument;
    mutate(document);
    expect(() => decodeOriginalJsonNodes(document)).toThrow("original_node_representation_invalid");
  });
  it("rejects malformed deep transport values before canonical recursion", () => {
    let deep: unknown = {};
    for (let i = 0; i < 20_000; i++) deep = { child: deep };
    expect(() => decodeOriginalJsonNodes({ schemaVersion: "prospect-original-nodes/v1", nodeCount: 1, nodes: [{ pointer: "", type: "object", value: deep }] })).toThrow("original_node_representation_invalid");
    expect(() => decodeOriginalJsonNodes({ schemaVersion: "prospect-original-nodes/v1", nodeCount: 1, nodes: [{ pointer: "", type: "string_chunks", value: [deep] }] })).toThrow("original_node_representation_invalid");
  });
  it("rejects cycles, non-JSON values, sparse arrays, excessive depth and excessive size", () => {
    const cycle: Record<string, unknown> = {}; cycle.child = cycle;
    for (const value of [cycle, undefined, NaN, new Date(), Array(2), { bad: undefined }]) expect(() => encodeOriginalJsonNodes(value)).toThrow();
    const deep: Record<string, unknown> = {}; let current = deep;
    for (let i = 0; i <= ORIGINAL_NODE_LIMITS.depth; i++) { current.child = {}; current = current.child as Record<string, unknown>; }
    expect(() => encodeOriginalJsonNodes(deep)).toThrow();
    expect(() => encodeOriginalJsonNodes("x".repeat(ORIGINAL_NODE_LIMITS.bodyBytes + 1))).toThrow();
    expect(() => encodeOriginalJsonNodes(Array.from({ length: 100 }, () => "x".repeat(ORIGINAL_NODE_LIMITS.stringBytes)))).toThrow("original_node_representation_invalid");
  });
});
