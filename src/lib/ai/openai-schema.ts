/**
 * Translate a Google structured-output schema to the strict JSON Schema used by
 * Responses. These schemas declare every object property as required. Reject an
 * optional property rather than silently changing an existing output contract.
 */
export function toOpenAIJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { type, properties, items, nullable, ...rest } = schema;
  if (typeof type !== "string") throw new Error("Expected a single schema type");
  const kind = type.toLowerCase();
  const result: Record<string, unknown> = { ...rest, type: nullable ? [kind, "null"] : kind };

  if (result.format === "enum") delete result.format;
  if (nullable && Array.isArray(rest.enum) && !rest.enum.includes(null)) {
    result.enum = [...rest.enum, null];
  }
  if (kind === "array") result.items = toOpenAIJsonSchema(items as Record<string, unknown>);
  if (kind === "object") {
    const entries = Object.entries(properties as Record<string, Record<string, unknown>>);
    const required = new Set(Array.isArray(rest.required) ? rest.required : []);
    if (entries.some(([key]) => !required.has(key))) {
      throw new Error("Optional schema properties require an explicit representation for OpenAI");
    }
    result.properties = Object.fromEntries(entries.map(([key, value]) => [key, toOpenAIJsonSchema(value)]));
    result.additionalProperties = false;
  }
  return result;
}
