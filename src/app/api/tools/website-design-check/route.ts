import { NextRequest, NextResponse } from "next/server";
import {
  fetchRenderResult,
  RenderServiceBlockedError,
  RenderServiceRenderFailedError,
} from "@/lib/design-check/render-client";
import { validateOutboundUrl } from "@/lib/ssrf";
import { scoreTypography } from "@/lib/design-check/dimensions/typography";
import { scoreColorContrast } from "@/lib/design-check/dimensions/color-contrast";
import { scoreForms } from "@/lib/design-check/dimensions/forms";
import { scoreMobile } from "@/lib/design-check/dimensions/mobile";
import { scorePerformance } from "@/lib/design-check/dimensions/performance";
import { scoreSpacing } from "@/lib/design-check/dimensions/spacing";
import { scoreAuthority } from "@/lib/design-check/dimensions/authority";
import { judgeScreenshot } from "@/lib/design-check/vision-judgment";
import { judgeAuthorityScreenshot, type AuthorityJudgmentScore } from "@/lib/design-check/authority-vision";
import { buildTrack1Report } from "@/lib/design-check/aggregate";
import type { DimensionResult } from "@/lib/design-check/dimension-types";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * The Website Design Grading tool's public scan endpoint. Runs the full
 * pipeline built across Phases 0-4: real headless-browser render at two
 * viewports, deterministic dimension scoring, two Gemini vision-model
 * judgment passes (general design quality + authority/positioning), and
 * Track 1 aggregation into a letter grade with ranked findings.
 *
 * The render itself (fetchRenderResult, below) runs out-of-process in
 * services/render/, a separate Vercel project with zero application
 * secrets: this route hands it a URL and gets back plain data (base64
 * screenshots, a DOM snapshot, web vitals), never a browser handle. See
 * docs/BUILD_PLAN_render_isolation_v1.md for why -- the browser executes
 * attacker-chosen content, and this route's own runtime holds every
 * secret the app has.
 *
 * v1 scope, per the build plan's operator-confirmed decisions: single-URL
 * only (no multi-page crawl), no Supabase persistence (nothing is stored;
 * the response is the only record of a scan), no email forwarding (the
 * email gate on the client side is a soft lead-capture prompt, not wired
 * to any send path, matching seo-check's own tool exactly).
 */
export const runtime = "nodejs";
export const maxDuration = 120;

// Same normalization/validation shape as seo-check's own route, written
// independently rather than imported, per the standing decision to keep
// the two tools' logic distinct (see dimension-types.ts).
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export async function POST(request: NextRequest) {
  const decision = await checkRateLimit("designCheck", ipFromRequest(request));
  if (!decision.ok) {
    return NextResponse.json({ error: "Too many checks. Try again in a few minutes." }, { status: 429, headers: rateLimitHeaders(decision) });
  }

  let body: { domain?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body.domain !== "string" || !body.domain.trim()) {
    return NextResponse.json({ error: "Enter a domain to check." }, { status: 400 });
  }

  const domain = normalizeDomain(body.domain);
  if (!DOMAIN_PATTERN.test(domain)) {
    return NextResponse.json({ error: "That doesn't look like a valid domain." }, { status: 400 });
  }

  const url = `https://${domain}`;
  // Defence in depth (docs/BUILD_PLAN_render_isolation_v1.md §3.5): the
  // render itself now happens in an isolated service with zero
  // application secrets (see render-client.ts), which re-checks every
  // hop of the actual render with a DNS-pinned transport. This pre-check
  // stays so an obviously internal target never even reaches that
  // service call; it shares the same sync classification the service
  // itself uses (@/lib/ssrf), rather than the app maintaining a second,
  // independently-drifting implementation.
  const ssrfCheck = validateOutboundUrl(new URL(url), { allowedSchemes: ["https:"] });
  if (!ssrfCheck.ok) {
    return NextResponse.json({ error: "That domain can't be checked." }, { status: 400 });
  }

  try {
    const result = await fetchRenderResult(url);
    const desktopCapture = result.captures.find((c) => c.viewport === "desktop");
    const mobileCapture = result.captures.find((c) => c.viewport === "mobile");
    if (!desktopCapture || !mobileCapture) {
      return NextResponse.json({ error: "Could not render this site. Try again or check the domain." }, { status: 502 });
    }

    let authorityJudgments: AuthorityJudgmentScore[] | undefined;
    try {
      const authorityVision = await judgeAuthorityScreenshot(
        desktopCapture.screenshotPng,
        "Lexicon and schema signals are scored separately from measured DOM data; judge only the 6 rubric items against the screenshot."
      );
      authorityJudgments = authorityVision.judgments;
    } catch (err) {
      // Vision judgment is a quality layer, not a hard dependency: a
      // missing API key or a transient failure degrades to a
      // deterministic-only report rather than failing the whole scan.
      // The failure is logged, never swallowed silently: a degraded
      // report looks identical to a clean one in the response, so
      // without this line an operator has no way to tell that the
      // judgment layer stopped running.
      console.error("[design-check] authority vision judgment failed, degrading to deterministic-only:", err instanceof Error ? err.message : String(err));
      authorityJudgments = undefined;
    }

    const desktopDimensions: DimensionResult[] = [
      scoreTypography(desktopCapture.domSnapshot),
      scoreColorContrast(desktopCapture.domSnapshot),
      scoreForms(desktopCapture.domSnapshot),
      scorePerformance(desktopCapture.domSnapshot, desktopCapture.webVitals),
      scoreSpacing(desktopCapture.domSnapshot),
    ];
    const mobileDimension = scoreMobile(mobileCapture.domSnapshot);
    const authorityResult = scoreAuthority(desktopCapture.domSnapshot, desktopCapture.finalUrl, authorityJudgments);

    // Authority carries its checks under subScores, not a flat `items`
    // array, so it must be flattened into DimensionResult shape before it
    // can be fed to the judgment prompt. Passing the raw AuthorityDimensionResult
    // made buildUserPrompt read `d.items.filter` on undefined and threw,
    // which the catch below silently degraded: every scan lost this vision
    // pass. aggregate.ts already does this same flattening.
    const authorityAsDimension: DimensionResult = {
      name: authorityResult.name,
      weight: authorityResult.weight,
      score: authorityResult.score,
      maxScore: authorityResult.maxScore,
      items: authorityResult.subScores.flatMap((s) => s.items),
    };

    let generalJudgments;
    try {
      const visionResult = await judgeScreenshot(desktopCapture.screenshotPng, [...desktopDimensions, mobileDimension, authorityAsDimension]);
      generalJudgments = visionResult.judgments;
    } catch (err) {
      console.error("[design-check] design-quality vision judgment failed, degrading to deterministic-only:", err instanceof Error ? err.message : String(err));
      generalJudgments = undefined;
    }

    const track1Report = buildTrack1Report([...desktopDimensions, mobileDimension], authorityResult, generalJudgments, desktopCapture.domSnapshot.darkPatterns);

    return NextResponse.json(
      {
        domain,
        checkedAt: new Date().toISOString(),
        score: track1Report.score,
        // The uncapped weighted average, before any red-flag ceiling.
        // Named on the report as "the underlying measured craft" when a
        // disqualifying flag is capping the visible score. Not itself the
        // grade shown; see letterGrade below and attainable further down.
        uncappedScore: track1Report.uncappedScore,
        letterGrade: track1Report.letterGrade,
        // The grade within reach if every item in the path (the findings
        // carrying inAttainablePath: true, see rankedFindings) were
        // fixed. Leads the report per Phase 4 of
        // docs/BUILD_PLAN_design_check_calibration_v1.md.
        attainable: track1Report.attainable,
        dimensionBar: track1Report.dimensionBar,
        notMeasuredDimensions: track1Report.notMeasuredDimensions,
        notApplicableDimensions: track1Report.notApplicableDimensions,
        rankedFindings: track1Report.rankedFindings,
        redFlagPanel: track1Report.redFlagPanel,
        // Disclosed, not implied: when the page was too tall to capture
        // whole, the design-judgment items graded the top of the page
        // only. Same evidence-bounded posture as the not-checkable and
        // not-measured disclosures above.
        judgmentCoverage:
          desktopCapture.screenshotClippedFromPx === null
            ? { wholePage: true }
            : {
                wholePage: false,
                judgedTopPx: 7800,
                actualPageHeightPx: desktopCapture.screenshotClippedFromPx,
              },
      },
      { headers: rateLimitHeaders(decision) }
    );
  } catch (err) {
    // Logged, not swallowed: the visitor-facing message is deliberately
    // vague, so without this an operator has nothing to debug a failing
    // scan from.
    console.error("[design-check] scan failed:", err instanceof Error ? `${err.message}\n${err.stack}` : String(err));

    // A 403 from the render service must read identically to this
    // route's own pre-check rejection above -- same status, same exact
    // string -- so a prober cannot tell the two guard layers apart from
    // the outside (docs/BUILD_PLAN_render_isolation_v1.md §3.5).
    if (err instanceof RenderServiceBlockedError) {
      return NextResponse.json({ error: "That domain can't be checked." }, { status: 400 });
    }
    if (err instanceof RenderServiceRenderFailedError) {
      return NextResponse.json({ error: "Could not render this site. Try again or check the domain." }, { status: 502 });
    }
    return NextResponse.json({ error: "Something went wrong scanning this site. Try again." }, { status: 500 });
  }
}
