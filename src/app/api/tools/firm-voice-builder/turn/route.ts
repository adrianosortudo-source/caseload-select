/**
 * POST /api/tools/firm-voice-builder/turn
 *
 * Public, same-origin, stateless turn endpoint for the Firm Voice Builder
 * interactive tool (BUILD_PLAN_firm_voice_builder_tool_v1.md Phase 1).
 *
 * Stateless by design (plan L3): the browser sends the full running
 * transcript on every call; nothing is persisted server-side, nothing is
 * read server-side between calls. No auth, no firmId, no database access
 * of any kind. This is also the tool's privacy claim to the visitor: their
 * answers are processed to run the interview and never stored on our
 * servers.
 *
 * Pipeline: validate -> rate limit -> map transcript to Gemini contents ->
 * single Gemini call -> parse section tag + profile markers -> respond.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { validateTranscript, transcriptToGeminiContents } from "@/lib/firm-voice-builder/turn";
import { runFirmVoiceBuilderTurn } from "@/lib/firm-voice-builder/gemini";
import {
  parseSectionTag,
  extractProfile,
  PROFILE_START_MARKER,
  PROFILE_END_MARKER,
} from "@/lib/firm-voice-builder/system-prompt";

/**
 * Escapes regex metacharacters in a literal string. The two marker
 * constants contain only `=` and word characters today, but this keeps the
 * strip logic correct even if the markers ever change.
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PROFILE_BLOCK_RE = new RegExp(
  `${escapeRegExp(PROFILE_START_MARKER)}[\\s\\S]*?${escapeRegExp(PROFILE_END_MARKER)}`,
);

/**
 * Removes the marker-wrapped profile block from the model's raw message,
 * leaving any lead-in and any trailing content (the proof-of-work pieces
 * and the follow-up question, per spec Section 7 step 7) intact for the
 * chat bubble. The reveal panel renders the extracted profile separately.
 */
function stripProfileBlock(text: string): string {
  return text.replace(PROFILE_BLOCK_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

export const dynamic = "force-dynamic";

interface TurnResponseBody {
  ok: boolean;
  /** Display text: section tag stripped, profile block stripped (shown in the chat bubble). */
  message?: string;
  /**
   * The untouched model output, tag and profile block included. The client
   * must store THIS (not `message`) as the transcript entry it resends on
   * the next call: the profile-revision loop (spec Section 7 step 7)
   * requires the model to see its own previously emitted profile text in
   * history, which `message` deliberately strips for display.
   */
  raw?: string;
  section?: number | null;
  profile?: string | null;
  error?: string;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<TurnResponseBody>({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const validation = validateTranscript(body);
  if (!validation.valid) {
    return NextResponse.json<TurnResponseBody>({ ok: false, error: validation.error }, { status: 400 });
  }

  const ip = ipFromRequest(req);
  const decision = await checkRateLimit("firmVoiceBuilder", ip);
  if (!decision.ok) {
    return NextResponse.json<TurnResponseBody>(
      { ok: false, error: "rate limited, try again shortly" },
      { status: 429, headers: rateLimitHeaders(decision) },
    );
  }

  const contents = transcriptToGeminiContents(validation.transcript);
  const result = await runFirmVoiceBuilderTurn(contents);

  if (result.mode === "disabled") {
    return NextResponse.json<TurnResponseBody>(
      { ok: false, error: "the tool is not configured for this deployment" },
      { status: 503 },
    );
  }
  if (result.mode === "error" || !result.text) {
    return NextResponse.json<TurnResponseBody>(
      { ok: false, error: "could not generate the next question, try again" },
      { status: 502 },
    );
  }

  const { section, text: displayText } = parseSectionTag(result.text);
  const profile = extractProfile(result.text);

  return NextResponse.json<TurnResponseBody>({
    ok: true,
    message: profile ? stripProfileBlock(displayText) : displayText,
    raw: result.text,
    section,
    profile,
  });
}
