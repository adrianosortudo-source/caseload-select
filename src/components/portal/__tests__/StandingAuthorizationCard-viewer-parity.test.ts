/**
 * The operator's "View as Firm" preview must show the SAME standing-
 * publishing-authorization state as the lawyer sees, visibly, but the
 * operator can never activate or deactivate it. Nothing previously pinned
 * this parity as a test; a future change to StandingAuthorizationCard could
 * silently hide the control from the operator preview or let it look
 * interactive without this guard.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

import StandingAuthorizationCard from "../StandingAuthorizationCard";

const DRG_FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

function render(viewerRole: "lawyer" | "operator", active: boolean) {
  return renderToStaticMarkup(
    createElement(StandingAuthorizationCard, {
      firmId: DRG_FIRM_ID,
      firmName: "DRG Law",
      viewerRole,
      active,
      latestEvent: null,
    }),
  );
}

describe("StandingAuthorizationCard — lawyer vs. operator View-as-Firm parity", () => {
  it("lawyer view (off) gets the real, interactive enable control, not a preview", () => {
    const html = render("lawyer", false);
    expect(html).toContain("Turn on standing publishing authorization");
    expect(html).not.toContain("read-only operator preview");
    expect(html).not.toContain('disabled=""');
  });

  it("operator preview (off) shows the same explanatory state visibly, but the control is disabled", () => {
    const html = render("operator", false);
    expect(html).toContain("Standing publishing authorization is off");
    expect(html).toContain("Choose how content approval works");
    expect(html).toContain("Turn on standing publishing authorization");
    expect(html).toContain("read-only operator preview");
    expect(html).toContain('disabled=""');
  });

  it("operator preview (on) still shows the same state visibly, control still disabled", () => {
    const html = render("operator", true);
    expect(html).toContain("Standing publishing authorization is on");
    expect(html).toContain("Turn off authorization");
    expect(html).toContain('disabled=""');
  });

  it("the operator preview is never simply absent: both roles render a StandingAuthorizationCard section", () => {
    expect(render("lawyer", false)).toMatch(/<section/);
    expect(render("operator", false)).toMatch(/<section/);
  });
});
