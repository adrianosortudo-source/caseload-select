/**
 * Per-firm, email-safe correspondence tokens.
 *
 * Derived from the firm's widget theme (intake_firms.branding.theme), but
 * resolved to SOLID hex only. Email clients (Outlook especially) do not
 * support rgba(), so the theme's rgba border and muted tokens are
 * alpha-blended to solid here. The font stack is a fixed email-safe serif
 * chain (the widget's next/font CSS variable has no meaning inside an email).
 *
 * resolveEmailBranding returns null when the firm has no configured theme.
 * That null is the signal every email builder uses to keep its existing
 * default rendering, so non-themed firms are left byte-for-byte unchanged.
 * Today only DRG Law carries a theme, so only DRG receives the shell.
 */

import type { FirmBranding } from "@/lib/widget-theme";

export interface EmailBranding {
  /** Page and section ground (cream / paper). */
  paper: string;
  /** Shell fill sitting on the paper ground. */
  surface: string;
  /** Primary text (ink). */
  ink: string;
  /** Secondary text, solid, alpha-blended from the theme's muted token. */
  inkMuted: string;
  /** Hairlines and shell border (brass). */
  brass: string;
  /** Subtle inner divider between detail rows. */
  rowDivider: string;
  /** Restrained accent and CTA fill (oxblood). */
  oxblood: string;
  /** Text colour that reads on the oxblood fill. */
  oxbloodText: string;
  /** Small-caps label / wordmark sub colour. */
  taupe: string;
  /** Email-safe serif stack (Source Serif first, Georgia / Times fallback). */
  fontStack: string;
  /** Full legal firm name (footer, document title). */
  firmName: string;
  /** Header wordmark: firm name minus the corporate suffix. */
  wordmark: string;
  /** Small-caps line under the wordmark (the corporate suffix), or "". */
  wordmarkSub: string;
}

const EMAIL_FONT_STACK =
  "'Source Serif 4','Source Serif Pro',Georgia,'Times New Roman',serif";

// Warm neutrals that belong to the correspondence system rather than to any one
// firm's accent. They read correctly on a cream ground for any themed firm and
// match the production layouts in ProductionLayouts/.
const ROW_DIVIDER = "#E0DDD6";
const WORDMARK_SUB = "#8C7D6E";

// Legal-entity designations peeled off the wordmark and shown as the
// small-caps sub line. "Law" stays on the wordmark line.
const CORP_SUFFIX = /\s+(Professional Corporation|P\.?C\.?|LLP|LLC)$/i;

function splitWordmark(firmName: string): { wordmark: string; sub: string } {
  const name = (firmName ?? "").trim();
  const m = name.match(CORP_SUFFIX);
  if (m && typeof m.index === "number") {
    return { wordmark: name.slice(0, m.index).trim(), sub: m[1].trim() };
  }
  return { wordmark: name, sub: "" };
}

/**
 * Resolve a firm's email correspondence tokens. Returns null when the firm has
 * no theme (the caller keeps its default rendering). Pure and synchronous, and
 * never throws: partial data falls back to safe solids.
 */
export function resolveEmailBranding(
  branding: FirmBranding | null | undefined,
): EmailBranding | null {
  const theme = branding?.theme;
  if (!theme || !theme.colors) return null;

  const c = theme.colors;
  const firmName = (branding?.firm_name ?? "").trim();
  const { wordmark, sub } = splitWordmark(firmName);

  return {
    paper: solid(c.bg, "#EFE9DD"),
    surface: solid(c.surface, "#FFFCF6"),
    ink: solid(c.text, "#1A1410"),
    inkMuted: solid(c.textMuted, "#6B655E", c.bg),
    brass: solid(c.borderHover, "#B8956A"),
    rowDivider: ROW_DIVIDER,
    oxblood: solid(c.accent, "#6E2C2C"),
    oxbloodText: solid(c.accentText, "#FFFCF6"),
    taupe: WORDMARK_SUB,
    fontStack: EMAIL_FONT_STACK,
    firmName,
    wordmark: wordmark || firmName,
    wordmarkSub: sub,
  };
}

/**
 * Coerce a colour token to a solid hex usable in email. A hex passes through,
 * an rgba() is alpha-blended over the ground (default paper), and anything
 * else returns the fallback. Guarantees the shell never emits rgba().
 */
function solid(token: string | undefined, fallback: string, groundHex?: string): string {
  if (!token) return fallback;
  if (/^#[0-9a-f]{6}$/i.test(token)) return token;
  const rgba = parseRgba(token);
  if (!rgba) return fallback;
  const ground = parseHex(groundHex ?? "") ?? parseHex(fallback) ?? { r: 239, g: 233, b: 221 };
  const a = rgba.a;
  return toHex(
    Math.round(rgba.r * a + ground.r * (1 - a)),
    Math.round(rgba.g * a + ground.g * (1 - a)),
    Math.round(rgba.b * a + ground.b * (1 - a)),
  );
}

function parseRgba(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (!m) return null;
  return {
    r: +m[1],
    g: +m[2],
    b: +m[3],
    a: m[4] === undefined ? 1 : Math.max(0, Math.min(1, +m[4])),
  };
}

function parseHex(s: string): { r: number; g: number; b: number } | null {
  const m = s.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
