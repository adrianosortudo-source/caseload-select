"use client";

/**
 * VoiceInput - microphone button for the kickoff TextCard.
 *
 * Behaviour:
 *  - Tap once to start recording. Mic indicator pulses.
 *  - Tap again (or auto-stop after 60s) to end recording.
 *  - The recording is transcoded to WAV (16 kHz mono) in the browser before
 *    upload, then POSTed to /api/transcribe (Gemini). The transcript is
 *    appended to the parent textarea (via onTranscript). Shared audio helpers
 *    live in voice-capture.ts.
 *
 * Three context modes (see getVoiceCapability):
 *  - inline: the mic works in this context; show the record button.
 *  - handoff: inline mic is blocked (iOS inside a cross-origin iframe, where
 *    WebKit refuses getUserMedia), but a top-level first-party recorder can
 *    capture it. Show a "Record in a new tab" button that opens /voice-handoff
 *    and waits for the transcript to come back over the same-origin transport.
 *  - unavailable: no usable path; show honest fallback copy. Typing always
 *    stays available in the parent regardless of mode.
 */

import { useEffect, useRef, useState } from "react";
import { pickMimeType, transcribeRecording } from "./voice-capture";
import { buildHandoffUrl, listenForHandoffResult, makeSession } from "./voice-handoff";

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
  | { mode: "inline" }
  | { mode: "handoff" }
  | { mode: "unavailable"; message: string };

const ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10a7 7 0 0 1-14 0" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const RESTING_BUTTON =
  "bg-[var(--cls-surface,#FFFFFF)] border-[color-mix(in_srgb,var(--cls-accent,#1E2F58)_15%,transparent)] text-[var(--cls-text,#1E2F58)] hover:border-[var(--cls-border-hover,#C4B49A)]";

export function VoiceInput({ onTranscript, onError, onAvailabilityChange }: Props) {
  const [state, setState] = useState<RecState>("idle");
  const [capability, setCapability] = useState<VoiceCapability | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [handoffWaiting, setHandoffWaiting] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handoffCleanupRef = useRef<null | (() => void)>(null);

  // Capability detection on mount. This cannot call getUserMedia because that
  // would prompt for mic permission outside the user's tap; it checks the known
  // platform, frame, and policy gates that make the call impossible.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = getVoiceCapability();
    setCapability(next);
    onAvailabilityChange?.(next.mode !== "unavailable");
  }, [onAvailabilityChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTicker();
      stopRecorder();
      releaseStream();
      handoffCleanupRef.current?.();
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
    if (capability?.mode !== "inline") return;
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
        onAvailabilityChange?.(next.mode !== "unavailable");
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

    const result = await transcribeRecording(blob);
    setState("idle");
    if (!result.ok) {
      if (onError) onError(result.error);
      return;
    }
    onTranscript(result.text);
  }

  // Handoff: open the top-level recorder in a new tab and wait for the
  // transcript to come back over the same-origin transport.
  function startHandoff() {
    const firmId = getEmbeddedFirmId();
    if (!firmId) return;
    const origin = window.location.origin;
    const session = makeSession();

    handoffCleanupRef.current?.();
    handoffCleanupRef.current = listenForHandoffResult({
      firmId,
      session,
      onResult: transcript => {
        handoffCleanupRef.current = null;
        setHandoffWaiting(false);
        onTranscript(transcript);
      },
    });

    setHandoffWaiting(true);
    const win = window.open(buildHandoffUrl(origin, firmId, session), "_blank");
    if (!win) {
      handoffCleanupRef.current?.();
      handoffCleanupRef.current = null;
      setHandoffWaiting(false);
      if (onError) {
        onError(
          "Could not open the recorder. Allow pop-ups for this page and try again, or type your answer.",
        );
      }
    }
  }

  if (!capability) return null;

  if (capability.mode === "unavailable") {
    return (
      <p
        className="text-[12px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_55%,transparent)]"
        style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
      >
        {capability.message}
      </p>
    );
  }

  if (capability.mode === "handoff") {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={startHandoff}
          aria-label="Record voice in a new tab"
          className={[
            "inline-flex items-center gap-2 h-10 px-4 rounded-full text-[13px] font-medium",
            "transition-all border self-start",
            RESTING_BUTTON,
          ].join(" ")}
          style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
        >
          {ICON}
          <span>{handoffWaiting ? "Waiting for your recording..." : "Record in a new tab"}</span>
        </button>
        <p
          className="text-[12px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_55%,transparent)]"
          style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
        >
          On iPhone or iPad, voice recording opens in a new tab. Your words come
          back here on their own. You can also just type.
        </p>
      </div>
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
          : RESTING_BUTTON,
        isBusy ? "opacity-60 cursor-wait" : "",
      ].join(" ")}
      style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
    >
      {ICON}
      <span>{label}</span>
      {isRecording && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse ml-1" />}
    </button>
  );
}

function getVoiceCapability(): VoiceCapability {
  if (typeof window === "undefined") return { mode: "unavailable", message: "Voice input is unavailable here. Please type your answer." };
  if (!window.isSecureContext) return { mode: "unavailable", message: "Voice input requires a secure connection. Please type your answer." };
  if (!("MediaRecorder" in window)) return { mode: "unavailable", message: "Voice input is not supported in this browser. Please type your answer." };
  if (!navigator.mediaDevices?.getUserMedia) return { mode: "unavailable", message: "Voice input is not supported in this browser. Please type your answer." };

  const context = getBrowserContext();

  // Inline mic cannot run in this context, but a top-level first-party
  // recorder can. This is the production case on iOS (every iOS browser is
  // WebKit, which refuses getUserMedia in a cross-origin iframe), plus any
  // cross-origin embed whose host page did not delegate the mic. Offer the
  // handoff when we can identify the firm; otherwise fall back to typing.
  const inlineBlocked =
    (context.isIOS && context.isCrossOriginFrame) ||
    (context.isCrossOriginFrame && !permissionsPolicyAllows("microphone"));

  if (inlineBlocked) {
    if (getEmbeddedFirmId()) return { mode: "handoff" };
    return {
      mode: "unavailable",
      message: "Voice input is not available inside this embedded intake on iPhone/iPad. Please type your answer.",
    };
  }

  if (!permissionsPolicyAllows("microphone")) {
    // Not in a cross-origin frame, but policy still blocks the mic; a handoff
    // tab would be the same context, so it cannot help.
    return { mode: "unavailable", message: "Voice input is unavailable on this site. Please type your answer." };
  }

  return { mode: "inline" };
}

// Called after getUserMedia throws NotAllowedError / SecurityError on an inline
// attempt. A runtime refusal is definitive for this context, so we drop to
// fallback copy rather than re-offering a button that will fail again. A
// handoff tab cannot help here: the inline attempt only ran because the context
// was not the cross-origin case the handoff exists for.
function getVoiceCapabilityAfterRuntimeDenial(): VoiceCapability {
  const context = getBrowserContext();
  if (context.isIOS) {
    return {
      mode: "unavailable",
      message: "Voice input is not available in this browser. Please type your answer.",
    };
  }
  return {
    mode: "unavailable",
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

// The widget is served at /widget-public/<firmId> or /widget/<firmId>; the
// handoff recorder needs that firmId to theme itself and to scope the result.
function getEmbeddedFirmId(): string | null {
  const m = window.location.pathname.match(/\/widget(?:-public)?\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
