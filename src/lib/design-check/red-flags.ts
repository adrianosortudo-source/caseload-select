import type { DarkPatternSnapshot } from "./renderer";
import type { DimensionResult } from "./dimension-types";
import type { AuthorityRedFlag } from "./dimensions/authority";

/**
 * Master framework's dark-pattern red-flag system (Phase 4,
 * WEBSITE_DESIGN_GRADING_FRAMEWORK.md "Red flags that cap the grade").
 * Distinct scope from the Authority module's own red flags
 * (dimensions/authority.ts): those cap the Authority dimension's own
 * score; these cap the overall Track 1 grade. "Do not average away a red
 * flag. A dark pattern or a contrast failure is not offset by a
 * beautiful hero. Cap, do not average."
 *
 * Detection confidence is disclosed per flag, never uniformly claimed:
 * "proven" flags are fully deterministic from the DOM; "best_effort"
 * flags are heuristics (text/class/script-signature matches) because
 * proving them for real needs interaction simulation this v1 static
 * render does not do. A flag that cannot be checked is never reported as
 * clear; it is simply absent from the list, and the report should say so
 * explicitly at the panel level (see aggregate.ts).
 */

export type RedFlagConfidence = "proven" | "best_effort";

export interface RedFlag {
  key: string;
  label: string;
  detail: string;
  ceiling: number;
  confidence: RedFlagConfidence;
  source: "dark_pattern" | "contrast_failure" | "authority_module";
}

const NOT_CHECKABLE_IN_V1 = [
  {
    key: "bait_reciprocity",
    label: "Bait reciprocity (gated offer revealed only after the visitor did the work)",
    reason: "Requires interaction simulation (completing a form or flow to see what is actually delivered), not run against a single static render.",
  },
  {
    key: "color_only_status",
    label: "Status or error shown by color alone",
    reason: "Requires triggering form validation and interactive states to observe; not reliably detectable from a single static render.",
  },
] as const;

export function detectFrameworkRedFlags(
  darkPatterns: DarkPatternSnapshot,
  allDimensions: DimensionResult[],
  authorityRedFlags: AuthorityRedFlag[]
): RedFlag[] {
  const flags: RedFlag[] = [];

  if (darkPatterns.preCheckedConsentBoxes.length > 0) {
    flags.push({
      key: "pre_checked_consent",
      label: "Pre-checked consent or data-sharing default",
      detail: `${darkPatterns.preCheckedConsentBoxes.length} checkbox(es) pre-checked for consent-like purposes: ${darkPatterns.preCheckedConsentBoxes.map((b) => `"${b.labelText}"`).join(", ")}.`,
      ceiling: 79, // "no higher than a C" per the framework's own example
      confidence: "proven",
      source: "dark_pattern",
    });
  }

  if (darkPatterns.urgencyOrCountdownSignals.length > 0) {
    flags.push({
      key: "manufactured_urgency",
      label: "Manufactured urgency or scarcity countdown",
      detail: `Signal(s) found: ${darkPatterns.urgencyOrCountdownSignals.join("; ")}.`,
      ceiling: 79,
      confidence: "best_effort",
      source: "dark_pattern",
    });
  }

  if (darkPatterns.exitIntentScriptSignals.length > 0) {
    flags.push({
      key: "exit_intent_popup",
      label: "Exit-intent last-chance pop-up",
      detail: `Script signature(s) found: ${darkPatterns.exitIntentScriptSignals.join("; ")}.`,
      ceiling: 79,
      confidence: "best_effort",
      source: "dark_pattern",
    });
  }

  if (darkPatterns.bandwagonClaimsWithoutProof.length > 0) {
    flags.push({
      key: "bandwagon_claim_without_proof",
      label: "Raw-number bandwagon claim presented as authority",
      detail: `Claim(s) with no adjacent citation: ${darkPatterns.bandwagonClaimsWithoutProof.join(", ")}.`,
      ceiling: 79,
      confidence: "proven",
      source: "dark_pattern",
    });
  }

  // Contrast failures are promoted from a dimension deduction to a
  // capping flag per the framework's explicit instruction: "Contrast
  // failures on core content (an accessibility floor, not a stylistic
  // preference)" is listed among the red flags, not left as an ordinary
  // deduction a strong hero can average away.
  const colorContrastDimension = allDimensions.find((d) => d.name === "Color and Contrast");
  const contrastFailures = colorContrastDimension?.items.filter((i) => i.status === "fail" && i.scored !== false) ?? [];
  if (contrastFailures.length > 0) {
    flags.push({
      key: "contrast_failure",
      label: "Contrast failure on core content",
      detail: `${contrastFailures.length} element(s) fail WCAG AA contrast: ${contrastFailures.map((i) => i.label).join(", ")}.`,
      ceiling: 79,
      confidence: "proven",
      source: "contrast_failure",
    });
  }

  // The Authority module's own dimension-level capping flags also matter
  // at the overall-grade scope when they are severe enough: an LSO
  // compliance breach or a page with zero verifiable authority is not
  // something a strong Typography score should be able to average away
  // either. Reuse the Authority module's own ceilings rather than
  // inventing separate overall-grade thresholds.
  authorityRedFlags.forEach((f) => {
    flags.push({
      key: f.key,
      label: f.label,
      detail: f.detail,
      ceiling: f.ceiling,
      confidence: "proven",
      source: "authority_module",
    });
  });

  return flags;
}

export interface RedFlagPanel {
  activeFlags: RedFlag[];
  notCheckableInV1: Array<{ key: string; label: string; reason: string }>;
  ceiling: number | null;
}

export function buildRedFlagPanel(
  darkPatterns: DarkPatternSnapshot,
  allDimensions: DimensionResult[],
  authorityRedFlags: AuthorityRedFlag[]
): RedFlagPanel {
  const activeFlags = detectFrameworkRedFlags(darkPatterns, allDimensions, authorityRedFlags);
  const ceiling = activeFlags.length > 0 ? Math.min(...activeFlags.map((f) => f.ceiling)) : null;
  return { activeFlags, notCheckableInV1: [...NOT_CHECKABLE_IN_V1], ceiling };
}
