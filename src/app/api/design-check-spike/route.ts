import { NextRequest, NextResponse } from "next/server";
import { renderUrl } from "@/lib/design-check/renderer";
import { checkOutboundRequest } from "@/lib/design-check/ssrf-guard";
import { scoreTypography } from "@/lib/design-check/dimensions/typography";
import { scoreColorContrast } from "@/lib/design-check/dimensions/color-contrast";
import { scoreForms } from "@/lib/design-check/dimensions/forms";
import { scoreMobile } from "@/lib/design-check/dimensions/mobile";
import { scorePerformance } from "@/lib/design-check/dimensions/performance";
import { writeFileSync } from "node:fs";
import path from "node:path";

/**
 * TEMPORARY Phase 0 spike verification route. Not part of the shipped
 * tool; proves the renderer works end to end (real browser render,
 * screenshots, DOM snapshot, web-vitals, SSRF guard) before any scoring
 * logic gets built on top of it. Delete before Phase 5 ships.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get("domain") || "sakurabalaw.com";
  const url = `https://${domain}`;

  const ssrfChecks = {
    localhost: await checkOutboundRequest("http://localhost:3000/"),
    cloudMetadata: await checkOutboundRequest("http://169.254.169.254/latest/meta-data/"),
    publicSite: await checkOutboundRequest("https://caseloadselect.ca/"),
  };

  const ssrfGuardOk =
    ssrfChecks.localhost.blocked &&
    ssrfChecks.cloudMetadata.blocked &&
    !ssrfChecks.publicSite.blocked;

  if (!ssrfGuardOk) {
    return NextResponse.json({ ok: false, stage: "ssrf_guard_smoke_test", ssrfChecks }, { status: 500 });
  }

  try {
    const start = Date.now();
    const result = await renderUrl(url);
    const elapsedMs = Date.now() - start;

    const outDir = "C:\\Users\\adria\\AppData\\Local\\Temp\\claude\\D--\\dae522db-78ad-496b-9275-71ba5ba48553\\scratchpad";
    const summary = result.captures.map((c) => {
      const outPath = path.join(outDir, `design-check-spike-${domain}-${c.viewport}.png`);
      writeFileSync(outPath, c.screenshotPng);
      return {
      viewport: c.viewport,
      finalUrl: c.finalUrl,
      renderMs: c.renderMs,
      screenshotBytes: c.screenshotPng.length,
      screenshotWrittenTo: outPath,
      domSnapshot: {
        h1Count: c.domSnapshot.h1Count,
        h1Text: c.domSnapshot.h1Text,
        headingOrder: c.domSnapshot.headingOrder,
        hasHorizontalOverflow: c.domSnapshot.hasHorizontalOverflow,
        viewportMetaContent: c.domSnapshot.viewportMetaContent,
        bodyTextSampleCount: c.domSnapshot.bodyTextSample.length,
        bodyTextSample: c.domSnapshot.bodyTextSample,
      },
      webVitals: c.webVitals,
      blockedRequests: c.blockedRequests,
      dimensions: {
        typography: scoreTypography(c.domSnapshot),
        colorContrast: scoreColorContrast(c.domSnapshot),
        forms: scoreForms(c.domSnapshot),
        ...(c.viewport === "mobile" ? { mobile: scoreMobile(c.domSnapshot) } : {}),
        performance: scorePerformance(c.domSnapshot, c.webVitals),
      },
      };
    });

    return NextResponse.json({
      ok: true,
      ssrfGuardOk,
      domain,
      elapsedMs,
      totalMsReported: result.totalMs,
      captures: summary,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        stage: "render",
        ssrfGuardOk,
        error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      },
      { status: 500 }
    );
  }
}
