/**
 * POST /api/tools/why-your-firm/assist
 *
 * The lawyer types a differentiator in their own words and presses the assist
 * button. This route asks Gemini for a tighter version of that one claim.
 *
 * ADVISORY ONLY, NEVER A GATE
 * The deterministic filter in why-your-firm/compliance.ts is the real check,
 * and it runs twice already: in the browser as the lawyer types, and again on
 * the server when /report assembles the brief. This route decides nothing. It
 * returns a suggestion the lawyer accepts or discards, and whichever version
 * wins goes through the same filter either way. A 502 here is not a failure
 * state for the tool: the lawyer's own wording stands and every check still
 * runs (copy.assist.unavailable in compliance.ts is the line they see).
 *
 * Public, same-origin, no auth, no firmId, and no persistence of any kind.
 * The claim is processed and dropped, which is what the tool's privacy line
 * (copy.tool.privacyNoGateAssist) promises about this one exception.
 *
 * Pipeline: parse -> validate -> rate limit -> Gemini -> respond.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { validateAssistBody, runAssist, type AssistConcern } from "@/lib/why-your-firm/assist";
import type { Category } from "@/lib/why-your-firm/differentiators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AssistResponseBody {
  ok: boolean;
  /** One sentence, the lawyer's meaning, in a shape a stranger could verify. */
  tightenedClaim?: string;
  /** One of the eight differentiator category ids. */
  category?: Category;
  /** Rules the model reads as in play on the ORIGINAL claim, at most five. */
  concerns?: AssistConcern[];
  error?: string;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<AssistResponseBody>({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const validation = validateAssistBody(body);
  if (!validation.valid) {
    return NextResponse.json<AssistResponseBody>({ ok: false, error: validation.error }, { status: 400 });
  }

  const decision = await checkRateLimit("whyYourFirmAssist", ipFromRequest(req));
  if (!decision.ok) {
    return NextResponse.json<AssistResponseBody>(
      { ok: false, error: "rate limited, try again shortly" },
      { status: 429, headers: rateLimitHeaders(decision) },
    );
  }

  const outcome = await runAssist(validation.value);

  if (outcome.mode === "disabled") {
    return NextResponse.json<AssistResponseBody>(
      { ok: false, error: "the assist is not configured for this deployment" },
      { status: 503 },
    );
  }
  if (outcome.mode === "error" || !outcome.result) {
    return NextResponse.json<AssistResponseBody>(
      { ok: false, error: "no suggestion came back, your wording stands" },
      { status: 502 },
    );
  }

  return NextResponse.json<AssistResponseBody>({
    ok: true,
    tightenedClaim: outcome.result.tightenedClaim,
    category: outcome.result.category,
    concerns: outcome.result.concerns,
  });
}
