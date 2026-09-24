import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";

export type ProspectProfileField = Readonly<{ path: string; value: string }>;
const pointerToken = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** Exact scalar facets over the returned read model, including original statuses,
 * null/false values, evidence URLs and dates. No identity or status is inferred.
 * Values use JSON scalar encoding to distinguish false from "false".
 */
export function prospectProfileFields(record: ReconciledGtaProspect): ProspectProfileField[] {
  const fields: ProspectProfileField[] = [];
  function visit(value: unknown, path: string): void {
    if (value === undefined) return;
    if (value === null || typeof value !== "object") {
      fields.push({ path, value: JSON.stringify(value) });
      return;
    }
    for (const [key, item] of Object.entries(value)) visit(item, path + "/" + pointerToken(key));
  }
  visit(record, "");
  return fields;
}

export function prospectProfileSearch(record: ReconciledGtaProspect): string {
  // JSON also retains empty structures and all property names in general search.
  return JSON.stringify(record).toLocaleLowerCase();
}

export function prospectProfileFieldLabel(path: string): string {
  return path.slice(1).split("/").map(part => part.replaceAll("~1", "/").replaceAll("~0", "~").replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")).join(" / ");
}

export function prospectProfileValueLabel(value: string): string {
  const scalar: unknown = JSON.parse(value);
  return scalar === null ? "Not recorded (null)" : typeof scalar === "string" ? scalar || "Empty text" : String(scalar);
}
