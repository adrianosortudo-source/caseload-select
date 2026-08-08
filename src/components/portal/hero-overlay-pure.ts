/**
 * Decides whether a deliverable's preview hero carries a live-HTML headline
 * overlay. Under DR-114 the answer is always no.
 *
 * WHY THIS RETURNS NULL, AND WHY THAT IS THE POINT (Operator ruling, 2026-08-08,
 * DR-114): every article image now carries its eyebrow and headline BAKED into
 * the raster, on every surface -- website article hero, homepage feature and
 * card, and the LinkedIn Article cover. The image arrives with its words already
 * in it. Drawing a second headline over it in HTML puts the same line on the
 * card twice, which is exactly the defect Week 3 shipped and had to be fixed.
 *
 * The rule this replaces is RETIRED -- do not restore it from the CSB. The CSB's
 * `format-image-web` still reads "Web surfaces never bake text into an image ...
 * Because the web derivative is text-free, one asset serves English and
 * Portuguese", and this module used to quote that as its justification. The
 * ruling reverses it: baked words are language-specific, so EN and PT are now
 * separate files, and the Operator was shown that doubled production cost and
 * accepted it. Where the CSB and DR-114 disagree, DR-114 governs until Part XI
 * change control lands the amendment.
 *
 * The anchor distinction below is still real, but it moved: the compositor
 * (drg-content-skills, runtime/scripts/render_hero_overlay.py) now bakes the
 * Counsel Note low-left and the Clause into its upper-right open margin. This
 * module no longer positions anything; it only guarantees the portal draws
 * nothing on top.
 *
 * Pure: no I/O, no DOM.
 */

export type HeroOverlayAnchor = "low" | "margin";

export interface HeroOverlay {
  /** Rendered above the headline, in brass small caps. */
  eyebrow: string;
  anchor: HeroOverlayAnchor;
}

/** The minimal shape needed; never the full ContentDeliverable, so tests do
 *  not have to construct every unrelated column. */
export interface HeroOverlayInput {
  format: string | null;
  deliverable_role: string | null;
  publication_destination: string | null;
}

/**
 * Clause-family format names across the locales DRG publishes in. Matched
 * loosely (case- and accent-insensitive substring) so a renamed or
 * re-cased format still resolves rather than silently falling back.
 *
 * Retained because it names which anchor the compositor bakes for a given
 * format, and because the Portuguese names moved under DR-115 ("Cláusula
 * Comentada" replaced "Cláusula na Margem"); accent-insensitive matching is
 * what let that rename land without breaking the mapping.
 */
const CLAUSE_MARKERS = ["clause", "clausula"];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isMarginAnchoredFormat(format: string | null): boolean {
  if (!format) return false;
  const n = normalize(format);
  return CLAUSE_MARKERS.some((m) => n.includes(m));
}

/**
 * Always null: no deliverable's preview hero gets a live-HTML overlay.
 *
 * Kept as a named function rather than inlining `null` at the call site so
 * there is exactly one place to look when asking "why doesn't the portal draw
 * the headline any more", and exactly one place to change if the ruling ever
 * moves again. The parameter is deliberately still accepted for that reason.
 */
export function heroOverlayFor(_d: HeroOverlayInput): HeroOverlay | null {
  return null;
}
