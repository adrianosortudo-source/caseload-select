import { NextRequest, NextResponse } from "next/server";
import { renderUrl } from "@/lib/design-check/renderer";
import { checkOutboundRequest } from "@/lib/design-check/ssrf-guard";
import { scoreTypography } from "@/lib/design-check/dimensions/typography";
import { scoreColorContrast } from "@/lib/design-check/dimensions/color-contrast";
import { scoreForms } from "@/lib/design-check/dimensions/forms";
import { scoreMobile } from "@/lib/design-check/dimensions/mobile";
import { scorePerformance } from "@/lib/design-check/dimensions/performance";
import { scoreSpacing } from "@/lib/design-check/dimensions/spacing";
import { scoreAuthority } from "@/lib/design-check/dimensions/authority";
import { judgeScreenshot } from "@/lib/design-check/vision-judgment";
import { judgeAuthorityScreenshot } from "@/lib/design-check/authority-vision";
import { buildTrack1Report } from "@/lib/design-check/aggregate";
import type { DimensionResult } from "@/lib/design-check/dimension-types";
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

  // Vision judgment costs real tokens; only run it when explicitly asked,
  // never on every spike request by default.
  const runVision = request.nextUrl.searchParams.get("vision") === "1";

  try {
    const start = Date.now();
    const result = await renderUrl(url);
    const elapsedMs = Date.now() - start;

    const outDir = "C:\\Users\\adria\\AppData\\Local\\Temp\\claude\\D--\\dae522db-78ad-496b-9275-71ba5ba48553\\scratchpad";
    const summary = await Promise.all(
      result.captures.map(async (c) => {
        const outPath = path.join(outDir, `design-check-spike-${domain}-${c.viewport}.png`);
        writeFileSync(outPath, c.screenshotPng);

        let vision: Awaited<ReturnType<typeof judgeScreenshot>> | { error: string } | null = null;
        let authorityVision: Awaited<ReturnType<typeof judgeAuthorityScreenshot>> | { error: string } | null = null;
        if (runVision && c.viewport === "desktop") {
          try {
            authorityVision = await judgeAuthorityScreenshot(
              c.screenshotPng,
              `Lexicon and schema signals will be scored separately; judge only the 6 rubric items against the screenshot.`
            );
          } catch (visionErr) {
            authorityVision = { error: visionErr instanceof Error ? visionErr.message : String(visionErr) };
          }
        }

        const dimensions = {
          typography: scoreTypography(c.domSnapshot),
          colorContrast: scoreColorContrast(c.domSnapshot),
          forms: scoreForms(c.domSnapshot),
          ...(c.viewport === "mobile" ? { mobile: scoreMobile(c.domSnapshot) } : {}),
          performance: scorePerformance(c.domSnapshot, c.webVitals),
          spacing: scoreSpacing(c.domSnapshot),
          authority: scoreAuthority(
            c.domSnapshot,
            c.finalUrl,
            "judgments" in (authorityVision ?? {}) ? (authorityVision as Awaited<ReturnType<typeof judgeAuthorityScreenshot>>).judgments : undefined
          ),
        };

        if (runVision && c.viewport === "desktop") {
          try {
            vision = await judgeScreenshot(c.screenshotPng, Object.values(dimensions));
          } catch (visionErr) {
            vision = { error: visionErr instanceof Error ? visionErr.message : String(visionErr) };
          }
        }

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
            authority: c.domSnapshot.authority,
            darkPatterns: c.domSnapshot.darkPatterns,
          },
          webVitals: c.webVitals,
          blockedRequests: c.blockedRequests,
          dimensions,
          vision,
          authorityVision,
        };
      })
    );

    // Phase 4 aggregation: combine desktop's typography/color/forms/
    // performance/spacing/authority with mobile's mobile-only dimension
    // into one Track 1 report, matching how a real scan would merge
    // per-viewport signal into a single grade.
    const desktopCapture = result.captures.find((c) => c.viewport === "desktop");
    const mobileCapture = result.captures.find((c) => c.viewport === "mobile");
    let track1Report: ReturnType<typeof buildTrack1Report> | null = null;
    if (desktopCapture && mobileCapture) {
      const desktopDimensions = {
        typography: scoreTypography(desktopCapture.domSnapshot),
        colorContrast: scoreColorContrast(desktopCapture.domSnapshot),
        forms: scoreForms(desktopCapture.domSnapshot),
        performance: scorePerformance(desktopCapture.domSnapshot, desktopCapture.webVitals),
        spacing: scoreSpacing(desktopCapture.domSnapshot),
      };
      const mobileDimension: DimensionResult = scoreMobile(mobileCapture.domSnapshot);
      const desktopSummary = summary.find((s) => s.viewport === "desktop");
      const desktopVisionJudgments =
        desktopSummary && desktopSummary.authorityVision && "judgments" in desktopSummary.authorityVision ? desktopSummary.authorityVision.judgments : undefined;
      const desktopGeneralVisionJudgments = desktopSummary && desktopSummary.vision && "judgments" in desktopSummary.vision ? desktopSummary.vision.judgments : undefined;
      const authorityResult = scoreAuthority(desktopCapture.domSnapshot, desktopCapture.finalUrl, desktopVisionJudgments);
      track1Report = buildTrack1Report(
        [...Object.values(desktopDimensions), mobileDimension],
        authorityResult,
        desktopGeneralVisionJudgments,
        desktopCapture.domSnapshot.darkPatterns
      );
    }

    return NextResponse.json({
      ok: true,
      ssrfGuardOk,
      domain,
      elapsedMs,
      totalMsReported: result.totalMs,
      captures: summary,
      track1Report,
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
