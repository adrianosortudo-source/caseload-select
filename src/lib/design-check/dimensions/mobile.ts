import type { DomSnapshot } from "../renderer";
import { type CheckItem, type DimensionResult, scoreItems } from "../dimension-types";

/**
 * Mobile and responsive (framework weight 6). Only meaningful on the
 * mobile-viewport capture; scoreMobile should be called with that
 * capture's domSnapshot, not the desktop one. Source: framework doc
 * dimension 9, Visual Craft Principles Part 3 §19-20.
 */

const MIN_TAP_TARGET_PX = 44; // WCAG 2.5.5 / Visual Craft Part 3 §20

function checkViewportMeta(content: string | null): CheckItem {
  if (!content) {
    return {
      label: "Viewport meta tag",
      status: "fail",
      detail: "No viewport meta tag found. Without it, mobile browsers render at desktop width and scale down.",
      fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    };
  }
  const hasDeviceWidth = /width\s*=\s*device-width/i.test(content);
  if (hasDeviceWidth) {
    return { label: "Viewport meta tag", status: "pass", detail: "Present and set to device width." };
  }
  return {
    label: "Viewport meta tag",
    status: "warn",
    detail: `Present but does not set width=device-width (found: "${content}").`,
    fix: 'Set content="width=device-width, initial-scale=1".',
  };
}

function checkHorizontalOverflow(hasOverflow: boolean): CheckItem {
  return hasOverflow
    ? {
        label: "Horizontal overflow",
        status: "fail",
        detail: "The page is wider than the mobile viewport, forcing horizontal scroll.",
        fix: "Find the element wider than the viewport (a fixed-width table, image, or container) and constrain it with max-width: 100%.",
      }
    : { label: "Horizontal overflow", status: "pass", detail: "No horizontal overflow at mobile width." };
}

function checkTapTargets(tapTargets: DomSnapshot["tapTargets"]): CheckItem {
  const measurable = tapTargets.filter((t) => t.widthPx > 0 && t.heightPx > 0);
  if (measurable.length === 0) {
    return { label: "Tap target size", status: "pass", detail: "No interactive elements found to check.", scored: false };
  }
  const undersized = measurable.filter((t) => t.widthPx < MIN_TAP_TARGET_PX || t.heightPx < MIN_TAP_TARGET_PX);
  if (undersized.length === 0) {
    return { label: "Tap target size", status: "pass", detail: `All ${measurable.length} sampled tap targets meet the ${MIN_TAP_TARGET_PX}x${MIN_TAP_TARGET_PX}px minimum.` };
  }
  const pct = Math.round((undersized.length / measurable.length) * 100);
  return {
    label: "Tap target size",
    status: pct > 30 ? "fail" : "warn",
    detail: `${undersized.length} of ${measurable.length} sampled tap targets (${pct}%) are smaller than ${MIN_TAP_TARGET_PX}x${MIN_TAP_TARGET_PX}px.`,
    fix: "Increase padding on small links and buttons so the tappable area meets the minimum, even if the visible text stays the same size.",
  };
}

function checkHamburgerLabel(hamburger: DomSnapshot["hamburgerMenu"]): CheckItem {
  if (!hamburger.found) {
    return { label: "Hamburger menu label", status: "pass", detail: "No hamburger-style menu icon detected.", scored: false };
  }
  return hamburger.hasAccessibleLabel
    ? { label: "Hamburger menu label", status: "pass", detail: 'The menu icon carries an accessible name (visible "Menu" text or an aria-label).' }
    : {
        label: "Hamburger menu label",
        status: "warn",
        detail: "A menu icon was found with no accessible name. An unlabeled hamburger icon is a recurring point of confusion.",
        fix: 'Add aria-label="Menu" (or visible "Menu" text) to the menu toggle control.',
      };
}

export function scoreMobile(mobileDomSnapshot: DomSnapshot): DimensionResult {
  const items: CheckItem[] = [
    checkViewportMeta(mobileDomSnapshot.viewportMetaContent),
    checkHorizontalOverflow(mobileDomSnapshot.hasHorizontalOverflow),
    checkTapTargets(mobileDomSnapshot.tapTargets),
    checkHamburgerLabel(mobileDomSnapshot.hamburgerMenu),
  ];
  const { score, maxScore } = scoreItems(items);
  return { name: "Mobile and Responsive", weight: 6, score, maxScore, items };
}
