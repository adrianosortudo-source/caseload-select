"use client";

/**
 * VoiceInput — microphone button for the kickoff TextCard.
 *
 * Behaviour:
 *  - Tap once to start recording. Mic indicator pulses.
 *  - Tap again (or auto-stop after 60s) to end recording.
 *  - Audio blob is POSTed to /api/transcribe.
 *  - Whisper transcript is appended to the parent textarea (via onTranscript).
 *
 * Browser support: MediaRecorder is available in all modern browsers.
 * Falls back gracefully — if getUserMedia is unavailable or denied, the
 * button is hidden and the user can still type.
 */

import { useEffect, useRef, useState } from "react";

interface Props {
  /** Called with the transcribed text once Whisper returns. */
  onTranscript: (text: string) => void;
  /** Called when an error occurs (mic blocked, transcription failed). */
  onError?: (message: string) => void;
}

const MAX_RECORDING_MS = 60_000; // hard cap to prevent runaway recordings

type RecState = "idle" | "requesting" | "recording" | "uploading";

export function VoiceInput({ onTranscript, onError }: Props) {
  const [state, setState] = useState<RecState>("idle");
  const [supported, setSupported] = useState<boolean>(true);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const streamRef   = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Capability detection on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("MediaRecorder" in window)) { setSupported(false); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setSupported(false); return; }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTicker();
      stopRecorder();
      releaseStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopTicker() {
    if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; }
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
  }

  function stopRecorder() {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch { /* ignore */ }
  }

  function releaseStream() {
    streamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
    streamRef.current = null;
  }

  async function start() {
    if (state !== "idle") return;
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => { void handleStop(); };

      recorder.start();
      startedAtRef.current = Date.now();
      setElapsed(0);
      setState("recording");

      tickerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      autoStopRef.current = setTimeout(() => stopRecorder(), MAX_RECORDING_MS);
    } catch (err) {
      setState("idle");
      releaseStream();
      const msg = err instanceof Error ? err.message : String(err);
      if (onError) onError(`Mic access denied: ${msg}`);
    }
  }

  function stop() {
    if (state !== "recording") return;
    stopTicker();
    stopRecorder();
  }

  async function handleStop() {
    setState("uploading");
    releaseStream();
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type ?? "audio/webm" });
    chunksRef.current = [];

    if (blob.size === 0) {
      setState("idle");
      if (onError) onError("No audio captured. Try again.");
      return;
    }

    try {
      const fd = new FormData();
      fd.append("audio", blob, "kickoff.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const data = (await res.json()) as { ok: boolean; text?: string; error?: string };
      if (!data.ok) {
        setState("idle");
        if (onError) onError(data.error ?? "Transcription failed.");
        return;
      }
      if (data.text) onTranscript(data.text);
      setState("idle");
    } catch (err) {
      setState("idle");
      if (onError) onError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!supported) return null;

  const isRecording = state === "recording";
  const isBusy = state === "requesting" || state === "uploading";
  const label =
    state === "requesting" ? "Allow mic..." :
    state === "uploading"  ? "Transcribing..." :
    state === "recording"  ? `Recording... ${elapsed}s` :
                              "Tap to record";

  return (
    <button
      type="button"
      onClick={isRecording ? stop : start}
      disabled={isBusy}
      aria-label={isRecording ? "Stop recording" : "Record voice"}
      className={[
        "inline-flex items-center gap-2 h-10 px-4 rounded-full text-[13px] font-medium",
        "transition-all border",
        isRecording
          ? "bg-red-50 border-red-300 text-red-700 hover:bg-red-100"
          : "bg-white border-[#1E2F58]/15 text-[#1E2F58] hover:border-[#C4B49A]",
        isBusy ? "opacity-60 cursor-wait" : "",
      ].join(" ")}
      style={{ fontFamily: "DM Sans, sans-serif" }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10a7 7 0 0 1-14 0" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8"  y1="23" x2="16" y2="23" />
      </svg>
      <span>{label}</span>
      {isRecording && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse ml-1" />}
    </button>
  );
}

function pickMimeType(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}
