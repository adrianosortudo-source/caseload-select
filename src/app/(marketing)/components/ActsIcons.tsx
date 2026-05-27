/**
 * ACTS pillar icons
 *
 * Bespoke SVG, hand-built from primitives matching v45's stroke-width and
 * visual language. Each icon has its own metaphor:
 *
 *   Authority — shield with check + radiating lines (trust signal)
 *   Capture   — beacon with pulse rings + downward target (visibility radiating outward)
 *   Target    — concentric rings with center dot and converging arrows (precision)
 *   Screen    — funnel with internal filter lines + score badge (qualification)
 *
 * All icons render at 42×42 in the hero pillar wrap. Stroke and fill come
 * from the parent .pillar-icon-wrap CSS, not from these components.
 */

const baseProps = {
  viewBox: "0 0 100 100",
  width: "42",
  height: "42",
  fill: "none",
} as const;

export function IconAuthority() {
  return (
    <svg {...baseProps} aria-hidden="true">
      {/* Outer radiating dashed ring */}
      <circle cx="50" cy="50" r="38" strokeDasharray="2 7" opacity="0.25" />
      {/* Shield */}
      <path d="M50 18L26 27v17c0 14 12 24 24 28 12-4 24-14 24-28V27L50 18Z" strokeWidth="1.8" />
      {/* Inner shield outline */}
      <path d="M50 28L34 34v11c0 9 7.5 16 16 19 8.5-3 16-10 16-19V34L50 28Z" opacity="0.45" />
      {/* Check */}
      <path d="M40 49l7 7 14-15" strokeWidth="2.4" />
      {/* Authority dots */}
      <circle cx="50" cy="12" r="1.6" fill="currentColor" opacity="0.6" />
      <circle cx="50" cy="88" r="1.6" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

export function IconCapture() {
  return (
    <svg {...baseProps} aria-hidden="true">
      {/* Beacon — vertical mast */}
      <line x1="50" y1="22" x2="50" y2="72" strokeWidth="1.8" />
      {/* Top dot (the source) */}
      <circle cx="50" cy="22" r="3.5" strokeWidth="1.8" fill="currentColor" />
      {/* Three concentric pulse arcs spreading out from the top */}
      <path d="M36 30 Q50 24 64 30" opacity="0.85" />
      <path d="M30 38 Q50 28 70 38" opacity="0.55" />
      <path d="M24 46 Q50 32 76 46" opacity="0.3" />
      {/* Ground base */}
      <line x1="32" y1="78" x2="68" y2="78" strokeWidth="1.4" opacity="0.5" />
      {/* Foot rays */}
      <line x1="40" y1="78" x2="36" y2="86" opacity="0.45" />
      <line x1="50" y1="78" x2="50" y2="88" opacity="0.7" />
      <line x1="60" y1="78" x2="64" y2="86" opacity="0.45" />
    </svg>
  );
}

export function IconTarget() {
  return (
    <svg {...baseProps} aria-hidden="true">
      {/* Concentric rings */}
      <circle cx="50" cy="50" r="30" opacity="0.35" />
      <circle cx="50" cy="50" r="20" opacity="0.6" />
      <circle cx="50" cy="50" r="10" opacity="0.85" />
      {/* Center dot */}
      <circle cx="50" cy="50" r="2.6" fill="currentColor" />
      {/* Four converging arrows (NE / SE / SW / NW) */}
      <path d="M76 24 L66 34 M70 28 L66 34 L72 34" strokeWidth="1.8" />
      <path d="M76 76 L66 66 M72 66 L66 66 L66 72" strokeWidth="1.8" />
      <path d="M24 76 L34 66 M34 72 L34 66 L28 66" strokeWidth="1.8" />
      <path d="M24 24 L34 34 M28 34 L34 34 L34 28" strokeWidth="1.8" />
    </svg>
  );
}

export function IconScreen() {
  return (
    <svg {...baseProps} aria-hidden="true">
      {/* Funnel outline — wide at top, narrow at bottom */}
      <path d="M20 22 H80 L60 50 V70 L40 78 V50 L20 22 Z" strokeWidth="1.8" strokeLinejoin="round" />
      {/* Internal filter lines (the screen) */}
      <line x1="28" y1="32" x2="72" y2="32" opacity="0.55" />
      <line x1="33" y1="40" x2="67" y2="40" opacity="0.4" />
      {/* Score badge at the bottom (the qualified output) */}
      <circle cx="50" cy="84" r="8" strokeWidth="1.8" />
      <path d="M44 84 L48 88 L56 80" strokeWidth="2" />
      {/* Drop trail from funnel to badge */}
      <line x1="50" y1="78" x2="50" y2="76" opacity="0.4" />
    </svg>
  );
}
