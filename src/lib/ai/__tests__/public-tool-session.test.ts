import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { PUBLIC_PILOT_COOKIE, publicPilotSession } from "../public-tool-session";
import { writingProvider } from "../writing-rollout";

afterEach(() => vi.unstubAllEnvs());

it("uses a browser-session cookie for the first render and the consented request, independent of network", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("CASELOAD_OPENAI_API_KEY", "test-only");
  vi.stubEnv("WHY_YOUR_FIRM_ASSIST_PROVIDER", "openai");
  vi.stubEnv("WHY_YOUR_FIRM_ASSIST_OPENAI_PERCENT", "10");
  const url = "https://app.caseloadselect.ca/tools/why-your-firm?embed=1";
  const first = await middleware(new NextRequest(url, { headers: { cookie: "other=keep", "x-forwarded-for": "192.0.2.1" } }));
  const cookie = first.cookies.get(PUBLIC_PILOT_COOKIE);
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "none", path: "/" });
  expect(cookie?.maxAge).toBeUndefined();
  expect(first.headers.get("cache-control")).toContain("no-store");
  const forwarded = first.headers.get("x-middleware-request-cookie")!;
  expect(forwarded).toContain("other=keep");
  expect(publicPilotSession(new Headers({ cookie: forwarded }))).toBe(cookie!.value);
  const next = await middleware(new NextRequest(url, { headers: { cookie: forwarded, "x-forwarded-for": "192.0.2.2" } }));
  expect(next.cookies.get(PUBLIC_PILOT_COOKIE)).toBeUndefined();
  expect(publicPilotSession(new Headers({ cookie: next.headers.get("x-middleware-request-cookie")! }))).toBe(cookie!.value);
  expect(writingProvider("why", undefined)).toBe("gemini");

  const second = await middleware(new NextRequest(url, { headers: { "x-forwarded-for": "192.0.2.1" } }));
  expect(second.cookies.get(PUBLIC_PILOT_COOKIE)?.value).not.toBe(cookie!.value);
  const post = await middleware(new NextRequest("https://app.caseloadselect.ca/api/tools/why-your-firm/assist", { method: "POST" }));
  expect(post.cookies.get(PUBLIC_PILOT_COOKIE)).toBeUndefined();
  vi.stubEnv("WHY_YOUR_FIRM_ASSIST_OPENAI_PERCENT", "0");
  expect(writingProvider("why", cookie!.value)).toBe("gemini");
  expect((await middleware(new NextRequest(url))).cookies.get(PUBLIC_PILOT_COOKIE)).toBeUndefined();
});
