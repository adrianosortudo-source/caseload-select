/**
 * Wire types shared between the render service and the main app. This file
 * must stay byte-for-byte identical to
 * src/lib/design-check/render-types.ts in the main app repo -- enforced by
 * scripts/check-render-service-parity.mjs, which both `npm run build` (via
 * the CI job) and a dedicated CI step run. Edit one, copy to the other,
 * never hand-diverge them.
 *
 * Extracted from the pre-isolation src/lib/design-check/renderer.ts, which
 * defined these interfaces inline alongside the browser-launching code
 * itself. Splitting them out is what lets the main app depend on the
 * *shape* of a render result without depending on Playwright or a browser
 * at all (see docs/BUILD_PLAN_render_isolation_v1.md).
 *
 * One deliberate change from the in-process type: `RenderCapture.html` is
 * deleted entirely, not just omitted from the HTTP response. It was the
 * uncapped `page.content()` output, verified consumed nowhere downstream
 * (every dimension scorer and the aggregate/vision layers read only
 * `domSnapshot`), so carrying it across the wire would be an unbounded,
 * attacker-influenced payload with no consumer.
 */

export type ViewportName = "mobile" | "desktop";

export interface BlockedRequestLog {
  url: string;
  reason: string;
}

export interface RenderCapture {
  viewport: ViewportName;
  finalUrl: string;
  /** Base64-encoded PNG on the wire; the main app decodes to a Buffer at
   * the fetch boundary before this ever reaches judgeAuthorityScreenshot
   * or judgeScreenshot. */
  screenshotPng: string;
  /** The page's real full height when the capture had to be clipped to
   * stay under the vision API's pixel ceiling, else null. Non-null means
   * the judgment pass saw the top of the page, not all of it, and the
   * report must say so rather than implying whole-page coverage. */
  screenshotClippedFromPx: number | null;
  domSnapshot: DomSnapshot;
  webVitals: WebVitalsSample;
  blockedRequests: BlockedRequestLog[];
  renderMs: number;
}

export interface FormFieldSample {
  tag: string;
  type: string | null;
  hasLabel: boolean;
  isPlaceholderOnly: boolean;
  isRequired: boolean;
}

export interface FormSample {
  fieldCount: number;
  fields: FormFieldSample[];
  formTextMentionsRequired: boolean;
}

export interface TapTargetSample {
  tag: string;
  text: string;
  widthPx: number;
  heightPx: number;
}

export interface HamburgerMenuInfo {
  found: boolean;
  hasAccessibleLabel: boolean;
}

export interface ImageSample {
  src: string;
  format: string;
  isLikelyLogo: boolean;
}

export interface LinkSample {
  text: string;
  href: string;
}

export interface BylineSample {
  text: string;
  hasProfileLink: boolean;
}

export interface TestimonialSample {
  text: string;
  hasAttribution: boolean;
}

/** Authority and Positioning module inputs (Phase 3), all extractable from
 * this single rendered page. Cross-page checks the module specifies
 * (message consistency across home/about/service, site-wide NAP
 * consistency) are out of scope per the operator's 2026-07-16 v1
 * single-URL decision; they are not approximated here. */
export interface AuthoritySnapshot {
  /** Best-effort JSON.parse of every <script type="application/ld+json">
   * block. Parse failures are skipped, not thrown. */
  jsonLd: unknown[];
  metaTitle: string | null;
  metaDescription: string | null;
  /** Concatenated heading + paragraph + CTA text, capped, for the
   * self-designation lexicon scan. This is "firm-voiced copy" per the
   * module, not the visitor-facing rendered layout sample above. */
  firmVoicedText: string;
  navLinks: LinkSample[];
  footerLinks: LinkSample[];
  authorBylines: BylineSample[];
  testimonials: TestimonialSample[];
  /** Heuristic list of distinct practice-area/service labels found at
   * equal visual weight (a nav list or card grid), for the
   * generic-full-service signal. */
  practiceAreaLabels: string[];
  /** Text matching a legal-information disclaimer pattern found in the
   * first ~2000 characters of body text. */
  disclaimerPresent: boolean;
}

export interface PreCheckedConsentSample {
  labelText: string;
}

/** Master framework's dark-pattern red-flag inputs (Phase 4). Detection
 * confidence is disclosed per signal, not uniformly claimed: some are
 * fully deterministic from the DOM, others are best-effort text/class/
 * script-signature heuristics because proving them for real needs
 * interaction simulation this v1 static render pass does not do (see
 * dimensions/red-flags.ts for which is which). Never silently reported as
 * "clear" when a signal was not actually checkable. */
export interface DarkPatternSnapshot {
  preCheckedConsentBoxes: PreCheckedConsentSample[];
  /** Text or class/id matches suggesting a countdown timer or scarcity
   * messaging. Best-effort: a real countdown's actual behavior (does it
   * reset on reload, is the scarcity real) needs interaction/reload
   * simulation not run here. */
  urgencyOrCountdownSignals: string[];
  /** Script src or inline-script substrings matching known exit-intent
   * pop-up library signatures. Best-effort only: cannot simulate the
   * mouse-leave trigger itself in a static render. */
  exitIntentScriptSignals: string[];
  /** Raw-number claims ("10,000+ clients", "join 50,000 others") found in
   * firm-voiced text with no adjacent citation. Reuses the Authority
   * module's proof-window logic. */
  bandwagonClaimsWithoutProof: string[];
}

export interface DomSnapshot {
  /** Non-zero margin/padding values (px, one entry per side per element)
   * sampled from layout containers, for the spacing-scale-adherence check. */
  spacingValuesPx: number[];
  h1Count: number;
  h1Text: string | null;
  headingOrder: string[]; // e.g. ["h1","h2","h2","h3"] in DOM order
  headingSamples: TextBlockSample[]; // first element per heading level present (h1..h6)
  bodyTextSample: TextBlockSample[];
  hasHorizontalOverflow: boolean;
  viewportMetaContent: string | null;
  forms: FormSample[];
  tapTargets: TapTargetSample[];
  hamburgerMenu: HamburgerMenuInfo;
  images: ImageSample[];
  authority: AuthoritySnapshot;
  darkPatterns: DarkPatternSnapshot;
}

export interface TextBlockSample {
  tag: string;
  text: string;
  fontSizePx: number;
  fontWeight: string;
  fontFamily: string;
  lineHeightPx: number;
  color: string;
  backgroundColor: string;
  textTransform: string;
  textAlign: string;
  widthPx: number;
  /** Real canvas-measured average glyph width in px for this exact text at
   * this exact font, not a fontSize-based approximation. Used to derive
   * characters-per-line honestly. Null if canvas measurement failed. */
  avgCharWidthPx: number | null;
}

export interface WebVitalsSample {
  lcpMs: number | null;
  cls: number | null;
  ttfbMs: number | null;
  // INP requires real user interaction and cannot be measured in a scripted
  // load; TBT (total blocking time) is the lab-measurable responsiveness
  // proxy. Never present this as INP. See build plan §5 Phase 1 note.
  tbtMs: number | null;
}

export interface RenderRunResult {
  captures: RenderCapture[];
  totalMs: number;
}
