/**
 * Decides whether a deliverable's preview hero carries the live-HTML headline
 * overlay, and which anchor it uses.
 *
 * Why this exists: the weekly masters and their web crops are deliberately
 * text-free (CSB `format-image-web`: "Web surfaces never bake text into an
 * image ... Because the web derivative is text-free, one asset serves English
 * and Portuguese"). The website sets the eyebrow and headline as live HTML
 * over the photograph. The portal preview previously rendered the title above
 * a bare photograph instead, so a reviewer could not see the finished article
 * and would reasonably report the image as "missing its text".
 *
 * The anchor is the CSB's fifth axis, scrim text anchor, applied to the hero:
 * the Counsel Note anchors LOW over a bottom-up linear scrim
 * (`format-image-hero`); the Clause in the Margin anchors IN THE MARGIN, into
 * the empty ground its composition already reserves, over a radial vignette
 * (`format-clause-overlay`, which states a Clause hero built to the Counsel
 * Note's bottom-band values "is now the defect, not the other way round").
 *
 * Pure: no I/O, no DOM. The renderer composes this with the actual markup.
 */

export type HeroOverlayAnchor = "low" | "margin";

export interface HeroOverlay {
  /** Rendered above the headline, in brass small caps. The deliverable's own
   *  format name, so a Portuguese row yields its Portuguese eyebrow. */
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
 * Returns the overlay for a deliverable, or null when the preview should show
 * the photograph plain.
 *
 * Only website articles get one. A LinkedIn feed cover and a GBP card already
 * carry their text baked into the raster under their own rules, so drawing a
 * second headline over them would restate the same line twice -- the failure
 * `format-image-linkedin` names when it says the baked line "loses". A lead
 * magnet, a landing page, and the Minute are not article surfaces at all.
 */
export function heroOverlayFor(d: HeroOverlayInput): HeroOverlay | null {
  if (d.deliverable_role !== "article") return null;
  if (d.publication_destination !== "firm_website") return null;
  const eyebrow = (d.format ?? "").trim();
  if (!eyebrow) return null;
  return {
    eyebrow,
    anchor: isMarginAnchoredFormat(d.format) ? "margin" : "low",
  };
}
