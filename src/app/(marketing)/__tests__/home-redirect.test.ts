import { describe, expect, it } from "vitest";
import MarketingHomePage from "../page";

describe("legacy app homepage", () => {
  it("permanently redirects to the current CaseLoad Select website", () => {
    let thrown: unknown;
    try {
      MarketingHomePage();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;(replace|push);https:\/\/caseloadselect\.ca\/;308;$/),
    });
  });
});
