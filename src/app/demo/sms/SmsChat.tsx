"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ── iOS Messages colours ──────────────────────────────────────────────────
const BLUE      = "#007AFF";   // iMessage blue (outgoing)
const GRAY_BG   = "#E9E9EB";   // incoming bubble
const SMS_GREEN = "#34C759";   // SMS green accent
const HEADER_BG = "#F6F6F6";   // translucent header

// ── Types ─────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "in" | "out";
  text: string;
  time: string;
  options?: string[];   // numbered quick-reply options
}

interface ScreenResponse {
  session_id: string;
  response_text: string;
  next_question: {
    id: string;
    text: string;
    options: Array<{ label: string; value: string }>;
    allow_free_text: boolean;
  } | null;
  collect_identity: boolean;
  finalize: boolean;
  cpi?: { band: string; total: number };
  cta?: string | null;
}

function now() {
  return new Date().toLocaleTimeString("en-CA", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).replace(/^0/, "");
}
function uid() { return Math.random().toString(36).slice(2); }

// ── Component ─────────────────────────────────────────────────────────────
export default function SmsChat({ firmId }: { firmId: string }) {
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState("");
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [phase, setPhase]           = useState<"chat" | "identity" | "done">("chat");
  const [contact, setContact]       = useState({ name: "", email: "" });
  const [band, setBand]             = useState<string | null>(null);
  const [cta, setCta]               = useState<string | null>(null);
  const [msgCount, setMsgCount]     = useState({ inbound: 0, outbound: 0 });
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const started    = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  // ── Helpers ─────────────────────────────────────────────────────────────
  const addIn = useCallback((text: string, options?: string[]) => {
    setMessages(prev => [...prev, { id: uid(), role: "in", text, time: now(), options }]);
    setMsgCount(c => ({ ...c, outbound: c.outbound + 1 }));
  }, []);

  const addOut = useCallback((text: string) => {
    setMessages(prev => [...prev, { id: uid(), role: "out", text, time: now() }]);
    setMsgCount(c => ({ ...c, inbound: c.inbound + 1 }));
  }, []);

  // ── API call ────────────────────────────────────────────────────────────
  const callScreen = useCallback(async (
    message: string,
    sid: string | null,
    messageType: "text" | "contact" = "text",
    structuredData?: Record<string, unknown>,
  ): Promise<ScreenResponse> => {
    const res = await fetch("/api/screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firm_id: firmId,
        session_id: sid,
        channel: "chat",   // "chat" mode = one question at a time, plain text
        message,
        message_type: messageType,
        ...(structuredData ? { structured_data: structuredData } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `Error ${res.status}`);
    }
    const data = await res.json() as ScreenResponse & { error?: string };
    if (data.error) throw new Error(data.error);
    return data;
  }, [firmId]);

  // ── Process GPT response into bubbles ───────────────────────────────────
  const handleResponse = useCallback((data: ScreenResponse) => {
    if (data.session_id) setSessionId(data.session_id);

    // Build the AI message: response_text + question (if any)
    let text = data.response_text || "";
    let options: string[] | undefined;

    if (data.next_question) {
      const q = data.next_question;
      if (q.options?.length > 0) {
        const numbered = q.options.map((o, i) => `${i + 1}=${o.label}`).join("  ");
        // If the question text isn't already part of response_text, append it
        if (!text.includes(q.text)) {
          text += text ? `\n\n${q.text}\n${numbered}` : `${q.text}\n${numbered}`;
        } else {
          text += `\n${numbered}`;
        }
        options = q.options.map(o => o.label);
      } else if (!text.includes(q.text)) {
        text += text ? `\n\n${q.text}` : q.text;
      }
    }

    if (text) {
      addIn(text, options);
    } else if (!data.collect_identity && !data.finalize) {
      addIn("Got it — one moment while I review your details.");
    }

    // Identity collection
    if (data.collect_identity) {
      setTimeout(() => {
        addIn("To connect you with a lawyer, reply with your full name and email address.");
        setPhase("identity");
      }, 500);
      return;
    }

    // Finalization
    if (data.finalize) {
      setBand(data.cpi?.band ?? null);
      setCta(data.cta ?? null);
      if (data.cta) {
        setTimeout(() => addIn(data.cta!), 400);
      }
      setTimeout(() => {
        addIn("Reply STOP to opt out of messages.");
        setPhase("done");
      }, 800);
    }
  }, [addIn]);

  // ── Greeting on mount ───────────────────────────────────────────────────
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setTimeout(() => {
      addIn(
        "Hi, this is Hartwell Law. We received your inquiry. " +
        "Describe your situation in a few sentences and our system will assess your case immediately."
      );
    }, 600);
  }, [addIn]);

  // ── Send a message ──────────────────────────────────────────────────────
  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    addOut(msg);
    setLoading(true);
    try {
      const data = await callScreen(msg, sessionId);
      handleResponse(data);
    } catch {
      addIn("Sorry, something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Tap a numbered option ───────────────────────────────────────────────
  function tapOption(label: string) {
    send(label);
  }

  // ── Submit identity ─────────────────────────────────────────────────────
  async function submitIdentity(e: React.FormEvent) {
    e.preventDefault();
    setPhase("chat");
    const msg = `${contact.name}, ${contact.email}`;
    addOut(msg);
    setLoading(true);
    try {
      const data = await callScreen(msg, sessionId, "contact", {
        first_name: contact.name.split(" ")[0],
        last_name: contact.name.split(" ").slice(1).join(" "),
        email: contact.email,
      });
      handleResponse(data);
    } catch {
      addIn("Sorry, something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const bandColor: Record<string, string> = {
    A: "#34C759", B: "#007AFF", C: "#FF9500", D: "#8E8E93", E: "#FF3B30",
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-8"
      style={{ backgroundColor: "#1A1A2E" }}>

      {/* ── iPhone frame ──────────────────────────────────────────────── */}
      <div className="w-full max-w-sm rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col"
        style={{ border: "6px solid #1C1C1E", backgroundColor: "#000", maxHeight: "90vh" }}>

        {/* Status bar */}
        <div className="flex items-center justify-between px-7 pt-3 pb-1 shrink-0"
          style={{ backgroundColor: HEADER_BG }}>
          <span className="text-black text-xs font-semibold">9:41</span>
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-black" fill="currentColor" viewBox="0 0 24 24">
              <rect x="1" y="5" width="3" height="14" rx="1"/><rect x="6" y="8" width="3" height="11" rx="1"/>
              <rect x="11" y="3" width="3" height="16" rx="1"/><rect x="16" y="1" width="3" height="18" rx="1"/>
            </svg>
            <svg className="w-5 h-3 text-black" viewBox="0 0 24 12" fill="none">
              <rect x="0.5" y="0.5" width="20" height="11" rx="2.5" stroke="black" strokeOpacity="0.35"/>
              <rect x="1.5" y="1.5" width="15" height="9" rx="1.5" fill="black"/>
              <path d="M22 4v4a2 2 0 000-4z" fill="black" fillOpacity="0.4"/>
            </svg>
          </div>
        </div>

        {/* Messages header */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-gray-200"
          style={{ backgroundColor: HEADER_BG }}>
          <a href="/demo" className="text-blue-500 text-sm flex items-center gap-0.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7"/>
            </svg>
          </a>
          <div className="flex-1 text-center">
            <div className="w-8 h-8 rounded-full mx-auto mb-0.5 flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: "#8E8E93" }}>
              H
            </div>
            <div className="text-xs font-semibold text-black leading-tight">Hartwell Law PC</div>
            <div className="text-[10px] text-gray-400 leading-tight">SMS</div>
          </div>
          <div className="w-6" /> {/* Spacer to center */}
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2"
          style={{ backgroundColor: "#FFFFFF", minHeight: 0 }}>

          {/* Message counter (demo overlay) */}
          <div className="flex justify-center mb-2">
            <span className="text-[10px] px-3 py-1 rounded-full bg-gray-100 text-gray-400 font-mono">
              {msgCount.outbound} outbound + {msgCount.inbound} inbound = {msgCount.outbound + msgCount.inbound} messages
            </span>
          </div>

          {/* Messages */}
          {messages.map((msg) => (
            <div key={msg.id}>
              <div className={`flex ${msg.role === "out" ? "justify-end" : "justify-start"} mb-0.5`}>
                <div
                  className="max-w-[80%] px-3.5 py-2 text-[14px] leading-relaxed"
                  style={{
                    backgroundColor: msg.role === "out" ? BLUE : GRAY_BG,
                    color: msg.role === "out" ? "#FFFFFF" : "#000000",
                    borderRadius: msg.role === "out"
                      ? "18px 18px 4px 18px"
                      : "18px 18px 18px 4px",
                  }}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
              {/* Timestamp */}
              <div className={`flex ${msg.role === "out" ? "justify-end" : "justify-start"} mb-1`}>
                <span className="text-[10px] text-gray-400 px-2">
                  {msg.time}
                  {msg.role === "out" && " — Delivered"}
                </span>
              </div>
              {/* Quick-reply pills (numbered options) */}
              {msg.role === "in" && msg.options && (
                <div className="flex flex-wrap gap-1.5 mb-2 pl-1">
                  {msg.options.map((opt, i) => (
                    <button key={opt}
                      onClick={() => tapOption(opt)}
                      disabled={loading}
                      className="px-3 py-1 rounded-full text-xs font-medium border transition hover:bg-blue-50 active:bg-blue-100 disabled:opacity-50"
                      style={{ borderColor: BLUE, color: BLUE }}>
                      {i + 1}. {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Typing dots */}
          {loading && (
            <div className="flex justify-start mb-1">
              <div className="px-4 py-3" style={{
                backgroundColor: GRAY_BG,
                borderRadius: "18px 18px 18px 4px",
              }}>
                <div className="flex gap-1 items-center">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Identity form (inline card) */}
          {phase === "identity" && (
            <div className="my-2">
              <form onSubmit={submitIdentity}
                className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2 text-xs font-semibold text-white" style={{ backgroundColor: BLUE }}>
                  Your Contact Info
                </div>
                <div className="p-4 space-y-3">
                  <input required placeholder="Full name"
                    value={contact.name}
                    onChange={e => setContact(c => ({ ...c, name: e.target.value }))}
                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  <input required type="email" placeholder="Email address"
                    value={contact.email}
                    onChange={e => setContact(c => ({ ...c, email: e.target.value }))}
                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  <button type="submit" disabled={loading}
                    className="w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                    style={{ backgroundColor: BLUE }}>
                    Send
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Done card */}
          {phase === "done" && band && (
            <div className="my-3 flex justify-center">
              <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden w-full max-w-[85%]">
                <div className="px-4 py-3 text-white text-sm font-semibold text-center"
                  style={{ backgroundColor: BLUE }}>
                  Case Assessment Complete
                </div>
                <div className="p-4 text-center">
                  <div className="text-3xl font-black mb-1" style={{ color: bandColor[band] ?? "#8E8E93" }}>
                    Band {band}
                  </div>
                  <div className="text-[10px] font-mono text-gray-400 mb-3">
                    {msgCount.outbound} outbound + {msgCount.inbound} inbound = {msgCount.outbound + msgCount.inbound} messages total
                  </div>
                  <p className="text-xs text-gray-500 mb-4 leading-relaxed">{cta}</p>
                  <div className="flex flex-col gap-2">
                    {sessionId && (
                      <a href={`/demo/result?session=${sessionId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-4 py-2.5 rounded-xl text-white text-xs font-semibold text-center"
                        style={{ backgroundColor: bandColor[band] ?? BLUE }}>
                        View your case record →
                      </a>
                    )}
                    <a href="/demo"
                      className="block px-4 py-2 rounded-xl text-xs font-semibold text-center border"
                      style={{ borderColor: BLUE, color: BLUE }}>
                      Back to Demo
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar — iOS Messages style */}
        {phase === "chat" && (
          <div className="shrink-0 flex items-end gap-2 px-3 py-2 border-t border-gray-200 bg-white">
            {/* Camera icon (cosmetic) */}
            <button className="text-gray-300 hover:text-gray-400 p-1 mb-0.5">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                <circle cx="12" cy="13" r="3"/>
              </svg>
            </button>
            {/* Input */}
            <div className="flex-1 flex items-end border border-gray-300 rounded-full px-3 py-1.5 bg-white">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                placeholder="Text Message"
                disabled={loading}
                className="flex-1 text-sm focus:outline-none bg-transparent"
              />
            </div>
            {/* Send / mic */}
            {input.trim() ? (
              <button onClick={() => send()}
                disabled={loading}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 mb-0.5 transition hover:opacity-80 disabled:opacity-50"
                style={{ backgroundColor: BLUE }}>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              </button>
            ) : (
              <button className="text-gray-300 p-1 mb-0.5">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Caption */}
      <div className="hidden sm:block absolute bottom-6 left-0 right-0 text-center">
        <p className="text-white/30 text-xs">
          SMS intake simulation (Option C: Hybrid AI + Structured) — powered by CaseLoad Select
        </p>
      </div>
    </div>
  );
}
