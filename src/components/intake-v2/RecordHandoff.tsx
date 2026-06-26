"use client";

/**
 * RecordHandoff - the top-level first-party voice recorder reached from the
 * embedded widget on iOS.
 *
 * Because this page is top-level on app.caseloadselect.ca (not a cross-origin
 * iframe), WebKit allows getUserMedia, so iPhone/iPad users can record here
 * even though the embedded widget cannot. On success it sends the transcript
 * back to the widget via the same-origin handoff transport and invites the
 * user to return to the firm's form.
 */

import { useEffect, useRef, useState } from "react";
import { pickMimeType, transcribeRecording } from "./voice-capture";
import { publishHandoffResult, HANDOFF_MESSAGE_TYPE } from "./voice-handoff";

interface Props {
  firmId: string;
  session: string;
  firmName: string;
}

const MAX_RECORDING_MS = 60_000;

type State = "idle" | "requesting" | "recording" | "uploading" | "done" | "error";

export function RecordHandoff({ firmId, session, firmName }: Props) {
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (state !== "idle" && state !== "error" && state !== "done") return;
    setError(null);
    setTranscript("");
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
      setState("error");
      releaseStream();
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        `Microphone access was not granted (${msg}). Allow the microphone for this page, then try again, or return to the form and type your answer.`,
      );
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
      setState("error");
      setError("No audio was captured. Try again.");
      return;
    }

    const result = await transcribeRecording(blob);
    if (!result.ok) {
      setState("error");
      setError(result.error);
      return;
    }

    setTranscript(result.text);
    publishHandoffResult({
      type: HANDOFF_MESSAGE_TYPE,
      firmId,
      session,
      transcript: result.text,
    });
    setState("done");

    // iOS Safari often refuses programmatic close for a tab the user can see;
    // the on-screen instruction below is the reliable path. We still try.
    setTimeout(() => {
      try {
        window.close();
      } catch {
        // ignore
      }
    }, 1500);
  }

  const fontDisplay = "var(--cls-font-display, Manrope, sans-serif)";
  const fontBody = "var(--cls-font-body, DM Sans, sans-serif)";
  const accent = "var(--cls-accent, #1E2F58)";
  const accentText = "var(--cls-accent-text, #FFFFFF)";
  const textColor = "var(--cls-text, #1E2F58)";

  const isRecording = state === "recording";
  const isBusy = state === "requesting" || state === "uploading";

  return (
    <main
      className="min-h-screen flex items-center justify-center px-6 py-12 bg-[var(--cls-bg,#F4F3EF)]"
      style={{ fontFamily: fontBody }}
    >
      <div className="w-full max-w-md flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p
            className="text-[12px] uppercase tracking-[0.16em] font-medium"
            style={{ color: `color-mix(in srgb, ${textColor} 55%, transparent)` }}
          >
            {firmName}
          </p>
          <h1
            className="text-[24px] leading-tight font-extrabold"
            style={{ fontFamily: fontDisplay, color: textColor }}
          >
            Record your answer
          </h1>
          <p
            className="text-[15px] leading-relaxed"
            style={{ color: `color-mix(in srgb, ${textColor} 65%, transparent)` }}
          >
            Describe your situation out loud. When you finish, the words go back
            to the form you came from. You can then return to that tab.
          </p>
        </header>

        {state === "done" ? (
          <div className="flex flex-col gap-4">
            <div
              className="rounded-xl px-5 py-4 text-[15px] leading-relaxed"
              style={{
                background: "var(--cls-surface, #FFFFFF)",
                border: `1px solid color-mix(in srgb, ${accent} 15%, transparent)`,
                color: textColor,
              }}
            >
              {transcript}
            </div>
            <p className="text-[14px] leading-relaxed" style={{ color: textColor }}>
              Sent to your form. You can close this tab and return to {firmName}.
              What you said is already in the answer box there.
            </p>
            <button
              type="button"
              onClick={start}
              className="self-start h-11 px-5 rounded-full text-[14px] font-medium border"
              style={{
                borderColor: `color-mix(in srgb, ${accent} 25%, transparent)`,
                color: textColor,
                background: "var(--cls-surface, #FFFFFF)",
              }}
            >
              Record again
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={isRecording ? stop : start}
              disabled={isBusy}
              aria-label={isRecording ? "Stop recording" : "Start recording"}
              className="inline-flex items-center justify-center gap-2 h-14 px-6 rounded-full text-[16px] font-semibold transition-all"
              style={
                isRecording
                  ? { background: "#FEE2E2", border: "1px solid #FCA5A5", color: "#B91C1C" }
                  : { background: accent, color: accentText, opacity: isBusy ? 0.6 : 1 }
              }
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10a7 7 0 0 1-14 0" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              <span>
                {state === "requesting"
                  ? "Allow mic..."
                  : state === "uploading"
                    ? "Transcribing..."
                    : isRecording
                      ? `Recording... ${elapsed}s`
                      : "Tap to record"}
              </span>
              {isRecording && <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse ml-1" />}
            </button>

            {error && (
              <p className="text-[13px] leading-relaxed text-red-600">{error}</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
