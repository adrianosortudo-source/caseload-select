/** Public-source evidence retained independently from qualification and selection. */
export type GtaProspectIntakeChannel = string | Readonly<{
  kind: string;
  sourceUrl: string;
  visibleFields?: readonly string[];
}>;

export function intakeChannelKind(channel: GtaProspectIntakeChannel): string {
  return typeof channel === "string" ? channel : channel.kind;
}

/** Validate shape without rewriting source text, ordering, or duplicate observations. */
export function isIntakeChannel(value: unknown): value is GtaProspectIntakeChannel {
  if (typeof value === "string") return Boolean(value.trim());
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !["kind", "sourceUrl", "visibleFields"].includes(key))) return false;
  if (typeof item.kind !== "string" || !item.kind.trim() || typeof item.sourceUrl !== "string" || !item.sourceUrl.trim()) return false;
  try {
    const url = new URL(item.sourceUrl);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || item.sourceUrl !== item.sourceUrl.trim() || /[\u0000-\u0020\u007f]/.test(item.sourceUrl)) return false;
  } catch { return false; }
  return !Object.hasOwn(item, "visibleFields") || (Array.isArray(item.visibleFields) && item.visibleFields.every(field => typeof field === "string" && Boolean(field.trim())));
}
