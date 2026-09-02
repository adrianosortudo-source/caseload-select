import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

const OPERATOR_LINK_SOURCES = [
  "src/lib/portal-magic-link.ts",
  "src/lib/firm-onboarding-notification.ts",
  "src/lib/file-notify.ts",
  "src/lib/deliverables.ts",
  "src/app/api/cron/notification-batch/route.ts",
  "src/app/api/admin/firms/[firmId]/members/[memberId]/signin-code/route.ts",
  "src/app/l/[code]/route.ts",
];

describe("operator-origin outbound-link inventory", () => {
  it("routes every inventoried operator link through the shared origin policy", () => {
    for (const file of OPERATOR_LINK_SOURCES) {
      expect(read(file), `${file} does not use app-origins`).toContain("@/lib/app-origins");
    }
  });

  it("contains no app-origin admin deep link in the inventoried sources", () => {
    for (const file of OPERATOR_LINK_SOURCES) {
      expect(read(file), `${file} hard-codes an admin path on the app host`).not.toMatch(
        /https:\/\/app\.caseloadselect\.ca\/admin(?:\/|["'`])/,
      );
    }
  });

  it("keeps copied and previewed public onboarding links on appOrigin", () => {
    const component = read("src/components/admin/OnboardingFormLink.tsx");
    const page = read("src/app/admin/onboarding-submissions/page.tsx");

    expect(component).toContain("appOrigin");
    expect(component).not.toContain("window.location.origin");
    expect(component).toContain("href={url}");
    expect(page).toContain("<OnboardingFormLink appOrigin={appOrigin()} />");
  });

  it("documents the separate lawyer and operator hosts without IP recognition", () => {
    const terms = read("src/app/terms/page.tsx");
    expect(terms).toContain("app.caseloadselect.ca");
    expect(terms).toContain("admin.caseloadselect.ca");
    expect(terms).toContain("not to an IP address");
  });
});
