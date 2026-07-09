/**
 * ACTS pillar icons.
 *
 * Selected premium family:
 * - Authority: column / institution mark
 * - Capture: channel intake paths
 * - Target: focus frame
 * - Screen: ranked intake gate
 *
 * Primary strokes inherit currentColor. Stone accents use the marketing token
 * with a currentColor fallback for contexts outside the marketing shell.
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
      <path d="M24 76h52" strokeWidth="1.65" />
      <path d="M30 68h40" strokeWidth="1.65" />
      <path d="M35 32h30" strokeWidth="1.65" />
      <path d="M40 32v36M50 32v36M60 32v36" strokeWidth="1.65" />
      <path d="M26 28l24-12 24 12H26Z" strokeWidth="1.65" />
      <path d="M32 82h36" strokeWidth="1.25" opacity="0.62" />
      <path d="M50 8v8M50 84v8" strokeWidth="1.25" strokeDasharray="2.4 5" opacity="0.38" />
      <rect x="47" y="23" width="6" height="6" fill="var(--stone, currentColor)" stroke="none" />
    </svg>
  );
}

export function IconCapture() {
  return (
    <svg {...baseProps} aria-hidden="true">
      <path d="M20 30h18M20 50h18M20 70h18" strokeWidth="1.25" opacity="0.62" />
      <path d="M38 30c15 0 15 20 30 20M38 50h30M38 70c15 0 15-20 30-20" strokeWidth="1.65" />
      <path d="M68 38h12v24H68V38Z" stroke="var(--stone, currentColor)" strokeWidth="2.15" />
      <circle cx="26" cy="30" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="26" cy="50" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="26" cy="70" r="2.4" fill="currentColor" stroke="none" />
      <rect x="74" y="47" width="5" height="5" fill="var(--stone, currentColor)" stroke="none" />
    </svg>
  );
}

export function IconTarget() {
  return (
    <svg {...baseProps} aria-hidden="true">
      <path d="M24 38V24h14M62 24h14v14M76 62v14H62M38 76H24V62" strokeWidth="1.65" />
      <path d="M50 28v12M50 60v12M28 50h12M60 50h12" strokeWidth="1.25" opacity="0.62" />
      <circle cx="50" cy="50" r="11" strokeWidth="1.65" />
      <rect x="47" y="47" width="6" height="6" fill="var(--stone, currentColor)" stroke="none" />
    </svg>
  );
}

export function IconScreen() {
  return (
    <svg {...baseProps} aria-hidden="true">
      <path d="M50 10a40 40 0 1 1 0 80 40 40 0 1 1 0-80Z" strokeWidth="1.25" strokeDasharray="2.4 5" opacity="0.38" />
      <path d="M26 26h48v18L58 59v15L42 80V59L26 44V26Z" strokeWidth="1.65" />
      <path d="M34 36h32M38 44h24" strokeWidth="1.25" opacity="0.62" />
      <path d="M36 70h10M54 70h10" stroke="var(--stone, currentColor)" strokeWidth="2.15" />
      <rect x="47" y="61" width="6" height="6" fill="var(--stone, currentColor)" stroke="none" />
    </svg>
  );
}
