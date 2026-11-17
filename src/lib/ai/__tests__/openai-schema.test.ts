import { describe, expect, it } from "vitest";
import { toOpenAIJsonSchema } from "../openai-schema";

describe("strict Responses schema conversion", () => {
  it("closes nested objects and preserves nullable values, enum restrictions and array bounds", () => {
    const property = { type: "STRING", format: "enum", enum: ["moderate", "low"], nullable: true };
    const object = { type: "OBJECT", nullable: true, required: ["confidence"], properties: { confidence: property } };
    const schema = { type: "ARRAY", maxItems: 3, items: object };
    expect(toOpenAIJsonSchema(schema)).toEqual({
      type: "array", maxItems: 3,
      items: { type: ["object", "null"], additionalProperties: false, required: ["confidence"],
        properties: { confidence: { type: ["string", "null"], enum: ["moderate", "low", null] } } },
    });
    expect(schema.items.properties.confidence.enum).toEqual(["moderate", "low"]);
  });
  it("requires an explicit encoding for optional fields", () => {
    expect(() => toOpenAIJsonSchema({ type: "OBJECT", properties: { comment: { type: "STRING" } }, required: [] }))
      .toThrow("Optional schema properties");
  });
});
