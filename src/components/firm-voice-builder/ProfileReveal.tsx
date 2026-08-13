"use client";

import { useState } from "react";
import type { ChatMessage } from "./FirmVoiceBuilder";

function buildTranscriptMarkdown(messages: ChatMessage[]): string {
  const lines = ["# Firm Voice Builder, interview transcript", ""];
  for (const m of messages) {
    lines.push(m.role === "interviewer" ? "**Firm Voice Builder:**" : "**You:**");
    lines.push(m.displayText);
    lines.push("");
  }
  return lines.join("\n");
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ProfileReveal({ profile, messages }: { profile: string; messages: ChatMessage[] }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(profile);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard permission can fail; the profile text is already
      // selectable in the block below as a fallback.
    }
  }

  function handleDownloadTranscript() {
    downloadTextFile("firm-voice-builder-transcript.md", buildTranscriptMarkdown(messages));
  }

  return (
    <div className="card my-4 p-5">
      <p className="label mb-1">Your Firm Voice Profile is ready</p>
      <p className="text-sm text-body mb-4">
        Copy the profile below and paste it at the top of any AI chat. Keep the transcript too:
        the quarterly re-run works better when the tool can see how your answers evolved.
      </p>
      <div className="flex gap-2 mb-4">
        <button type="button" onClick={handleCopy} className="btn-gold text-sm">
          {copied ? "Copied" : "Copy profile"}
        </button>
        <button type="button" onClick={handleDownloadTranscript} className="btn-ghost text-sm">
          Download transcript
        </button>
      </div>
      <pre className="bg-deep-black text-white text-xs leading-relaxed p-4 overflow-auto max-h-[480px] whitespace-pre-wrap">
        {profile}
      </pre>
    </div>
  );
}
