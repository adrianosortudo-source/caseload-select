/**
 * WCAG 2.1 contrast ratio, computed from getComputedStyle color strings.
 * getComputedStyle always resolves to rgb()/rgba(), never hex or named
 * colors, so that is the only format this needs to parse.
 */

export interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseCssColor(value: string): ParsedColor | null {
  const m = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Number(m[4]) : 1,
  };
}

function channelLuminance(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: ParsedColor): number {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  );
}

export function contrastRatio(a: ParsedColor, b: ParsedColor): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastCheckResult =
  | { checkable: true; ratio: number; textColor: ParsedColor; backgroundColor: ParsedColor }
  | { checkable: false; reason: "transparent_background" | "unparseable_color" };

/**
 * A getComputedStyle backgroundColor of "rgba(0, 0, 0, 0)" means the
 * element itself paints nothing; the effective background comes from an
 * ancestor this single-element sample cannot see. Rather than assume
 * white (which would silently fabricate a pass or fail that never
 * happened), this is reported as not checkable. Evidence-bounded: no
 * finding claims more than what was actually measured.
 */
export function checkTextContrast(textColorRaw: string, backgroundColorRaw: string): ContrastCheckResult {
  const textColor = parseCssColor(textColorRaw);
  const backgroundColor = parseCssColor(backgroundColorRaw);
  if (!textColor || !backgroundColor) {
    return { checkable: false, reason: "unparseable_color" };
  }
  if (backgroundColor.a === 0) {
    return { checkable: false, reason: "transparent_background" };
  }
  return {
    checkable: true,
    ratio: contrastRatio(textColor, backgroundColor),
    textColor,
    backgroundColor,
  };
}
