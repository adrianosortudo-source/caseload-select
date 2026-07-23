/**
 * Section E completion: client-side disabled controls during support
 * preview. Server-side rejection is already covered by preview-guard.ts
 * and the write-guard-coverage source scan; this pins the required
 * usability layer (visible-but-disabled controls + the exact explanation)
 * on the three surfaces that previously rendered fully interactive during
 * a Lawyer decision-maker preview: FileUploader, TriageActionBar, and
 * DeliverableReview's comment/reply/sign-off composers (the last via a
 * source scan, not a full render, since DeliverableReview needs heavy
 * fixtures for a full mount).
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import fs from "fs";
import path from "path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import FileUploader from "../FileUploader";
import TriageActionBar from "../TriageActionBar";

const EXACT_MESSAGE =
  "Support preview is read-only. Complete this action from the firm’s own authorized session.";

// React SSR renders a truthy boolean attribute as ` name=""` (a literal
// space, the attribute name, then an empty-string value). This is the
// only reliable way to detect it in static markup: className strings like
// "disabled:opacity-50" (a Tailwind variant) contain the substring
// "disabled" unconditionally and would false-positive a naive match.
const REAL_DISABLED_ATTR = / disabled=""/;

describe("FileUploader: support preview disables the uploader", () => {
  it("renders the disabled submit button and the exact message when supportPreview is true", () => {
    const html = renderToStaticMarkup(
      createElement(FileUploader, { firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b", supportPreview: true }),
    );
    expect(html).toContain(EXACT_MESSAGE);
    expect(html).toMatch(REAL_DISABLED_ATTR);
  });

  it("does not render the message and controls stay enabled when supportPreview is false or omitted", () => {
    const html = renderToStaticMarkup(
      createElement(FileUploader, { firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b" }),
    );
    expect(html).not.toContain(EXACT_MESSAGE);
    expect(html).not.toMatch(REAL_DISABLED_ATTR);
  });
});

describe("TriageActionBar: support preview disables Take/Pass/Refer", () => {
  function render(supportPreview: boolean) {
    return renderToStaticMarkup(
      createElement(TriageActionBar, {
        firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
        leadId: "33333333-3333-3333-3333-333333333333",
        band: "A",
        initialStatus: "triaging",
        supportPreview,
      }),
    );
  }

  it("renders Take and Pass present but disabled, with the exact message, when supportPreview is true", () => {
    const html = render(true);
    expect(html).toContain(EXACT_MESSAGE);
    expect(html).toContain("Take");
    expect(html).toContain("Pass");
    expect(html).toMatch(REAL_DISABLED_ATTR);
  });

  it("renders no disabled action button and no message when supportPreview is false", () => {
    const html = render(false);
    expect(html).not.toContain(EXACT_MESSAGE);
    expect(html).not.toMatch(REAL_DISABLED_ATTR);
  });
});

describe("DeliverableReview: support preview threading (source scan)", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src", "components", "portal", "DeliverableReview.tsx"),
    "utf8",
  );

  it("imports the shared support-preview message constant", () => {
    expect(src).toContain('from "@/lib/support-preview-copy"');
    expect(src).toContain("SUPPORT_PREVIEW_READ_ONLY_MESSAGE");
  });

  it("ORs supportPreview into at least 6 disabled expressions (comment, reply, sign-off, popover, resolve toggle, attachment upload)", () => {
    const matches = src.match(/disabled=\{supportPreview \|\|/g) ?? [];
    expect(
      matches.length,
      "expected at least 6 disabled={supportPreview || ...} expressions",
    ).toBeGreaterThanOrEqual(6);
  });

  it("threads supportPreview through ApprovalHistory into ReplyComposer", () => {
    expect(src).toMatch(/<ApprovalHistory[\s\S]*?supportPreview=\{supportPreview\}/);
    expect(src).toMatch(/<ReplyComposer[\s\S]*?supportPreview=\{supportPreview\}/);
  });

  it("threads supportPreview into SignOffPanel and CommentComposer call sites", () => {
    expect(src).toMatch(/<SignOffPanel[\s\S]*?supportPreview=\{supportPreview\}/);
    expect(src).toMatch(/<CommentComposer[\s\S]*?supportPreview=\{supportPreview\}/);
  });

  it("threads supportPreview into the annotation popover, margin comments, and attachment picker", () => {
    expect(src).toMatch(/<FloatingAnnotationPopover[\s\S]*?supportPreview=\{supportPreview\}/);
    expect(src).toMatch(/<MarginComments[\s\S]*?supportPreview=\{supportPreview\}/);
    expect(src).toMatch(/<AttachmentPicker[\s\S]*?supportPreview=\{supportPreview\}/);
  });

  it("suppresses the version composer during preview", () => {
    expect(src).toMatch(/showVersionComposer && !supportPreview &&/);
  });
});

describe("deliverable detail page: wires isLawyerPreview into DeliverableReview", () => {
  const pageSrc = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "app",
      "portal",
      "[firmId]",
      "deliverables",
      "[deliverableId]",
      "page.tsx",
    ),
    "utf8",
  );

  it("passes supportPreview={isLawyerPreview} to DeliverableReview", () => {
    expect(pageSrc).toMatch(/<DeliverableReview[\s\S]*?supportPreview=\{isLawyerPreview\}/);
  });
});
