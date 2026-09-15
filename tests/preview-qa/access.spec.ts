import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
  type Response,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;
const QA_COOKIE = "preview_qa_session";
const READ_PATH = "/admin/prospects";
const BOOTSTRAP_PATH = "/api/operator/preview-qa-session";
const DENIED_PATHS = [
  "/admin/prospects/not-allowlisted",
  "/api/admin/prospect-operations/source-states",
] as const;
const MUTATION_PATHS = [
  "/admin/prospects/research-import",
  "/admin/prospects/agent-drafts",
  "/api/admin/prospect-operations/archive-updates/apply",
] as const;

type EvidenceRecord = {
  width: number;
  before: { screenshot: string; finalPath: string; status: number | null };
  after: { screenshot: string; finalPath: string; status: number | null };
  consoleErrors: string[];
  failedResources: string[];
};

type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  // Playwright requires this field even when the browser should treat the
  // cookie as a session cookie. -1 is its documented session-cookie value.
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict";
};

function baseUrl(): string {
  return new URL(process.env.PREVIEW_QA_BASE_URL as string).origin;
}

function safePath(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return "[invalid-url]";
  }
}

function safeMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s)]+/gi, "[url]")
    .replace(/preview_qa_session[^\s]*/gi, "preview_qa_session=[redacted]");
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function assertRenderedCopyGates(page: Page): Promise<void> {
  const failures = await page.evaluate(() => {
    const issues: string[] = [];
    for (const component of Array.from(
      document.querySelectorAll<HTMLElement>("[data-ui-component-content]"),
    )) {
      const componentName = component.dataset.uiComponentContent ?? "unknown";
      const componentRect = component.getBoundingClientRect();
      const style = getComputedStyle(component);
      const left =
        componentRect.left + Number.parseFloat(style.paddingLeft || "0");
      const right =
        componentRect.right - Number.parseFloat(style.paddingRight || "0");
      for (const copy of Array.from(
        component.querySelectorAll<HTMLElement>("[data-ui-copy]"),
      )) {
        if (
          copy.closest("[data-ui-component-content]") !== component ||
          copy.dataset.uiCopyException
        )
          continue;
        const rect = copy.getBoundingClientRect();
        if (
          Math.abs(rect.left - left) > 1.1 ||
          Math.abs(rect.right - right) > 1.1
        ) {
          issues.push(
            `${componentName}:${copy.dataset.uiCopy ?? "copy"} does not use the full content width`,
          );
        }
        const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
        const words: Array<{ top: number }> = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
          for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index ?? 0);
            range.setEnd(node, (match.index ?? 0) + match[0].length);
            for (const wordRect of Array.from(range.getClientRects())) {
              if (wordRect.width > 0 && wordRect.height > 0)
                words.push({ top: wordRect.top });
            }
          }
        }
        const lines: number[] = [];
        for (const word of words.sort((a, b) => a.top - b.top)) {
          if (!lines.some((top) => Math.abs(top - word.top) <= 1))
            lines.push(word.top);
        }
        if (lines.length > 1) {
          const lastLine = words.filter(
            (word) => Math.abs(word.top - (lines.at(-1) ?? 0)) <= 1,
          );
          if (lastLine.length === 1)
            issues.push(
              `${componentName}:${copy.dataset.uiCopy ?? "copy"} ends with a one-word line`,
            );
        }
      }
    }
    return issues;
  });
  expect(failures).toEqual([]);
}

function cookieFromSetCookie(
  setCookie: string | undefined,
  hostname: string,
): Cookie {
  const value = setCookie?.match(
    new RegExp(`(?:^|,\\s*)${QA_COOKIE}=([^;]+)`),
  )?.[1];
  if (!value)
    throw new Error("Preview QA bootstrap did not return its session cookie.");
  return {
    name: QA_COOKIE,
    value,
    domain: hostname,
    path: "/",
    expires: -1,
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
  };
}

