/**
 * POST /api/transcribe
 *
 * Transcribes the browser recorder's WAV upload in its spoken language.
 * Body: multipart/form-data, "audio" (up to 25 MB).
 * Returns: { ok: true, text } or { ok: false, error }.
 */

import { getProvider } from "@/lib/ai/openai";
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

class TranscriptionError extends Error {
  constructor(status: number) {
    super(`Transcription failed (HTTP ${status})`);
  }
}

const OPENAI_AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "video/webm": "webm",
};

async function transcribeOpenAI(audio: Blob, apiKey: string): Promise<string> {
  const body = new FormData();
  const mime = audio.type.split(";")[0].trim().toLowerCase();
  const ext = OPENAI_AUDIO_EXTENSIONS[mime]
    ?? normaliseAudioMime(mime).slice("audio/".length);
  body.append("file", audio, `recording.${ext}`);
  body.append("model", process.env.SCREEN_OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-transcribe");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    redirect: "error",
    body,
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new TranscriptionError(response.status);
  const result: { text?: unknown } = await response.json();
  return typeof result.text === "string" ? result.text.trim() : "";
}

async function transcribeGemini(audio: Blob, apiKey: string): Promise<string> {
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

  if (!res.ok) throw new TranscriptionError(res.status);

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

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

  const provider = getProvider("SCREEN_TRANSCRIPTION_AI_PROVIDER");
  const apiKey = provider === "openai"
    ? process.env.CASELOAD_OPENAI_API_KEY?.trim()
    : process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
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

    const text = provider === "openai"
      ? await transcribeOpenAI(audio, apiKey)
      : await transcribeGemini(audio, apiKey);

    if (!text) {
      return NextResponse.json({ ok: false, error: "Transcript came back empty." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, text });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof TranscriptionError ? err.message : "Could not process the recording." },
      { status: err instanceof TranscriptionError ? 502 : 500 }
    );
  }
}
