import { stableProspectEnrichmentJson, type ProspectEnrichmentJsonValue } from "./prospect-enrichment-json";

export const ORIGINAL_NODE_SCHEMA = "prospect-original-nodes/v1" as const;
export const ORIGINAL_NODE_LIMITS = Object.freeze({ nodes: 10_000, depth: 32, pointerBytes: 2_048, stringBytes: 65_536, bodyBytes: 2_097_152 });
type Scalar = null | boolean | number | string;
export type OriginalJsonNode = Readonly<{ pointer: string; type: "object" | "array" | "null" | "boolean" | "number" | "string" | "string_chunks"; value: Scalar | readonly string[] }>;
export type OriginalNodeDocument = Readonly<{ schemaVersion: typeof ORIGINAL_NODE_SCHEMA; nodeCount: number; nodes: readonly OriginalJsonNode[] }>;
const encoder = new TextEncoder();
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
const part = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
const bytes = (text: string) => encoder.encode(text).byteLength;
function fail(): never { throw Error("original_node_representation_invalid"); }
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function bounded(value: unknown) {
  if (bytes(stableProspectEnrichmentJson(value)) > ORIGINAL_NODE_LIMITS.bodyBytes) fail();
}
function stringChunks(value: string): string[] {
  const result: string[] = []; let current = "", count = 0;
  for (const character of value) {
    const length = bytes(character);
    if (count + length > ORIGINAL_NODE_LIMITS.stringBytes) { result.push(current); current = ""; count = 0; }
    current += character; count += length;
  }
  if (current || !result.length) result.push(current);
  return result;
}

/** A reversible transport representation. It never supplies evidence, dates, identity or completeness. */
export function encodeOriginalJsonNodes(value: unknown): OriginalNodeDocument {
  const nodes: OriginalJsonNode[] = [], ancestors = new Set<object>();
  let transportBytes = 0;
  const appendNode = (node: OriginalJsonNode) => {
    // Every node is shallow and typed before serialization. Stop before accumulating an oversized document.
    transportBytes += bytes(stableProspectEnrichmentJson(node)) + 1;
    if (transportBytes > ORIGINAL_NODE_LIMITS.bodyBytes) fail();
    nodes.push(node);
  };
  type Frame = { value: unknown; pointer: string; depth: number; leave?: boolean };
  const stack: Frame[] = [{ value, pointer: "", depth: 0 }];
  while (stack.length) {
    const frame = stack.pop()!;
    const { value: item, pointer, depth } = frame;
    if (frame.leave) { ancestors.delete(item as object); continue; }
    if (depth > ORIGINAL_NODE_LIMITS.depth || bytes(pointer) > ORIGINAL_NODE_LIMITS.pointerBytes || nodes.length >= ORIGINAL_NODE_LIMITS.nodes) fail();
    if (item === null || typeof item === "boolean" || typeof item === "number" || typeof item === "string") {
      if (typeof item === "number" && !Number.isFinite(item)) fail();
      if (typeof item === "string" && bytes(item) > ORIGINAL_NODE_LIMITS.stringBytes) {
        if (bytes(item) > ORIGINAL_NODE_LIMITS.bodyBytes) fail();
        appendNode({ pointer, type: "string_chunks", value: stringChunks(item) });
      } else appendNode({ pointer, type: item === null ? "null" : typeof item as "boolean" | "number" | "string", value: item });
      continue;
    }
    if (!Array.isArray(item) && !record(item)) fail();
    if (ancestors.has(item)) fail();
    ancestors.add(item); stack.push({ ...frame, leave: true });
    appendNode({ pointer, type: Array.isArray(item) ? "array" : "object", value: null });
    if (Array.isArray(item)) {
      if (item.length > ORIGINAL_NODE_LIMITS.nodes) fail();
      for (let i = item.length - 1; i >= 0; i--) {
        if (!Object.hasOwn(item, i)) fail();
        stack.push({ value: item[i], pointer: pointer + "/" + i, depth: depth + 1 });
      }
    } else {
      const keys = Object.keys(item).sort();
      if (keys.length > ORIGINAL_NODE_LIMITS.nodes) fail();
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i]; if (forbiddenKeys.has(key)) fail();
        stack.push({ value: item[key], pointer: pointer + "/" + part(key), depth: depth + 1 });
      }
    }
  }
  const result: OriginalNodeDocument = { schemaVersion: ORIGINAL_NODE_SCHEMA, nodeCount: nodes.length, nodes };
  bounded(result);
  // The decoded logical evidence has its own bound in addition to the transport bound.
  bounded(value);
  return result;
}

