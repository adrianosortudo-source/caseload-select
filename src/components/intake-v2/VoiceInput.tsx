"use client";

/**
 * VoiceInput - microphone button for the kickoff TextCard.
 *
 * Behaviour:
 *  - Tap once to start recording. Mic indicator pulses.
 *  - Tap again (or auto-stop after 60s) to end recording.
 *  - The recording is transcoded to WAV (16 kHz mono) in the browser before
 *    upload, because the server transcriber (Gemini) does not accept the
 *    audio/webm or audio/mp4 that MediaRecorder produces. The browser already
 *    has a decoder for whatever it just recorded, so this needs no library.
 *  - The WAV blob is POSTed to /api/transcribe.
 *  - The transcript is appended to the parent textarea (via onTranscript).
 *
 * Browser support is checked in the current browsing context. iOS
 * Chrome/Firefox/Edge and in-app browsers are WKWebView shells, and WebKit
 * blocks media capture in some iframe contexts before the user ever sees a
 * permission prompt. In those cases we show honest fallback copy and keep
 * typing as the guaranteed path.
 */

import { useEffect, useRef, useState } from "react";

interface Props {
  /** Called with the transcribed text once Gemini returns. */
  onTranscript: (text: string) => void;
  /** Called when an error occurs (mic blocked, transcription failed). */
  onError?: (message: string) => void;
  /** Reports whether the voice UI is actually available in this context. */
  onAvailabilityChange?: (available: boolean) => void;
}

const MAX_RECORDING_MS = 60_000; // hard cap to prevent runaway recordings

type RecState = "idle" | "requesting" | "recording" | "uploading";
type VoiceCapability =
  | { canAttempt: true }
  | { canAttempt: false; message: string };

export function VoiceInput({ onTranscript, onError, onAvailabilityChange }: Props) {
  const [state, setState] = useState<RecState>("idle");
  const [capability, setCapability] = useState<VoiceCapability | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Capability detection on mount. This cannot call getUserMedia because that
  // would prompt for mic permission outside the user's tap; it checks the known
  // platform, frame, and policy gates that make the call impossible.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = getVoiceCapability();
    setCapability(next);
    onAvailabilityChange?.(next.canAttempt);
  }, [onAvailabilityChange]);

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
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }

  function stopRecorder() {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      // ignore
    }
  }

  function releaseStream() {
    streamRef.current?.getTracks().forEach(t => {
      try {
        t.stop();
      } catch {
        // ignore
      }
    });
    streamRef.current = null;
  }

  async function start() {
    if (state !== "idle") return;
    if (!capability?.canAttempt) return;
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
      recorder.onstop = () => {
        void handleStop();
      };

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
      if (isPermissionOrPolicyError(err)) {
        const next = getVoiceCapabilityAfterRuntimeDenial();
        setCapability(next);
        onAvailabilityChange?.(next.canAttempt);
      }
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

    let upload: Blob;
    let filename: string;
    try {
      upload = await transcodeToWav(blob);
      filename = "kickoff.wav";
    } catch (err) {
      setState("idle");
      if (onError) {
        onError(
          err instanceof Error
            ? `Could not process the recording: ${err.message}`
            : "Could not process the recording. Try again."
        );
      }
      return;
    }

    try {
      const fd = new FormData();
      fd.append("audio", upload, filename);
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

  if (!capability) return null;

  if (!capability.canAttempt) {
    return (
      <p
        className="text-[12px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_55%,transparent)]"
        style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
      >
        {capability.message}
      </p>
    );
  }

  const isRecording = state === "recording";
  const isBusy = state === "requesting" || state === "uploading";
  const label =
    state === "requesting" ? "Allow mic..." :
    state === "uploading" ? "Transcribing..." :
    state === "recording" ? `Recording... ${elapsed}s` :
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
          : "bg-[var(--cls-surface,#FFFFFF)] border-[color-mix(in_srgb,var(--cls-accent,#1E2F58)_15%,transparent)] text-[var(--cls-text,#1E2F58)] hover:border-[var(--cls-border-hover,#C4B49A)]",
        isBusy ? "opacity-60 cursor-wait" : "",
      ].join(" ")}
      style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10a7 7 0 0 1-14 0" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
      <span>{label}</span>
      {isRecording && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse ml-1" />}
    </button>
  );
}

