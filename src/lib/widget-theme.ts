/**
 * Per-firm visual theme for the embeddable CaseLoad Screen widget.
 *
 * The widget runs inside an iframe on the firm's own website. Out of the box
 * it ships in CaseLoad Select colours (navy + gold + parchment + DM Sans /
 * Manrope) so an un-themed firm gets a sensible default. When a firm has its
 * own visual identity, the operator sets `intake_firms.branding.theme` and
 * the widget renders in that palette instead — the firm's prospect sees a
 * surface that reads as their lawyer's brand, not as a third-party tool.
 *
 * Implementation pattern is CSS-variables on the Shell's outer wrapper. Every
 * widget component reads tokens via `var(--cls-*, <fallback>)` so dropping a
 * new firm theme into the database is the entire deploy story — no component
 * code changes.
 *
 * Tokens are deliberately abstract (bg / surface / text / accent / border)
 * rather than colour-named (navy / gold). This keeps DecisionCard etc. brand
 * agnostic — a card asks for "the accent colour", not "navy".
 */

/** Theme tokens consumed by every widget component. */
export interface WidgetTheme {
  colors: {
    /** Page background — the parchment / cream behind the question card. */
    bg: string;
    /** Card / surface fills sitting on top of the page background. */
    surface: string;
    /** Primary text colour. */
    text: string;
    /** Muted text colour for secondary copy. Usually a lower-opacity text. */
    textMuted: string;
    /** Accent — selected option fill, primary CTA fill, progress-dot active. */
    accent: string;
    /** Text colour that reads against the accent fill (CTA label colour). */
    accentText: string;
    /** Default border colour — low-opacity tint of the accent. */
    border: string;
    /** Border on hover — warmer brand accent. */
    borderHover: string;
  };
  fonts: {
    /** Headings + the question text. */
    display: string;
    /** Body copy + interactive controls. */
    body: string;
  };
  /**
   * If true, load the Source Serif 4 font family from Google Fonts at the
   * page level. The widget page bumps fonts via next/font/google so the file
   * goes through Next.js's font pipeline (no FOIT, no third-party CDN at
   * runtime, fully CSP-clean). Set this per theme so other firms only pay
   * the bundle cost when their theme uses Source Serif.
   */
  loadSourceSerif?: boolean;
}

/**
 * Default theme — CaseLoad Select chrome. Every firm without a custom
 * `branding.theme` row gets this. The values mirror the legacy hardcoded
 * colours that lived inline in Shell.tsx and the card components.
 */
export const DEFAULT_WIDGET_THEME: WidgetTheme = {
  colors: {
    bg: "#F4F3EF",
    surface: "#FFFFFF",
    text: "#1E2F58",
    textMuted: "rgba(30, 47, 88, 0.65)",
    accent: "#1E2F58",
    accentText: "#FFFFFF",
    border: "rgba(30, 47, 88, 0.15)",
    borderHover: "#C4B49A",
  },
  fonts: {
    display: "Manrope, sans-serif",
    body: "DM Sans, sans-serif",
  },
};

/**
 * DRG Law theme — oxblood / brass / cream / paper / ink. Source Serif 4 for
 * both display and body. Matches the public website at drglaw.com so the
 * prospect's eye does not see a tool, only the law firm.
 */
export const DRG_WIDGET_THEME: WidgetTheme = {
  colors: {
    bg: "#EFE9DD",
    surface: "#FFFCF6",
    text: "#1A1410",
    textMuted: "rgba(26, 20, 16, 0.62)",
    accent: "#6E2C2C",
    accentText: "#FFFCF6",
    border: "rgba(184, 149, 106, 0.35)",
    borderHover: "#B8956A",
  },
  fonts: {
    // "Source Serif 4" MUST stay quoted: the bare trailing digit makes it an
    // invalid font-family identifier, which renders the whole resolved
    // declaration invalid-at-computed-value-time, so the widget silently
    // falls back to the inherited sans (colors themed, fonts did not). The
    // next/font var resolves to its own quoted family; this is the fallback.
    display: 'var(--font-source-serif-4), "Source Serif 4", serif',
    body: 'var(--font-source-serif-4), "Source Serif 4", serif',
  },
  loadSourceSerif: true,
};

/**
 * Branding shape on `intake_firms.branding`. The theme subfield is the slot
 * a per-firm theme drops into; everything else (lawyer_email, firm_name)
 * lives at the parent level untouched.
 */
export interface FirmBranding {
  firm_name?: string;
  lawyer_email?: string;
  theme?: WidgetTheme | null;
}

/**
 * Resolve the theme to use for a given firm. Falls back to the default
 * CaseLoad Select chrome when the firm has no custom theme set.
 *
 * The function is pure and synchronous — read the branding column off the
 * firm row and call this. It never throws; bad data falls back to default.
 */
export function resolveWidgetTheme(branding: FirmBranding | null | undefined): WidgetTheme {
  const custom = branding?.theme;
  if (!custom) return DEFAULT_WIDGET_THEME;

  // Defense in depth — if the DB row is partial, merge over defaults so we
  // never render with undefined tokens.
  return {
    colors: {
      ...DEFAULT_WIDGET_THEME.colors,
      ...(custom.colors ?? {}),
    },
    fonts: {
      ...DEFAULT_WIDGET_THEME.fonts,
      ...(custom.fonts ?? {}),
    },
    loadSourceSerif: custom.loadSourceSerif ?? false,
  };
}

/**
 * Translate a resolved theme into the CSS-variable map that the Shell's
 * outer div consumes. Variable names are prefixed `--cls-` so they will
 * never collide with the host firm website's own design tokens (the widget
 * lives inside an iframe, but the discipline is the same).
 *
 * Components read these vars with a fallback that matches the default theme,
 * so a component rendered outside the Shell (preview, storybook) still
 * looks correct.
 */
export function themeToCssVars(theme: WidgetTheme): Record<string, string> {
  return {
    "--cls-bg": theme.colors.bg,
    "--cls-surface": theme.colors.surface,
    "--cls-text": theme.colors.text,
    "--cls-text-muted": theme.colors.textMuted,
    "--cls-accent": theme.colors.accent,
    "--cls-accent-text": theme.colors.accentText,
    "--cls-border": theme.colors.border,
    "--cls-border-hover": theme.colors.borderHover,
    "--cls-font-display": theme.fonts.display,
    "--cls-font-body": theme.fonts.body,
  };
}
