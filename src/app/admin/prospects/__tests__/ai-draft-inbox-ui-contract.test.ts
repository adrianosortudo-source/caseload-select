import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/AiDraftInbox.tsx"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/page.tsx"), "utf8");

describe("AI draft inbox operator UI", () => {
  it("is mounted in the authenticated prospect console", () => {
    expect(page).toContain("<AiDraftInbox />");
    expect(component).toContain('aria-labelledby="ai-draft-inbox-heading"');
  });

  it("keeps staging separate from the explicit operator import", () => {
    expect(component).toContain('fetch("/admin/prospects/agent-drafts"');
    expect(component).toContain('method: "PUT"');
    expect(component).toContain("I reviewed this staged package and want the server to revalidate and import it.");
    expect(component).toContain("The server stops if its ledger review changed.");
  });

  it("marks rendered copy and avoids em dashes", () => {
    expect(component).toContain('data-ui-component-content="ai-draft-inbox"');
    expect(component).toContain('data-ui-copy="heading"');
    expect(component).toContain('data-ui-copy="body"');
    expect(component).not.toContain("—");
  });
});
