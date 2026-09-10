import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({ useMemo: vi.fn((callback) => callback()), useState: vi.fn((value) => [value, vi.fn()]) }));
vi.mock("react/jsx-runtime", () => ({ Fragment: Symbol("Fragment"), jsx: vi.fn(), jsxs: vi.fn() }));
vi.mock("react/jsx-dev-runtime", () => ({ Fragment: Symbol("Fragment"), jsxDEV: vi.fn() }));

const component = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/ProspectArchiveUpdate.tsx"), "utf8");

describe("prospect archive update operator surface", () => {
  it("transforms the client component", async () => {
    const module = await import("../ProspectArchiveUpdate");
    expect(module.default).toBeTypeOf("function");
  });

  it("keeps the two sources explicitly unavailable until their real integrations exist", () => {
    expect(component).toContain("Direct sync needs a verified connection");
    expect(component).toContain("Upload requires a supported history bundle");
    expect(component).toContain("This panel does not invent a successful result");
  });

  it("models preview, one reviewed apply action, receipts, and no-change results without a data call", () => {
    for (const label of ["New", "Unchanged", "Held", "Unclassified", "Incomplete", "Apply reviewed update", "Latest result", "No changes were found"]) expect(component).toContain(label);
    expect(component).toContain("onApplyReviewedUpdate");
    expect(component).not.toMatch(/fetch\s*\(/);
    expect(component).not.toMatch(/send email|activate workflow|enroll/i);
  });

  it("uses governed full-width copy markers and contains no em dash", () => {
    expect(component).toContain('data-ui-component-content="prospect-archive-update"');
    expect(component).toContain('data-ui-copy="heading"');
    expect(component).toContain('data-ui-copy="body"');
    expect(component).toContain("w-full");
    expect(component).not.toContain("—");
  });
});
