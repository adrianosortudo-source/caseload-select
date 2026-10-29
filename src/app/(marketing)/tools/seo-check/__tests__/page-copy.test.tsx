// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SeoCheckPage from "../page";

describe("SEO check landing page methodology copy", () => {
  it("describes the current v5 score and its uncertainty in plain language", async () => {
    render(await SeoCheckPage({ searchParams: Promise.resolve({ embed: "1" }) }));

    expect(screen.getByText(/The v5 score uses five directly observed check types/i)).toBeTruthy();
    expect(screen.getByText(/If an instruction’s meaning is unclear, the scan leaves that check unscored/i)).toBeTruthy();
    expect(screen.getByText(/do not contribute to the v5 score/i)).toBeTruthy();
    expect(screen.queryByText(/v4 score/i)).toBeNull();
  });
});
