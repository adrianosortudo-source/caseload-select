import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appOrigin,
  isAppHost,
  isLocalOrPreviewHost,
  isOperatorHost,
  isOperatorUiPath,
  operatorOrigin,
  roleAwareOrigin,
} from "../app-origins";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
  vi.stubEnv("VERCEL_URL", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("application origins", () => {
  it("separates operator links from lawyer and client links in production", () => {
    expect(appOrigin()).toBe("https://app.caseloadselect.ca");
    expect(operatorOrigin()).toBe("https://admin.caseloadselect.ca");
    expect(roleAwareOrigin("operator")).toBe("https://admin.caseloadselect.ca");
    expect(roleAwareOrigin("lawyer")).toBe("https://app.caseloadselect.ca");
    expect(roleAwareOrigin("client")).toBe("https://app.caseloadselect.ca");
  });

  it("keeps previews on their deployment origin", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "operator-auth-git-example.vercel.app");
    expect(appOrigin()).toBe("https://operator-auth-git-example.vercel.app");
    expect(operatorOrigin()).toBe("https://operator-auth-git-example.vercel.app");
  });

  it("keeps local development on one origin", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "");
    expect(appOrigin()).toBe("http://localhost:3000");
    expect(operatorOrigin()).toBe("http://localhost:3000");
  });

  it("normalizes canonical hosts without treating arbitrary subdomains as operator hosts", () => {
    expect(isOperatorHost("ADMIN.CASELOADSELECT.CA:443")).toBe(true);
    expect(isAppHost("app.caseloadselect.ca.")).toBe(true);
    expect(isOperatorHost("drglaw.caseloadselect.ca")).toBe(false);
    expect(isOperatorHost("admin.caseloadselect.ca.attacker.test")).toBe(false);
  });

  it("recognizes local and Vercel preview hosts", () => {
    expect(isLocalOrPreviewHost("localhost:3000")).toBe(true);
    expect(isLocalOrPreviewHost("127.0.0.1:3000")).toBe(true);
    expect(isLocalOrPreviewHost("[::1]:3000")).toBe(true);
    expect(isLocalOrPreviewHost("branch-name.vercel.app")).toBe(true);
    expect(isLocalOrPreviewHost("app.caseloadselect.ca")).toBe(false);
  });

  it("limits operator navigation classification to UI surfaces", () => {
    expect(isOperatorUiPath("/admin/triage")).toBe(true);
    expect(isOperatorUiPath("/operator/login")).toBe(true);
    expect(isOperatorUiPath("/pipeline")).toBe(true);
    expect(isOperatorUiPath("/pipeline-stage")).toBe(false);
    expect(isOperatorUiPath("/api/operator/logout")).toBe(false);
    expect(isOperatorUiPath("/portal/firm-1/files")).toBe(false);
  });
});