/** Strict RFC 6901 reconstruction: explicit containers, exact scalars and contiguous array indexes. */
export function decodeOriginalJsonNodes(value: unknown): ProspectEnrichmentJsonValue {
  if (!record(value) || !exact(value, ["schemaVersion", "nodeCount", "nodes"]) || value.schemaVersion !== ORIGINAL_NODE_SCHEMA ||
      !Array.isArray(value.nodes) || !Number.isSafeInteger(value.nodeCount) || value.nodeCount !== value.nodes.length ||
      value.nodes.length < 1 || value.nodes.length > ORIGINAL_NODE_LIMITS.nodes) fail();
  const seen = new Map<string, ProspectEnrichmentJsonValue>();
  let root: ProspectEnrichmentJsonValue = null, transportBytes = 0;
  for (let i = 0; i < value.nodes.length; i++) {
    const node: unknown = value.nodes[i];
    if (!record(node) || !exact(node, ["pointer", "type", "value"]) || typeof node.pointer !== "string" ||
        bytes(node.pointer) > ORIGINAL_NODE_LIMITS.pointerBytes || (i === 0 ? node.pointer !== "" : !node.pointer.startsWith("/")) || seen.has(node.pointer)) fail();
    const parts = node.pointer === "" ? [] : node.pointer.slice(1).split("/");
    if (parts.length > ORIGINAL_NODE_LIMITS.depth || parts.some(segment => /~(?![01])/.test(segment))) fail();
    const decodedParts = parts.map(segment => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (decodedParts.some(key => forbiddenKeys.has(key))) fail();
    let child: ProspectEnrichmentJsonValue;
    if (node.type === "object" || node.type === "array") {
      if (node.value !== null) fail();
      child = node.type === "object" ? {} : [];
    } else if (node.type === "null") { if (node.value !== null) fail(); child = null; }
    else if (node.type === "boolean") { if (typeof node.value !== "boolean") fail(); child = node.value; }
    else if (node.type === "number") { if (typeof node.value !== "number" || !Number.isFinite(node.value)) fail(); child = node.value; }
    else if (node.type === "string") { if (typeof node.value !== "string" || bytes(node.value) > ORIGINAL_NODE_LIMITS.stringBytes) fail(); child = node.value; }
    else if (node.type === "string_chunks") {
      if (!Array.isArray(node.value) || !node.value.length || node.value.length > 64 ||
          node.value.some(segment => typeof segment !== "string" || segment.length === 0 || bytes(segment) > ORIGINAL_NODE_LIMITS.stringBytes)) fail();
      child = (node.value as string[]).join("");
      if (bytes(child) <= ORIGINAL_NODE_LIMITS.stringBytes || bytes(child) > ORIGINAL_NODE_LIMITS.bodyBytes) fail();
    } else fail();
    // Only this validated shallow node is serialized; malformed descendants never reach recursion.
    transportBytes += bytes(stableProspectEnrichmentJson(node)) + 1;
    if (transportBytes > ORIGINAL_NODE_LIMITS.bodyBytes) fail();
    if (i === 0) root = child;
    else {
      const separator = node.pointer.lastIndexOf("/"), parentPointer = node.pointer.slice(0, separator), key = decodedParts[decodedParts.length - 1];
      if (!seen.has(parentPointer)) fail();
      const parent = seen.get(parentPointer);
      if (Array.isArray(parent)) {
        if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) !== parent.length) fail();
        parent.push(child);
      } else if (record(parent)) {
        if (Object.hasOwn(parent, key)) fail();
        parent[key] = child;
      } else fail();
    }
    seen.set(node.pointer, child);
  }
  // Only validated shallow nodes reach the recursive canonical byte measurement.
  bounded(value);
  bounded(root);
  return root;
}
