/**
 * POST /api/transcribe
 *
 * Receives an audio blob, transcribes it via Google Gemini, returns the
 * transcript text. Used by the IntakeControllerV2 kickoff screen so prospects
 * can record their situation by voice instead of typing.
 *
 * Body: multipart/form-data with field "audio" (Blob)
 * Returns: { ok: true; text: string } | { ok: false; error: string }
 *
 * Notes:
 *  - Uses GOOGLE_AI_API_KEY (falls back to GEMINI_API_KEY), the same key the
 *    screen engine already runs on. OpenAI is no longer in this path.
 *  - Model: gemini-2.5-flash. Gemini transcribes audio natively.
 *  - Gemini accepts audio/wav, audio/mp3, audio/aiff, audio/aac, audio/ogg,
 *    audio/flac. It does NOT accept the audio/webm or audio/mp4 that browsers
 *    record, so VoiceInput.tsx transcodes the recording to WAV (16 kHz mono)
 *    client-side before upload. The blob that reaches this route is already
 *    Gemini-compatible; we still normalise the declared MIME defensively.
 *  - Max blob size: 25 MB. A 16 kHz mono WAV is ~1 MB per minute, so a
 *    60-second kickoff clip lands around 1-2 MB.
 *  - Multi-lingual: no language is forced. Gemini returns the transcript in
 *    the spoken language; the screen engine handles detection downstream.
 */

import { NextResponse } from "next/server";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs"; // Buffer + formData() on the server

const MAX_BYTES = 25 * 1024 * 1024;

// Content-Length guard bound: the audio cap plus headroom for multipart
// framing. Rejecting on the header avoids buffering an oversize body
// through formData() before the blob-size check can run.
const MAX_REQUEST_BYTES = MAX_BYTES + 64 * 1024;

const GEMINI_MODEL = "gemini-2.5-flash";

// MIME types Gemini accepts for inline audio. The client sends WAV; anything
// else is mapped to its closest accepted type or defaults to audio/wav.
const GEMINI_AUDIO_MIME = new Set([
  "audio/wav",
  "audio/mp3",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
]);

function normaliseAudioMime(declared: string): string {
  const base = (declared || "").split(";")[0].trim().toLowerCase();
  if (GEMINI_AUDIO_MIME.has(base)) return base;
  if (base === "audio/mpeg") return "audio/mp3";
  if (base === "audio/x-wav" || base === "audio/wave") return "audio/wav";
  return "audio/wav";
}

const TRANSCRIBE_PROMPT =
  "Transcribe this audio recording verbatim. Return only the spoken words as " +
  "plain text, with no preamble, labels, quotation marks, or commentary. If " +
  "the audio contains no discernible speech, return an empty string.";

export async function POST(req: Request) {
  // Public route (the kickoff recorder calls it from the browser); the
  // per-IP bucket is the only gate in front of the model spend (H6).
  const ip = ipFromRequest(req);
  const rl = await checkRateLimit("transcribe", ip);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retry_after_seconds: Math.ceil((rl.reset - Date.now()) / 1000) },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ ok: false, error: "audio exceeds 25 MB limit" }, { status: 413 });
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Server not configured for transcription." },
      { status: 500 }
    );
  }

  try {
    const formData = await req.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "audio field missing" }, { status: 400 });
    }
    if (audio.size === 0) {
      return NextResponse.json({ ok: false, error: "audio is empty" }, { status: 400 });
    }
    if (audio.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "audio exceeds 25 MB limit" }, { status: 413 });
    }

    const mimeType = normaliseAudioMime(audio.type);
    const base64 = Buffer.from(await audio.arrayBuffer()).toString("base64");

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: TRANSCRIBE_PROMPT },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json(
        { ok: false, error: `Transcription failed (HTTP ${res.status}): ${errBody.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();

    if (!text) {
      return NextResponse.json({ ok: false, error: "Transcript came back empty." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, text });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
