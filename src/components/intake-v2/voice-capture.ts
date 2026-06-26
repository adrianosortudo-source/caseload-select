/**
 * voice-capture - shared browser audio helpers for the intake recorder.
 *
 * Used by both VoiceInput.tsx (inline mic inside the widget) and
 * RecordHandoff.tsx (the top-level first-party recorder reached via the iOS
 * handoff). Keeping one implementation means the WAV transcode and MIME
 * selection cannot drift between the two surfaces.
 *
 * The transcriber (Gemini, via /api/transcribe) does not accept the audio/webm
 * or audio/mp4 that MediaRecorder produces, so the recording is decoded and
 * re-encoded as 16 kHz mono WAV in the browser. The browser already has a
 * decoder for whatever it just recorded, so this needs no library.
 */

// Target format for the transcriber: 16 kHz mono is the speech-recognition
// sweet spot (small payload, no quality loss for voice) and WAV is a format
// Gemini accepts directly.
const TARGET_SAMPLE_RATE = 16_000;

/** Pick the best MediaRecorder MIME type the current browser supports. */
export function pickMimeType(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

/**
 * Decode the browser's recording (webm/opus on Chrome, mp4/aac on Safari) and
 * re-encode it as a 16 kHz mono WAV. decodeAudioData uses the same codec the
 * browser used to record, so a browser can always decode its own output.
 */
export async function transcodeToWav(blob: Blob): Promise<Blob> {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error("Web Audio API unavailable");

  const arrayBuffer = await blob.arrayBuffer();

  // A short-lived context only to decode; closed immediately after.
  const decodeCtx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    try {
      await decodeCtx.close();
    } catch {
      // ignore
    }
  }

  const frameCount = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  if (frameCount <= 0) throw new Error("recording was empty");

  // Resample to mono 16 kHz via an offline render.
  const OfflineCtx =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OfflineCtx) throw new Error("OfflineAudioContext unavailable");

  const offline = new OfflineCtx(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();

  return encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
}

/** Encode mono float PCM samples as a 16-bit PCM WAV blob. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Transcode the recording to WAV and POST it to /api/transcribe. Returns a
 * normalised result so callers can phrase their own UI copy. Never throws.
 */
export async function transcribeRecording(
  blob: Blob,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let wav: Blob;
  try {
    wav = await transcodeToWav(blob);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not process the recording: ${err.message}`
          : "Could not process the recording. Try again.",
    };
  }

  try {
    const fd = new FormData();
    fd.append("audio", wav, "kickoff.wav");
    const res = await fetch("/api/transcribe", { method: "POST", body: fd });
    const data = (await res.json()) as { ok: boolean; text?: string; error?: string };
    if (!data.ok) return { ok: false, error: data.error ?? "Transcription failed." };
    if (!data.text) return { ok: false, error: "Transcript came back empty." };
    return { ok: true, text: data.text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
