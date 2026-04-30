"use client";

/**
 * ChatWidget  -  Chat UI for the CaseLoad Screen engine.
 *
 * Conversation flow:
 *   1. Bot greeting (static, no API call)
 *   2. User types situation  →  POST /api/screen (kickoff)
 *   3. Engine returns response_text + optional next_question with options
 *   4. Bot renders response + chip options (or free text)
 *   5. Continues until collect_identity=true or finalize=true
 *   6. Identity capture (inline form)
 *   7. OTP verification
 *   8. Done screen (band-appropriate CTA)
 */

import { useState, useRef, useEffect, useCallback } from "react";
import type { FirmBranding } from "./page";

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = "bot" | "user" | "system";

interface Message {
  id: string;
  role: Role;
  text: string;
  chips?: Array<{ label: string; value: string }>;
  /** System messages render as subtle dividers (e.g. "Reviewing your case...") */
  isThinking?: boolean;
}

interface ScreenResponse {
  session_id: string;
  response_text: string;
  next_question?: {
    id: string;
    text?: string;
    options?: Array<{ label: string; value: string }>;
    type?: string;
  } | null;
  next_questions?: Array<{
    id: string;
    text?: string;
    options?: Array<{ label: string; value: string }>;
    type?: string;
  }> | null;
  collect_identity: boolean;
  finalize: boolean;
  cpi?: { band?: string | null } & Record<string, unknown>;
  cta?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/** Extract all chip options from the first question that has options. */
function extractChips(
  res: ScreenResponse
): Array<{ label: string; value: string }> | undefined {
  const qs = res.next_questions ?? (res.next_question ? [res.next_question] : []);
  for (const q of qs) {
    if (q.options && q.options.length > 0) return q.options;
  }
  return undefined;
}

/** Derive band label for the done screen. */
function bandLabel(band: string | null | undefined): "priority" | "standard" | "review" {
  if (!band) return "review";
  if (["A", "B"].includes(band.toUpperCase())) return "priority";
  if (["C", "D"].includes(band.toUpperCase())) return "standard";
  return "review";
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="block w-1.5 h-1.5 rounded-full bg-black/30 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
        />
      ))}
    </div>
  );
}

