/**
 * POST /api/transcribe
 *
 * Receives an audio blob (WebM/Opus from MediaRecorder), transcribes it via
 * OpenAI Whisper, returns the transcript text. Used by the IntakeControllerV2
 * kickoff screen so prospects can record their situation by voice instead of
 * typing.
 *
 * Body: multipart/form-data with field "audio" (Blob)
 * Returns: { ok: true; text: string } | { ok: false; error: string }
 *
 * Notes:
 *  - Uses OPENAI_API_KEY (already provisioned for the screening engine).
 *  - Whisper model: whisper-1. ~$0.006 per minute of audio.
 *  - Max blob size: 25 MB (Whisper API limit). Browser typically produces
 *    ~50-100 KB for a 30-second clip, so this is comfortable.
 *  - English-only is the default. Multi-lingual support is intentionally
 *    out of scope (per CLAUDE.md "Do Not — Add multilingual features").
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs"; // Required because Whisper SDK uses Node FormData

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
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

    // Forward to OpenAI Whisper as multipart/form-data
    const upstream = new FormData();
    upstream.append("file", audio, "kickoff.webm");
    upstream.append("model", "whisper-1");
    upstream.append("language", "en");
    upstream.append("response_format", "json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json(
        { ok: false, error: `Transcription failed (HTTP ${res.status}): ${errBody.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
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
