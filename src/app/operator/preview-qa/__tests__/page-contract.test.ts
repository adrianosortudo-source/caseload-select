import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve(process.cwd(), "src/app/operator/preview-qa/page.tsx"),
  "utf8",
);
const formSource = readFileSync(
  resolve(process.cwd(), "src/app/operator/preview-qa/PreviewQaBootstrapForm.tsx"),
  "utf8",
);
const middlewareSource = readFileSync(resolve(process.cwd(), "src/middleware.ts"), "utf8");

describe("preview QA bootstrap page contract", () => {
  it("is rendered only by the configured isolated preview environment", () => {
    expect(pageSource).toContain("isPreviewQaEnvironment(hostname)");
    expect(pageSource).toContain("if (!isPreviewQaEnvironment(hostname)) notFound()");
    expect(pageSource).toContain('fetchCache = "force-no-store"');
    expect(pageSource).toContain("index: false, follow: false, nocache: true");
  });

  it("posts configured values same-origin without retaining them in the screen", () => {
    expect(formSource).toContain('method: "POST"');
    expect(formSource).toContain('credentials: "same-origin"');
    expect(formSource).toContain('cache: "no-store"');
    expect(formSource).toContain('body: JSON.stringify({ accessSecret, bootstrapNonce })');
    expect(formSource).toContain('setAccessSecret("")');
    expect(formSource).toContain('setBootstrapNonce("")');
    expect(formSource).toContain('window.location.assign("/admin/prospects")');
    expect(formSource).not.toContain("URLSearchParams");
    expect(formSource).not.toContain("window.location.search");
  });

  it("marks the exact bootstrap surface as private and non-indexable", () => {
    expect(middlewareSource).toContain("pathname === PREVIEW_QA_BOOTSTRAP_UI_PATH");
    expect(middlewareSource).toContain('response.headers.set("Cache-Control", "private, no-store")');
    expect(middlewareSource).toContain('response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive")');
    expect(formSource).toContain('data-ui-component-content="preview-qa-bootstrap"');
    expect(formSource).toContain('data-ui-copy="heading"');
    expect(formSource).toContain('data-ui-copy="body"');
  });
});
