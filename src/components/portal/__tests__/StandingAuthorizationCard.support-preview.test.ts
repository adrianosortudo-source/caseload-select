import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import fs from "fs";
import path from "path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import StandingAuthorizationCard from "../StandingAuthorizationCard";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const EXACT_SENTENCE =
  "Only the firm’s authorized lawyer/client decision-maker can complete this action from their own portal session.";

function renderOperatorView(active: boolean) {
  return renderToStaticMarkup(
    createElement(StandingAuthorizationCard, {
      firmId: FIRM_ID,
      firmName: "DRG Law",
      viewerRole: "operator",
      active,
      latestEvent: null,
    }),
  );
}

describe("StandingAuthorizationCard: operator (support-preview) branch, authorization off", () => {
  const html = renderOperatorView(false);

  it("renders the real status", () => {
    expect(html).toContain("Standing publishing authorization is off");
  });

  it("renders the real button label, visible", () => {
    expect(html).toContain("Turn on standing publishing authorization");
  });

  it("renders the real control as disabled, not hidden", () => {
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-disabled="true"[^>]*>/);
  });

  it("renders the exact required explanatory sentence", () => {
    expect(html).toContain(EXACT_SENTENCE);
  });
});

describe("StandingAuthorizationCard: operator (support-preview) branch, authorization on", () => {
  const html = renderOperatorView(true);

  it("renders the real status", () => {
    expect(html).toContain("Standing publishing authorization is on");
  });

  it("renders the real button label for the active state, visible and disabled", () => {
    expect(html).toContain("Turn off authorization");
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-disabled="true"[^>]*>/);
  });

  it("renders the exact required explanatory sentence", () => {
    expect(html).toContain(EXACT_SENTENCE);
  });
});

describe("how-your-content-works page: renders StandingAuthorizationCard with a session-derived viewerRole (required test 6)", () => {
  const pageSrc = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "app",
      "portal",
      "[firmId]",
      "how-your-content-works",
      "page.tsx",
    ),
    "utf8",
  );

  it("imports and renders StandingAuthorizationCard", () => {
    expect(pageSrc).toContain("StandingAuthorizationCard");
    expect(pageSrc).toMatch(/<StandingAuthorizationCard[\s\S]*viewerRole={viewerRole}/);
  });

  it("derives viewerRole from the portal session (operator maps to the read-only branch)", () => {
    expect(pageSrc).toMatch(
      /viewerRole\s*=\s*session\.role\s*===\s*["']operator["']\s*\?\s*["']operator["']\s*:\s*["']lawyer["']/,
    );
  });
});
