"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { OPENING_MESSAGE, parseSectionTag } from "@/lib/firm-voice-builder/system-prompt";
import ProgressRail from "./ProgressRail";
import ProfileReveal from "./ProfileReveal";

export interface ChatMessage {
  role: "interviewer" | "lawyer";
  /** What renders in the chat bubble: section tag and profile block stripped. */
  displayText: string;
  /** The exact text to resend as this transcript entry on the next call. */
  raw: string;
  /** Only meaningful for interviewer messages. */
  section: number | null;
}

interface SavedSession {
  messages: ChatMessage[];
  profile: string | null;
}

const STORAGE_KEY = "fvb-transcript-v1";

function openingChatMessage(): ChatMessage {
  const { section, text } = parseSectionTag(OPENING_MESSAGE);
  return { role: "interviewer", displayText: text, raw: OPENING_MESSAGE, section };
}

function loadSavedSession(): SavedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session: SavedSession) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage can fail (private browsing, quota). Resume is a convenience,
    // not a requirement; the interview keeps working without it.
  }
}

function clearSavedSession() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See saveSession.
  }
}

type Phase = "loading" | "intro" | "resume-prompt" | "chat";

export default function FirmVoiceBuilder() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profile, setProfile] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const savedSessionRef = useRef<SavedSession | null>(null);

  useEffect(() => {
    const saved = loadSavedSession();
    if (saved) {
      savedSessionRef.current = saved;
      setPhase("resume-prompt");
    } else {
      setPhase("intro");
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  function currentSection(): number | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "interviewer" && messages[i].section !== null) return messages[i].section;
    }
    return null;
  }

  function startFresh() {
    const first = openingChatMessage();
    setMessages([first]);
    setProfile(null);
    setError(null);
    savedSessionRef.current = null;
    clearSavedSession();
    saveSession({ messages: [first], profile: null });
    setPhase("chat");
  }

  function resumeSaved() {
    const saved = savedSessionRef.current;
    if (!saved) {
      startFresh();
      return;
    }
    setMessages(saved.messages);
    setProfile(saved.profile);
    setPhase("chat");
  }

  async function sendTurn(nextMessages: ChatMessage[]) {
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/tools/firm-voice-builder/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: nextMessages.map((m) => ({ role: m.role, text: m.raw })),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        setError(json.error ?? "Something went wrong. Please try again.");
        return;
      }
      const reply: ChatMessage = {
        role: "interviewer",
        displayText: json.message,
        raw: json.raw,
        section: json.section,
      };
      const updated = [...nextMessages, reply];
      setMessages(updated);
      const nextProfile: string | null = json.profile ?? profile;
      if (json.profile) setProfile(json.profile);
      saveSession({ messages: updated, profile: nextProfile });
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    const lawyerMessage: ChatMessage = { role: "lawyer", displayText: text, raw: text, section: null };
    const nextMessages = [...messages, lawyerMessage];
    setMessages(nextMessages);
    setInput("");
    await sendTurn(nextMessages);
  }

  function handleRetry() {
    void sendTurn(messages);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  if (phase === "loading") return null;

  if (phase === "resume-prompt") {
    return (
      <div className="card p-6 max-w-xl mx-auto text-center">
        <p className="label mb-2">Welcome back</p>
        <h2 className="text-lg font-display font-semibold text-navy mb-3">Pick up where you left off?</h2>
        <p className="text-sm text-body mb-5">
          You have an interview in progress in this browser. Nothing was ever sent to our servers between
          visits; this is stored on your device only.
        </p>
        <div className="flex gap-2 justify-center">
          <button type="button" className="btn-gold" onClick={resumeSaved}>
            Resume
          </button>
          <button type="button" className="btn-ghost" onClick={startFresh}>
            Start over
          </button>
        </div>
      </div>
    );
  }

  if (phase === "intro") {
    return (
      <div className="card p-6 max-w-xl mx-auto">
        <p className="label mb-2">Free tool, about 25 minutes</p>
        <h1 className="text-2xl font-display font-semibold text-navy mb-3">The Firm Voice Builder</h1>
        <p className="text-sm text-body leading-relaxed mb-3">
          Ask an AI to draft a client email and what comes back is stiff and generic. This tool interviews
          you, studies how you actually write and speak, and builds a Firm Voice Profile you paste into any
          AI so its drafts finally sound like you wrote them.
        </p>
        <p className="text-sm text-body leading-relaxed mb-3">
          It works entirely through conversation, about 25 questions, 25 minutes. There is nothing to paste
          and nothing to upload; every answer you type back is itself a writing sample.
        </p>
        <p className="text-sm text-body leading-relaxed mb-3">
          Nothing you type here is stored on our servers; the conversation lives in your browser for this
          session only. Describe situations in general terms rather than naming real clients; the tool does
          not need a real name to learn how you write.
        </p>
        <p className="text-sm text-body leading-relaxed mb-3">
          The finished profile also carries two things quietly built in: the Law Society&apos;s advertising
          rules, and a blocklist for the vocabulary that makes AI writing sound like AI writing.
        </p>
        <button type="button" className="btn-gold mt-2" onClick={startFresh}>
          Start the interview
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-4 sticky top-0 bg-parchment/95 backdrop-blur py-2 z-10">
        <ProgressRail currentSection={currentSection()} complete={profile !== null} />
      </div>

      <div className="flex flex-col gap-3 pb-4">
        {messages.map((m, i) => (
          <div key={i}>
            <div
              className={[
                "px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap max-w-[85%]",
                m.role === "interviewer" ? "bg-white border border-border-brand text-navy" : "bg-navy text-white ml-auto",
              ].join(" ")}
            >
              {m.displayText}
            </div>
            {profile && i === messages.length - 1 && m.role === "interviewer" && (
              <ProfileReveal profile={profile} messages={messages} />
            )}
          </div>
        ))}
        {sending && (
          <div className="px-4 py-3 text-sm text-muted border border-border-brand bg-white max-w-[85%]">
            Thinking...
          </div>
        )}
        {error && (
          <div className="px-4 py-3 text-sm bg-red-fail/10 border border-red-fail text-red-fail max-w-[85%]">
            {error}{" "}
            <button type="button" className="underline font-semibold" onClick={handleRetry}>
              Try again
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sticky bottom-0 bg-parchment/95 backdrop-blur py-3">
        <textarea
          className="input min-h-[96px] resize-y"
          placeholder="Type your answer. Write it out the way you actually would."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button type="submit" className="btn-gold self-start" disabled={sending || !input.trim()}>
          {sending ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
}
