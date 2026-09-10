/** Normalize callback numbers at the Voice-to-Screen provider boundary.
 * Callers in Canada and the US may naturally state ten digits; storage and
 * allowlist comparisons remain canonical E.164.
 */
export function normalizeVoiceScreenPhone(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  const validNanpTen = /^[2-9]\d{2}[2-9]\d{6}$/;

  if (digits.length === 10) return validNanpTen.test(digits) ? `+1${digits}` : "";
  if (digits.length === 11 && digits.startsWith("1")) {
    return validNanpTen.test(digits.slice(1)) ? `+${digits}` : "";
  }

  return /^\+[1-9]\d{7,14}$/.test(trimmed) ? trimmed : "";
}
