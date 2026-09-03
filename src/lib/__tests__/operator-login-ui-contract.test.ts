import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

const OPERATOR_PAGE = "src/app/operator/login/page.tsx";
const PORTAL_PAGE = "src/app/portal/login/page.tsx";
const FORM = "src/components/portal/RequestLinkForm.tsx";
const SHELL = "src/components/AdminShell.tsx";
const SIDEBAR = "src/components/admin/AdminSidebar.tsx";
const PRIVACY = "src/app/privacy/page.tsx";
const PACKAGE_JSON = "package.json";
const CI = ".github/workflows/ci.yml";

describe("operator sign-in UI contracts", () => {
  it("has a distinct, role-explicit surface and reciprocal lawyer link", () => {
    const operator = read(OPERATOR_PAGE);
    expect(operator).toContain("Operator access");
    expect(operator).toContain('endpoint="/api/operator/request-link"');
    expect(operator).toContain("appOrigin");
    expect(operator).toContain('href={`${appOrigin()}/portal/login`}');
    expect(operator).toContain("this trusted browser stays signed in for 30 days");
    expect(operator).toContain("getOperatorSession");
    expect(operator).toContain('redirect("/admin")');

    const portal = read(PORTAL_PAGE);
    expect(portal).toContain("Lawyer portal");
    expect(portal).toContain("operatorOrigin");
    expect(portal).toContain('href={`${operatorOrigin()}/operator/login`}');
  });

  it("keeps operator auth outside the console sidebar shell", () => {
    const shell = read(SHELL);
    expect(shell).toContain('path.startsWith("/operator")');
    expect(shell).toContain("isOperatorAuth");
  });

  it("posts through the supplied endpoint and preserves all form states", () => {
    const form = read(FORM);
    expect(form).toContain("fetch(endpoint");
    expect(form).toContain("Check your inbox");
    expect(form).toContain("Sending…");
    expect(form).toContain("Send sign-in link");
    expect(form).toContain("Send to a different email");
    expect(form).toContain("focus-visible:ring-2");
  });

  it("uses the operator logout endpoint from console chrome", () => {
    expect(read(SIDEBAR)).toContain('action="/api/operator/logout"');
  });

  it("documents host-scoped lawyer and operator sessions accurately", () => {
    const privacy = read(PRIVACY);
    expect(privacy).toContain("Each cookie is limited to its own host");
    expect(privacy).toContain("do not overwrite one another");
  });

  it("keeps the stable rendered login matrix in PR CI", () => {
    const packageJson = JSON.parse(read(PACKAGE_JSON)) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["test:operator-login-rendered"]).toBe(
      "playwright test --config=playwright.operator-login.config.ts",
    );
    const ci = read(CI);
    expect(ci).toContain("operator-login-rendered:");
    expect(ci).toContain("npm run test:operator-login-rendered");
  });

  it("contains no em dash in the new user-facing sign-in sources", () => {
    for (const file of [OPERATOR_PAGE, PORTAL_PAGE, FORM, PRIVACY]) {
      expect(read(file), `${file} contains an em dash`).not.toContain("—");
    }
  });
});
