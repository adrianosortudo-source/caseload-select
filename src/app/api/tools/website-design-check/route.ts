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
import { judgeAuthorityScreenshot, type AuthorityJudgmentScore } from "@/lib/design-check/authority-vision";
import { buildTrack1Report } from "@/lib/design-check/aggregate";
import type { DimensionResult } from "@/lib/design-check/dimension-types";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * The Website Design Grading tool's public scan endpoint. Runs the full
 * pipeline built across Phases 0-4: real headless-browser render at two
 * viewports, deterministic dimension scoring, two Anthropic vision-model
 * judgment passes (general design quality + authority/positioning), and
 * Track 1 aggregation into a letter grade with ranked findings.
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
  const ssrfCheck = await checkOutboundRequest(url);
  if (ssrfCheck.blocked) {
    return NextResponse.json({ error: "That domain can't be checked." }, { status: 400 });
  }

  try {
    const result = await renderUrl(url);
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
        letterGrade: track1Report.letterGrade,
        dimensionBar: track1Report.dimensionBar,
        notMeasuredDimensions: track1Report.notMeasuredDimensions,
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
    return NextResponse.json({ error: "Something went wrong scanning this site. Try again." }, { status: 500 });
  }
}