async function bootstrap(request: APIRequestContext): Promise<Cookie> {
  const accessSecret = process.env.PREVIEW_QA_ACCESS_SECRET;
  const bootstrapNonce = process.env.PREVIEW_QA_BOOTSTRAP_NONCE;
  if (!accessSecret || !bootstrapNonce)
    throw new Error(
      "Preview QA credentials are missing from the CI secret store.",
    );

  const response = await request.post(BOOTSTRAP_PATH, {
    headers: { Origin: baseUrl() },
    data: { accessSecret, bootstrapNonce },
  });
  expect(response.status()).toBe(204);
  return cookieFromSetCookie(
    response.headers()["set-cookie"],
    new URL(baseUrl()).hostname,
  );
}

function listenForFailures(page: Page): {
  consoleErrors: string[];
  failedResources: string[];
} {
  const consoleErrors: string[] = [];
  const failedResources: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push(safeMessage(message.text()));
  });
  page.on("pageerror", (error) =>
    consoleErrors.push(safeMessage(error.message)),
  );
  page.on("response", (response: Response) => {
    if (response.status() >= 500)
      failedResources.push(`${response.status()} ${safePath(response.url())}`);
  });
  return { consoleErrors, failedResources };
}

async function assertMutationDenied(api: APIRequestContext): Promise<void> {
  for (const pathname of MUTATION_PATHS) {
    const response = await api.fetch(pathname, { method: "POST", data: {} });
    expect(response.status(), `QA mutation must be denied: ${pathname}`).toBe(
      403,
    );
  }
}

async function assertPathAllowlist(api: APIRequestContext): Promise<void> {
  for (const pathname of DENIED_PATHS) {
    const response = await api.get(pathname);
    expect(response.status(), `QA navigation must be denied: ${pathname}`).toBe(
      403,
    );
  }
}

test("preview QA principal passes authenticated six-width audit and access boundaries", async ({
  browser,
  request,
}, testInfo) => {
  const cookie = await bootstrap(request);
  const evidence: EvidenceRecord[] = [];
  const api = await playwrightRequest.newContext({
    baseURL: baseUrl(),
    storageState: { cookies: [cookie], origins: [] },
  });
  try {
    await assertMutationDenied(api);
    await assertPathAllowlist(api);

    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
      });
      const page = await context.newPage();
      const failures = listenForFailures(page);
      const before = await page.goto(READ_PATH);
      await settle(page);
      await expect(page).toHaveURL(/\/operator\/login/);
      const beforeFinalPath = safePath(page.url());
      const beforeScreenshot = testInfo.outputPath(`before-${width}.png`);
      await page.screenshot({ path: beforeScreenshot, fullPage: true });

      await context.addCookies([cookie]);
      const after = await page.goto(READ_PATH);
      await settle(page);
      await expect(
        page.getByRole("heading", { name: "Prospect list" }),
      ).toBeVisible();
      await assertRenderedCopyGates(page);
      const afterScreenshot = testInfo.outputPath(`after-${width}.png`);
      await page.screenshot({ path: afterScreenshot, fullPage: true });
      evidence.push({
        width,
        before: {
          screenshot: path.basename(beforeScreenshot),
          finalPath: beforeFinalPath,
          status: before?.status() ?? null,
        },
        after: {
          screenshot: path.basename(afterScreenshot),
          finalPath: safePath(page.url()),
          status: after?.status() ?? null,
        },
        consoleErrors: failures.consoleErrors,
        failedResources: failures.failedResources,
      });
      expect(failures.consoleErrors, `console errors at ${width}px`).toEqual(
        [],
      );
      expect(
        failures.failedResources,
        `failed resources at ${width}px`,
      ).toEqual([]);
      await context.close();
    }
  } finally {
    await api.dispose();
  }

  const manifest = {
    schema: "preview-qa-visual-evidence.v1",
    basePath: new URL(baseUrl()).pathname,
    widths: WIDTHS,
    evidence,
    secretHandling:
      "bootstrap body and QA cookie are never written to URLs, logs, screenshots, or this manifest",
  };
  const manifestPath = testInfo.outputPath("preview-qa-manifest.json");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await testInfo.attach("preview-qa-manifest", {
    path: manifestPath,
    contentType: "application/json",
  });
});