function BotBubble({
  msg,
  primaryColor,
  onChipClick,
  chipsUsed,
}: {
  msg: Message;
  primaryColor: string;
  onChipClick: (label: string, value: string) => void;
  chipsUsed: boolean;
}) {
  if (msg.isThinking) {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-[11px] text-black/35 italic">{msg.text}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 items-start">
      <div
        className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-[13.5px] leading-relaxed"
        style={{ backgroundColor: "#F0F0F0", color: "#111" }}
      >
        {msg.text}
      </div>
      {msg.chips && !chipsUsed && (
        <div className="flex flex-wrap gap-1.5 max-w-[90%]">
          {msg.chips.map(chip => (
            <button
              key={chip.value}
              onClick={() => onChipClick(chip.label, chip.value)}
              className="px-3 py-1.5 rounded-full border text-[12px] font-medium transition-all active:scale-95"
              style={{
                borderColor: primaryColor + "60",
                color: primaryColor,
                backgroundColor: primaryColor + "0D",
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserBubble({ text, primaryColor }: { text: string; primaryColor: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-[13.5px] leading-relaxed text-white"
        style={{ backgroundColor: primaryColor }}
      >
        {text}
      </div>
    </div>
  );
}

// ─── Identity form ─────────────────────────────────────────────────────────────

interface IdentityFormProps {
  primaryColor: string;
  firmId: string;
  sessionId: string;
  firmName: string;
  onDone: (band: string | null, bookingUrl: string | null) => void;
  onError: (msg: string) => void;
}

function IdentityForm({ primaryColor, firmId, sessionId, firmName, onDone, onError }: IdentityFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);

  const inputBase =
    "w-full border border-black/15 rounded-xl px-3 py-2.5 text-[13px] placeholder-black/30 focus:outline-none focus:ring-2 transition";
  const focusRing = `focus:ring-[${primaryColor}]/30 focus:border-[${primaryColor}]`;

  async function handleSubmitIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setLoading(true);
    try {
      await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, email, firm_name: firmName }),
      });
      setOtpSent(true);
    } catch {
      onError("Could not send verification code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length !== 6) return;
    setOtpLoading(true);
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          code: otp,
          name,
          email,
          phone: phone.trim() || undefined,
          firm_id: firmId,
        }),
      });
      const data = await res.json() as { band?: string; booking_url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      onDone(data.band ?? null, data.booking_url ?? null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Verification failed. Please try again.");
    } finally {
      setOtpLoading(false);
    }
  }

  if (otpSent) {
    return (
      <form onSubmit={handleVerifyOtp} className="space-y-3 pt-1">
        <p className="text-[12.5px] text-black/50 leading-snug">
          We sent a 6-digit code to <strong className="text-black/70">{email}</strong>. Enter it below to confirm.
        </p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="000000"
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
          className={`${inputBase} text-center tracking-[0.4em] text-lg font-semibold`}
          autoFocus
        />
        <button
          type="submit"
          disabled={otp.length !== 6 || otpLoading}
          className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition disabled:opacity-40"
          style={{ backgroundColor: primaryColor }}
        >
          {otpLoading ? "Verifying..." : "Confirm"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmitIdentity} className="space-y-2.5 pt-1">
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={e => setName(e.target.value)}
        className={`${inputBase} ${focusRing}`}
        required
        autoFocus
      />
      <input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={e => setEmail(e.target.value)}
        className={`${inputBase} ${focusRing}`}
        required
      />
      <input
        type="tel"
        placeholder="Phone number (optional)"
        value={phone}
        onChange={e => setPhone(e.target.value)}
        className={`${inputBase} ${focusRing}`}
      />
      <button
        type="submit"
        disabled={!name.trim() || !email.trim() || loading}
        className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition disabled:opacity-40"
        style={{ backgroundColor: primaryColor }}
      >
        {loading ? "Sending code..." : "Continue"}
      </button>
    </form>
  );
}

// ─── Done screen ──────────────────────────────────────────────────────────────

function DoneScreen({
  tier,
  bookingUrl,
  primaryColor,
}: {
  tier: "priority" | "standard" | "review";
  bookingUrl: string | null;
  primaryColor: string;
}) {
  const copy = {
    priority: {
      heading: "We'll be in touch shortly.",
      body: "Your case has been reviewed and a member of our team will reach out within the hour.",
      cta: bookingUrl ? "Book a time now" : null,
    },
    standard: {
      heading: "Thank you for reaching out.",
      body: "We'll review your details and be in touch within 1 business day.",
      cta: bookingUrl ? "Schedule a consultation" : null,
    },
    review: {
      heading: "Thank you.",
      body: "We've received your information and will follow up if we can assist.",
      cta: null,
    },
  };

  const { heading, body, cta } = copy[tier];

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-6 px-4 text-center">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{ backgroundColor: primaryColor + "15" }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={primaryColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <div className="space-y-1.5">
        <p className="text-[15px] font-semibold text-black/80">{heading}</p>
        <p className="text-[12.5px] text-black/45 leading-relaxed max-w-[260px] mx-auto">{body}</p>
      </div>
      {cta && bookingUrl && (
        <a
          href={bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: primaryColor }}
        >
          {cta}
        </a>
      )}
    </div>
  );
}

// ─── Main widget ───────────────────────────────────────────────────────────────

export function ChatWidget({ config }: { config: FirmBranding }) {
  const { firmId, firmName, primaryColor, assistantName, bookingUrl, practiceAreas } = config;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"chat" | "identity" | "done">("chat");
  const [doneTier, setDoneTier] = useState<"priority" | "standard" | "review">("review");
  const [resolvedBookingUrl, setResolvedBookingUrl] = useState<string | null>(bookingUrl);
  // Track which message IDs have had their chips used
  const [usedChipIds, setUsedChipIds] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Greeting on mount
  useEffect(() => {
    const paChips =
      practiceAreas.length > 0
        ? practiceAreas.slice(0, 6).map(a => ({ label: a.label, value: a.label }))
        : undefined;

    const greetId = uid();
    setMessages([
      {
        id: greetId,
        role: "bot",
        text: `Hi there! To get started, tell us what you're dealing with — or choose a practice area below.`,
        chips: paChips,
      },
    ]);
  }, [practiceAreas]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  const addMessage = useCallback((msg: Omit<Message, "id">) => {
    setMessages(prev => [...prev, { ...msg, id: uid() }]);
  }, []);

  const callScreen = useCallback(
    async (userText: string) => {
      setLoading(true);

      // Show thinking indicator
      const thinkId = uid();
      setMessages(prev => [
        ...prev,
        { id: thinkId, role: "system", text: "Reviewing your case...", isThinking: true },
      ]);

      try {
        const body: Record<string, unknown> = {
          firm_id: firmId,
          channel: "widget",
          message: userText,
          message_type: "text",
        };
        if (sessionId) body.session_id = sessionId;

        const res = await fetch("/api/screen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await res.json() as ScreenResponse;

        // Remove thinking bubble
        setMessages(prev => prev.filter(m => m.id !== thinkId));

        if (data.session_id) setSessionId(data.session_id);

        if (data.finalize) {
          // Show final bot message then move to identity
          if (data.response_text) {
            addMessage({ role: "bot", text: data.response_text });
          }
          // Small delay so the message renders before the form appears
          setTimeout(() => setPhase("identity"), 400);
          return;
        }

        if (data.collect_identity) {
          if (data.response_text) {
            addMessage({ role: "bot", text: data.response_text });
          }
          setTimeout(() => setPhase("identity"), 400);
          return;
        }

        // Normal turn: show response_text + chips from next question
        const chips = extractChips(data);
        const msgId = uid();
        setMessages(prev => [
          ...prev,
          {
            id: msgId,
            role: "bot",
            text: data.response_text,
            chips,
          },
        ]);
      } catch {
        setMessages(prev => prev.filter(m => m.id !== thinkId));
        addMessage({ role: "bot", text: "Something went wrong. Please try again." });
      } finally {
        setLoading(false);
      }
    },
    [firmId, sessionId, addMessage]
  );

  const handleSend = useCallback(
    (text?: string) => {
      const value = (text ?? input).trim();
      if (!value || loading) return;
      addMessage({ role: "user", text: value });
      setInput("");
      callScreen(value);
    },
    [input, loading, addMessage, callScreen]
  );

  const handleChipClick = useCallback(
    (msgId: string, label: string) => {
      setUsedChipIds(prev => new Set(prev).add(msgId));
      addMessage({ role: "user", text: label });
      callScreen(label);
    },
    [addMessage, callScreen]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  // Initials avatar for header
  const initials = firmName
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className="flex flex-col h-screen max-h-screen bg-white"
      style={{ fontFamily: "DM Sans, system-ui, sans-serif" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3.5 flex-shrink-0"
        style={{ backgroundColor: primaryColor }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
          style={{ backgroundColor: "rgba(255,255,255,0.2)", color: "#fff" }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-[13.5px] font-semibold leading-tight truncate">{firmName}</p>
          <p className="text-white/65 text-[11px] leading-tight mt-0.5">{assistantName} · Accepting consultations</p>
        </div>
        <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" title="Online" />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        {messages.map(msg =>
          msg.role === "user" ? (
            <UserBubble key={msg.id} text={msg.text} primaryColor={primaryColor} />
          ) : (
            <BotBubble
              key={msg.id}
              msg={msg}
              primaryColor={primaryColor}
              onChipClick={(label) => handleChipClick(msg.id, label)}
              chipsUsed={usedChipIds.has(msg.id)}
            />
          )
        )}

        {/* Identity form */}
        {phase === "identity" && sessionId && (
          <div className="bg-[#F7F7F7] rounded-2xl rounded-tl-sm p-4 space-y-3 max-w-[90%]">
            <p className="text-[13px] text-black/65 font-medium">
              Before we continue, how should we reach you?
            </p>
            <IdentityForm
              primaryColor={primaryColor}
              firmId={firmId}
              sessionId={sessionId}
              firmName={firmName}
              onDone={(band, url) => {
                setDoneTier(bandLabel(band));
                if (url) setResolvedBookingUrl(url);
                setPhase("done");
              }}
              onError={msg => addMessage({ role: "bot", text: msg })}
            />
          </div>
        )}

        {/* Done */}
        {phase === "done" && (
          <DoneScreen
            tier={doneTier}
            bookingUrl={resolvedBookingUrl}
            primaryColor={primaryColor}
          />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      {phase === "chat" && (
        <div className="flex-shrink-0 px-3 pb-4 pt-2 border-t border-black/[0.06]">
          <div className="flex items-end gap-2 bg-[#F5F5F5] rounded-2xl px-3 py-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Describe your situation..."
              rows={1}
              disabled={loading}
              className="flex-1 bg-transparent resize-none text-[13px] text-black/80 placeholder-black/30 focus:outline-none leading-relaxed min-h-[22px] max-h-[120px] disabled:opacity-50"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition disabled:opacity-30"
              style={{ backgroundColor: primaryColor }}
              aria-label="Send"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
