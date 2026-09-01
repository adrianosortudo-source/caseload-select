import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), "utf8");

describe("Secure Import Room trust guide", () => {
  const guide = read("src", "components", "portal", "SecureImportTrustGuide.tsx");
  const room = read("src", "components", "portal", "SecureImportRoom.tsx");
  const page = read("src", "app", "portal", "[firmId]", "clients", "import", "page.tsx");
  const clientsPage = read("src", "app", "portal", "[firmId]", "clients", "page.tsx");
  const renderedFixture = read("src", "app", "test-screen", "secure-import", "page.tsx");
  const renderedBrowserTest = read("tests", "secure-import", "rendered-copy-gates.spec.ts");
  const css = read("src", "app", "globals.css");

  it("uses the full inner width for component copy and keeps data regions functional", () => {
    expect(guide).toContain('className="space-y-6"');
    expect(room).toContain('className="space-y-6"');
    const legacyIdentifiers = [
      ["readable", "prose"].join("-"),
      ["measure", "readable"].join("-"),
      ["measure", "heading"].join("-"),
      ["data", "readable", "measure", "exception"].join("-"),
    ];
    for (const source of [guide, room, clientsPage, css]) {
      for (const identifier of legacyIdentifiers) expect(source).not.toContain(identifier);
    }
    expect(guide).not.toMatch(/<p className="[^"]*max-w-/);
    expect(room).not.toMatch(/<p(?:\s+id="[^"]+")? className="[^"]*max-w-/);
    expect(guide).not.toMatch(/<h[1-3][^>]*max-w-/);
    expect(room).not.toMatch(/<h[1-3][^>]*max-w-/);
    expect(clientsPage).not.toContain("max-w-2xl");
    expect(clientsPage).toContain("lg:flex-row lg:items-end lg:justify-between");
    expect(clientsPage).not.toContain("sm:flex-row sm:items-end sm:justify-between");
    expect(room).toContain('function Summary({ label, value }');
    expect(room).toContain('className="bg-parchment px-4 py-3"');
  });

  it("uses stable contrast tokens for meaningful small text on light surfaces", () => {
    expect(guide).not.toContain("text-gold-on-light");
    expect(guide).not.toContain("text-black/25");
    expect(room).not.toContain("text-[color:var(--portal-accent)]");
    expect(clientsPage).not.toContain("text-[color:var(--portal-accent)]");
    expect(guide).toContain('className="text-field-label">blank</span>');
    expect(room).toContain('tracking-[0.14em] text-field-label">Clients / Secure import</p>');
    expect(clientsPage).toContain('tracking-[0.14em] text-field-label">Relationship database</p>');
  });

  it("states the transient processing boundary instead of claiming a direct browser-to-CRM upload", () => {
    expect(guide).toMatch(/temporarily processes only the\s+normalized contact rows/);
    expect(guide).toContain("groups of up to 25 normalized contact rows");
    expect(guide).toContain("not saved in the CaseLoad Select database");
    expect(guide).toContain("request IP when available, the browser user-agent string");
    expect(guide).toContain("authorized firm lawyer or administrator");
    expect(guide).toContain("configured HighLevel location ID");
    expect(guide).toContain("require reconciliation");
  });

  it("documents the verified infrastructure controls and their limits", () => {
    expect(guide).toContain("ISO/IEC 27001:2022");
    expect(guide).toContain("SOC 2 Type II");
    expect(guide).toContain("TLS 1.2 or 1.3");
    expect(guide).toContain("AES-256");
    expect(guide).toMatch(/hosted in the United\s+States/);
    expect(guide).toContain("Independent attestation");
    expect(guide).toContain("They do not certify CaseLoad");
    expect(guide).toContain("not HIPAA");
    expect(guide).toContain("Business Associate Agreement");
    expect(guide).toMatch(/each\s+applicable sub-account/);
    expect(guide).toContain("https://www.gohighlevel.com/data-processing-agreement");
  });

  it("shows every live CSV header with safe fictional data and explains that import is not consent", () => {
    for (const header of [
      "first_name",
      "last_name",
      "email",
      "phone",
      "relationship_type",
      "practice_area",
      "matter_closed_year",
      "marketing_permission",
    ]) {
      expect(guide).toContain(header);
    }
    expect(guide).toContain("example.com");
    expect(guide).toContain("Importing never creates consent");
    expect(guide).toContain("Only these eight columns are used");
    expect(guide).toContain("remove every other column");
  });

  it("keeps the wide template preview keyboard accessible and gives every column a scoped header", () => {
    expect(guide).toContain('aria-label="Scrollable CSV template preview"');
    expect(guide).toContain("tabIndex={0}");
    expect(guide.match(/scope="col"/g)).toHaveLength(8);
  });

  it("provides visible focus treatment for disclosure and external-link controls", () => {
    expect(guide).toContain("focus-visible:ring-inset focus-visible:ring-navy");
    expect(guide).toContain("(opens in a new tab)");
  });

  it("keeps one upload control and the full action flow before the long trust guide", () => {
    const uploadIndex = room.indexOf('id="relationship-import-file"');
    const guideIndex = room.indexOf("{trustGuide}");
    expect(room.match(/type="file"/g)).toHaveLength(1);
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeLessThan(guideIndex);
    expect(room.indexOf('id="import-status-heading"')).toBeLessThan(guideIndex);
    expect(room.indexOf("{error && (")).toBeLessThan(guideIndex);
    expect(page).toContain("trustGuide={<SecureImportTrustGuide />}");
  });

  it("gives the operative panel restrained priority and protects narrow layouts", () => {
    expect(room).toContain('className="border border-gold-on-light bg-highlight p-5 sm:p-6"');
    expect(room).not.toContain("bg-gradient");
    expect(room).not.toContain("border-l-");
    expect(room).toContain("min-w-0 max-w-full");
    expect(room).toContain("w-48 max-w-full");
    expect(room).toContain("break-words text-sm");
    expect(guide).toContain("overflow-x-auto");
  });

  it("keeps supporting copy on a full-width row separate from download actions", () => {
    const oldActionReducedTrack = "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between";
    for (const source of [room, guide]) {
      expect(source).not.toContain(oldActionReducedTrack);
      expect(source).toContain('data-copy-action="download-template"');
      expect(source).toContain('data-full-width-copy="heading"');
      expect(source).toContain('data-full-width-copy="supporting"');
      expect(source).toContain('data-copy-orphan-guard="supporting"');
      expect(source).toContain("col-span-full text-balance");
      expect(source).toContain("col-span-full text-pretty");
      expect(source.match(/data-full-width-copy=/g)).toHaveLength(2);
      expect(source).toContain("sm:row-start-2");
      expect(source).toContain("sm:row-start-3");
    }
    expect(room).toContain('data-copy-container="prepare-panel"');
    expect(guide).toContain('data-copy-container="template-preview-panel"');
    expect(guide).toContain('data-secure-import-scroller="csv-preview"');
    expect(renderedBrowserTest).toContain('toHaveCount(4)');
    expect(renderedBrowserTest).toContain("range.getClientRects()");
    expect(renderedBrowserTest).not.toContain("range.getBoundingClientRect()");
  });

  it("associates the file requirements and progress updates with accessible controls", () => {
    expect(room).toContain('aria-describedby="prepare-description import-file-requirements"');
    expect(room).toContain('aria-label="Import progress"');
    expect(room).toContain('role="status"');
    expect(room).toContain('aria-atomic="true"');
    expect(room.match(/focus-visible:ring-2/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
  });

  it("keeps the rendered fixture fictional, read-only and unavailable in production", () => {
    expect(renderedFixture).toContain('process.env.NODE_ENV === "production"');
    expect(renderedFixture).toContain("notFound()");
    expect(renderedFixture).toContain('firmId="secure-import-rendered-fixture"');
    expect(renderedFixture).toContain("readOnly");
    expect(renderedFixture).not.toContain("fetch(");
  });
});
