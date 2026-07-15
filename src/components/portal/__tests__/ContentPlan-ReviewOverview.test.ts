/**
 * ReviewOverview's total===0 early return (ContentPlan.tsx) predates
 * planReadiness.unavailable and swallowed it: a brand-new firm, or one
 * whose content is all archived, has total===0 (a SEPARATE
 * content_deliverables query than planReadiness) for a reason unrelated
 * to whether the readiness read itself succeeded. This pins the fix: an
 * unavailable read must render its banner even when the plan is
 * otherwise empty, and must still render nothing at all for a lawyer
 * (matching PublicationReadinessSummary's own lawyer-hide gate), and a
 * genuinely empty AND available plan must still render null exactly as
 * before (no regression on the common case).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ReviewOverview } from "../ContentPlan";
import type { PlanOverview } from "@/lib/deliverables-pure";

const EMPTY_OVERVIEW: PlanOverview = {
  total: 0,
  approved: 0,
  pending: 0,
  changes: 0,
  draft: 0,
  weeks: 0,
  byFormat: [],
  nextPublish: null,
};

function render(props: Partial<Parameters<typeof ReviewOverview>[0]>) {
  return renderToStaticMarkup(
    createElement(ReviewOverview, {
      overview: EMPTY_OVERVIEW,
      isOperator: true,
      firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
      settings: null,
      onChanged: () => {},
      ...props,
    }),
  );
}

describe("ReviewOverview: empty plan vs unavailable read", () => {
  it("renders null for a genuinely empty, available plan (no regression)", () => {
    const html = render({ planReadiness: { summary: { active: 0, ready: 0, blocked: 0, excluded: 0 }, items: [], titles: {}, lifecycleByDeliverableId: {}, unavailable: false } });
    expect(html).toBe("");
  });

  it("renders null when planReadiness is omitted entirely (no regression)", () => {
    const html = render({});
    expect(html).toBe("");
  });

  it("renders the unavailable banner for an operator when the plan is empty AND the read failed", () => {
    const html = render({
      isOperator: true,
      planReadiness: { summary: { active: 0, ready: 0, blocked: 0, excluded: 0 }, items: [], titles: {}, lifecycleByDeliverableId: {}, unavailable: true },
    });
    expect(html).toContain("Unavailable");
    expect(html).toContain("could not be loaded");
  });

  it("renders nothing for a lawyer even when the plan is empty AND the read failed", () => {
    const html = render({
      isOperator: false,
      planReadiness: { summary: { active: 0, ready: 0, blocked: 0, excluded: 0 }, items: [], titles: {}, lifecycleByDeliverableId: {}, unavailable: true },
    });
    expect(html).toBe("");
  });

  it("does not render a percentage or progress bar in the unavailable-empty banner (no NaN%)", () => {
    const html = render({
      isOperator: true,
      planReadiness: { summary: { active: 0, ready: 0, blocked: 0, excluded: 0 }, items: [], titles: {}, lifecycleByDeliverableId: {}, unavailable: true },
    });
    expect(html).not.toContain("NaN");
  });
});
