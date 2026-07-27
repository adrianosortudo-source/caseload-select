import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import PreviewStrip from "../PreviewStrip";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

function render(audience: "lawyer" | "client") {
  return renderToStaticMarkup(
    createElement(PreviewStrip, { firmId: FIRM_ID, firmName: "DRG Law", audience }),
  );
}

describe("PreviewStrip: support-preview banner", () => {
  it("renders the exact SUPPORT PREVIEW banner meaning for Lawyer decision-maker", () => {
    const html = render("lawyer");
    expect(html).toContain("SUPPORT PREVIEW");
    expect(html).toContain("DRG Law");
    expect(html).toContain("Lawyer decision-maker");
    expect(html).toContain("You can inspect the client experience");
    expect(html).toContain("cannot make changes on the firm");
  });

  it("renders Client viewer for the client audience", () => {
    const html = render("client");
    expect(html).toContain("DRG Law");
    expect(html).toContain("Client viewer");
  });

  it("provides an exit link back to the preview/exit route", () => {
    const html = render("lawyer");
    expect(html).toContain(`href="/api/portal/${FIRM_ID}/preview/exit"`);
    expect(html).toContain("Exit preview");
  });

  it("never renders the raw firm id as visible text (only inside the exit href)", () => {
    const html = render("lawyer");
    const withoutHref = html.replace(/href="[^"]*"/g, "");
    expect(withoutHref).not.toContain(FIRM_ID);
  });

  it("never renders a session token, cookie value, or credential string", () => {
    const html = render("lawyer");
    expect(html.toLowerCase()).not.toContain("cookie");
    expect(html.toLowerCase()).not.toContain("token");
    expect(html.toLowerCase()).not.toContain("session");
  });
});