function getVoiceCapability(): VoiceCapability {
  if (typeof window === "undefined") return { canAttempt: false, message: "Voice input is unavailable here. Please type your answer." };
  if (!window.isSecureContext) return { canAttempt: false, message: "Voice input requires a secure connection. Please type your answer." };
  if (!("MediaRecorder" in window)) return { canAttempt: false, message: "Voice input is not supported in this browser. Please type your answer." };
  if (!navigator.mediaDevices?.getUserMedia) return { canAttempt: false, message: "Voice input is not supported in this browser. Please type your answer." };
  if (!permissionsPolicyAllows("microphone")) {
    return { canAttempt: false, message: "Voice input is unavailable on this site. Please type your answer." };
  }

  const context = getBrowserContext();

  // Production block: any iOS browser inside a cross-origin iframe. WebKit
  // (which every iOS browser runs on) refuses getUserMedia in a third-party
  // frame, so the widget embedded on a firm site cannot record on iPhone or
  // iPad. Top-level iOS, including the WebKit shells on iOS 14.3+, is allowed
  // to try; the runtime-denial handler below swaps in fallback copy if it
  // actually fails.
  if (context.isIOS && context.isCrossOriginFrame) {
    return {
      canAttempt: false,
      message: "Voice input is not available inside this embedded intake on iPhone/iPad. Please type your answer.",
    };
  }

  return { canAttempt: true };
}

// Called after getUserMedia throws NotAllowedError / SecurityError. A runtime
// refusal is definitive for this context, so we always drop to fallback copy
// rather than re-offering a button that will fail again.
function getVoiceCapabilityAfterRuntimeDenial(): VoiceCapability {
  const context = getBrowserContext();
  if (context.isIOS) {
    return {
      canAttempt: false,
      message: context.isCrossOriginFrame
        ? "Voice input is not available inside this embedded intake on iPhone/iPad. Please type your answer."
        : "Voice input is not available in this browser. Please type your answer.",
    };
  }
  return {
    canAttempt: false,
    message: "Microphone access is blocked for this site. Please type your answer.",
  };
}

function isPermissionOrPolicyError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return err.name === "NotAllowedError" || err.name === "SecurityError";
}

function getBrowserContext() {
  const ua = navigator.userAgent;
  const platform = navigator.platform;
  const isIPadOSDesktopMode = platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || isIPadOSDesktopMode;
  const isCriOS = /\bCriOS\//.test(ua);
  const isFxiOS = /\bFxiOS\//.test(ua);
  const isEdgiOS = /\bEdgiOS\//.test(ua);
  const isDuckDuckGoIOS = /\bDuckDuckGo\//.test(ua) && isIOS;
  const isSafari =
    isIOS &&
    /Safari\//.test(ua) &&
    !isCriOS &&
    !isFxiOS &&
    !isEdgiOS &&
    !isDuckDuckGoIOS &&
    navigator.vendor === "Apple Computer, Inc.";

  return {
    isIOS,
    isSafari,
    isIOSWebKitShell: isIOS && !isSafari,
    isEmbedded: isEmbeddedFrame(),
    isCrossOriginFrame: isCrossOriginEmbeddedFrame(),
  };
}

function isEmbeddedFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isCrossOriginEmbeddedFrame(): boolean {
  if (!isEmbeddedFrame()) return false;
  try {
    return window.top?.location.origin !== window.location.origin;
  } catch {
    return true;
  }
}

function permissionsPolicyAllows(feature: string): boolean {
  const doc = document as Document & {
    permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
    featurePolicy?: { allowsFeature?: (feature: string) => boolean };
  };

  try {
    if (doc.permissionsPolicy?.allowsFeature) return doc.permissionsPolicy.allowsFeature(feature);
    if (doc.featurePolicy?.allowsFeature) return doc.featurePolicy.allowsFeature(feature);
  } catch {
    return false;
  }

  return true;
}

function pickMimeType(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

// Target format for the transcriber: 16 kHz mono is the speech-recognition
// sweet spot (small payload, no quality loss for voice) and WAV is a format
// Gemini accepts directly.
const TARGET_SAMPLE_RATE = 16_000;

/**
 * Decode the browser's recording (webm/opus on Chrome, mp4/aac on Safari) and
 * re-encode it as a 16 kHz mono WAV. decodeAudioData uses the same codec the
 * browser used to record, so a browser can always decode its own output.
 */
async function transcodeToWav(blob: Blob): Promise<Blob> {
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
