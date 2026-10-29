// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SeoCheckPage from "../page";

describe("SEO check landing page methodology copy", () => {
  it("describes the current v5 score and unscored Google uncertainty in plain language", async () => {
    render(await SeoCheckPage({ searchParams: Promise.resolve({ embed: "1" }) }));

    expect(screen.getByText(/The v5 score uses five directly observed check types/i)).toBeTruthy();
    const categoryIntro = container.querySelector(".seo-categories-intro");
    expect(categoryIntro?.textContent).toContain("If we cannot tell whether a page tells Google not to index it, that check is not scored.");
    expect(screen.getByText(/do not contribute to the v5 score/i)).toBeTruthy();
    expect(screen.queryByText(/v4 score/i)).toBeNull();
  });
});
