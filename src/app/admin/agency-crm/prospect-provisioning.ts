/**
 * Uses the contact email by default while preserving an explicit override.
 * Passing null deliberately prevents a firm-level email from being assigned
 * to a named person when the source distinguishes those records.
 */
export function resolveProvisionedPersonEmail(
  contactEmail: string | null,
  provisionedPersonEmail?: string | null,
): string | null {
  return provisionedPersonEmail === undefined ? contactEmail : provisionedPersonEmail;
}
