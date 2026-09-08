import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const activeDocs = [
  "docs/app-review/Operator_Execution_Checklist.md",
  "docs/app-review/Reviewer_Instructions_Paste.md",
  "docs/app-review/Reviewer_Instructions_Paste_v2.md",
  "docs/app-review/Meta_Verification_Resubmit_Card.md",
  "docs/app-review/Phase11_Submission_Package.md",
  "docs/Meta_App_Creation_Block1_Runbook.md",
  "docs/Meta_App_Creation_Block2_Runbook.md"
];
const canonicalUrls = [
  "https://caseloadselect.ca/",
  "https://caseloadselect.ca/privacy",
  "https://caseloadselect.ca/terms",
  "https://caseloadselect.ca/data-deletion",
  "https://caseloadselect.ca/api/messenger-intake",
  "https://caseloadselect.ca/api/instagram-intake",
  "https://caseloadselect.ca/api/whatsapp-intake"
];

describe("active Meta review documentation", () => {
  const docs = activeDocs.map((file) => [file, readFileSync(resolve(process.cwd(), file), "utf8")] as const);
  const combined = docs.map(([, content]) => content).join("\n");

  it("contains all seven canonical public and callback URLs", () => {
    for (const url of canonicalUrls) {
      const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(combined).toMatch(new RegExp(`${escaped}(?=[\\s\`)},.|]|$)`));
    }
  });

  it("contains no public policy or callback URL on the legacy app subdomain", () => {
    const legacyPublicUrl = /https:\/\/app\.caseloadselect\.ca\/(?:privacy|terms|data-deletion|api\/(?:messenger|instagram|whatsapp)-intake)\b/i;
    for (const [file, content] of docs) expect(content, file).not.toMatch(legacyPublicUrl);
  });

  it("records the dated supersession and credential-rotation boundary", () => {
    for (const file of ["docs/Meta_App_Creation_Block1_Runbook.md", "docs/Meta_App_Creation_Block2_Runbook.md"]) {
      const content = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(content).toContain("2026-09-04 canonical-domain supersession");
      expect(content).toContain("Credential rotation is mandatory before submission because historical Git copies remain recoverable.");
      expect(content).toContain("[stored in Vercel production environment; never commit]");
    }
  });
});
