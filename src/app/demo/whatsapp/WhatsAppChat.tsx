"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ── WhatsApp brand colours ────────────────────────────────────────────────
const WA_DARK   = "#075E54";   // header, send button
const WA_MID    = "#128C7E";   // online indicator, accents
const WA_LIGHT  = "#25D366";   // quick-reply chips, checkmarks
const WA_BG     = "#ECE5DD";   // chat wallpaper
const WA_IN     = "#FFFFFF";   // incoming bubble
const WA_OUT    = "#DCF8C6";   // outgoing bubble

// ── Types ─────────────────────────────────────────────────────────────────
interface QuickReply {
  label: string;
  value: string;
}

interface Message {
  id: string;
  role: "in" | "out";
  text: string;
  time: string;
  quickReplies?: QuickReply[];
  delivered?: boolean;
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
  next_questions: null;
  collect_identity: boolean;
  finalize: boolean;
  cpi?: { band: string; total: number };
  cta?: string;
  situation_summary?: string;
}

interface ContactForm {
  name: string;
  email: string;
  phone: string;
}

function now() {
  return new Date().toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function uid() {
  return Math.random().toString(36).slice(2);
}

// ── Component ─────────────────────────────────────────────────────────────
export default function WhatsAppChat({ firmId }: { firmId: string }) {
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState("");
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [phase, setPhase]           = useState<"chat" | "identity" | "done">("chat");
  const [contact, setContact]       = useState<ContactForm>({ name: "", email: "", phone: "" });
  const [band, setBand]             = useState<string | null>(null);
  const [cta, setCta]               = useState<string | null>(null);
  const [repliedIds, setRepliedIds] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const started   = useRef(false);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  // Append an incoming bubble
  const addIn = useCallback((text: string, quickReplies?: QuickReply[]) => {
    setMessages(prev => [...prev, {
      id: uid(), role: "in", text, time: now(), quickReplies, delivered: false,
    }]);
  }, []);

  // Append an outgoing bubble
  const addOut = useCallback((text: string) => {
    setMessages(prev => [...prev, {
      id: uid(), role: "out", text, time: now(), delivered: true,
    }]);
  }, []);

  // Call /api/screen
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
        channel: "whatsapp",
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

  // Process a GPT response and push the right bubbles
  const handleResponse = useCallback((data: ScreenResponse) => {
    if (data.session_id) setSessionId(data.session_id);

    const responseText = data.response_text?.trim();

    if (responseText) {
      const quickReplies = data.next_question?.options?.map(o => ({
        label: o.label,
        value: o.label,
      }));
      addIn(responseText, quickReplies);
    } else if (!data.collect_identity && !data.finalize) {
      // Fallback: GPT returned no text — ask the question directly
      if (data.next_question) {
        const quickReplies = data.next_question.options?.map(o => ({
          label: o.label,
          value: o.label,
        }));
        addIn(data.next_question.text, quickReplies);
      } else {
        addIn("Thank you. Let me gather a few more details.");
      }
    }

    if (data.collect_identity) {
      setTimeout(() => {
        addIn("To connect you with one of our lawyers, I just need a few details:");
        setPhase("identity");
      }, 600);
      return;
    }

    if (data.finalize) {
      setBand(data.cpi?.band ?? null);
      setCta(data.cta ?? null);
      setTimeout(() => {
        addIn(data.cta ?? "Your intake is complete. A member of our team will be in touch shortly.");
        setPhase("done");
      }, 400);
    }
  }, [addIn]);

  // Initial greeting on mount
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    setTimeout(() => {
      addIn("Hi! 👋 I'm the Hartwell Law intake assistant.");
    }, 400);
    setTimeout(() => {
      addIn("Please describe your legal situation in a few sentences and I'll help assess your case. Everything you share is confidential.");
    }, 1000);
  }, [addIn]);

  // Send a text message
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

  // Tap a quick-reply chip
  function tapReply(msgId: string, label: string) {
    if (repliedIds.has(msgId)) return;
    setRepliedIds(prev => new Set(prev).add(msgId));
    send(label);
  }

  // Submit identity form
  async function submitIdentity(e: React.FormEvent) {
    e.preventDefault();
    setPhase("chat");
    const msg = `My name is ${contact.name}, email is ${contact.email}${contact.phone ? `, phone is ${contact.phone}` : ""}.`;
    addOut(msg);
    setLoading(true);
    try {
      const data = await callScreen(msg, sessionId, "contact", {
        first_name: contact.name.split(" ")[0],
        last_name: contact.name.split(" ").slice(1).join(" "),
        email: contact.email,
        phone: contact.phone,
      });
      handleResponse(data);
    } catch {
      addIn("Sorry, something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const bandColor: Record<string, string> = {
    A: "#16a34a", B: "#2563eb", C: "#d97706", D: "#6b7280", E: "#dc2626",
  };

  return (
    // ── Outer page — WhatsApp chat background ──────────────────────────────
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-8"
      style={{ backgroundColor: "#1A1A2E" }}>

      {/* ── Phone frame ─────────────────────────────────────────────────── */}
      <div className="w-full max-w-sm bg-black rounded-[2.5rem] shadow-2xl overflow-hidden"
        style={{ border: "6px solid #111", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>

        {/* Phone status bar */}
        <div className="bg-black flex items-center justify-between px-6 pt-3 pb-1 shrink-0">
          <span className="text-white text-xs font-semibold">9:41</span>
          <div className="flex items-center gap-1">
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="1" y="5" width="3" height="14" rx="1"/><rect x="6" y="8" width="3" height="11" rx="1"/>
              <rect x="11" y="3" width="3" height="16" rx="1"/><rect x="16" y="1" width="3" height="18" rx="1"/>
            </svg>
            <svg className="w-3 h-3 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 5a10.94 10.94 0 00-2.61 8.46M10.5 7.13a5 5 0 015.5 5.87M6.67 9.68A5 5 0 0012 17"/>
            </svg>
            <svg className="w-5 h-3 text-white ml-1" viewBox="0 0 24 12" fill="none">
              <rect x="0.5" y="0.5" width="20" height="11" rx="2.5" stroke="white" strokeOpacity="0.4"/>
              <rect x="1.5" y="1.5" width="16" height="9" rx="1.5" fill="white"/>
              <path d="M22 4v4a2 2 0 000-4z" fill="white" fillOpacity="0.4"/>
            </svg>
          </div>
        </div>

        {/* WhatsApp header */}
        <div className="shrink-0 flex items-center gap-3 px-3 py-2" style={{ backgroundColor: WA_DARK }}>
          <a href="/demo" className="text-white/80 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
          </a>
          {/* Avatar */}
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
            style={{ backgroundColor: WA_MID }}>
            H
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-semibold leading-tight">Hartwell Law PC</div>
            <div className="text-xs leading-tight" style={{ color: WA_LIGHT }}>online</div>
          </div>
          {/* Header icons */}
          <div className="flex items-center gap-4 text-white/80">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
            </svg>
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1"
          style={{ backgroundColor: WA_BG, minHeight: 0 }}>

          {/* Date pill */}
          <div className="flex justify-center mb-3">
            <span className="text-xs px-3 py-1 rounded-full bg-white/70 text-gray-500 shadow-sm">
              Today
            </span>
          </div>

          {/* Messages */}
          {messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.role === "out" ? "items-end" : "items-start"} mb-1`}>
              <div className="max-w-[80%] rounded-2xl px-3 py-2 shadow-sm text-[13px] leading-relaxed relative"
                style={{
                  backgroundColor: msg.role === "out" ? WA_OUT : WA_IN,
                  borderTopRightRadius: msg.role === "out" ? "4px" : undefined,
                  borderTopLeftRadius: msg.role === "in" ? "4px" : undefined,
                }}>
                <p className="text-gray-800 whitespace-pre-wrap">{msg.text}</p>
                <div className={`flex items-center gap-1 mt-0.5 ${msg.role === "out" ? "justify-end" : "justify-start"}`}>
                  <span className="text-[10px] text-gray-400">{msg.time}</span>
                  {msg.role === "out" && (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 11" fill="none">
                      <path d="M1 5.5L5 9.5L11 2.5" stroke={WA_MID} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M5 5.5L9 9.5L15 2.5" stroke={WA_MID} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </div>

              {/* Quick-reply chips */}
              {msg.role === "in" && msg.quickReplies && !repliedIds.has(msg.id) && (
                <div className="flex flex-wrap gap-1.5 mt-1.5 max-w-[85%]">
                  {msg.quickReplies.map((qr) => (
                    <button key={qr.value}
                      onClick={() => tapReply(msg.id, qr.label)}
                      className="px-3 py-1 rounded-full text-xs font-medium border transition hover:text-white"
                      style={{ borderColor: WA_MID, color: WA_MID, backgroundColor: "white" }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = WA_MID;
                        (e.currentTarget as HTMLElement).style.color = "white";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = "white";
                        (e.currentTarget as HTMLElement).style.color = WA_MID;
                      }}>
                      {qr.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="flex items-start">
              <div className="rounded-2xl rounded-tl px-4 py-3 shadow-sm" style={{ backgroundColor: WA_IN }}>
                <div className="flex gap-1 items-center">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
                      style={{ backgroundColor: WA_MID, animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Identity form */}
          {phase === "identity" && (
            <div className="my-2">
              <form onSubmit={submitIdentity}
                className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
                <div className="px-4 py-2 text-xs font-semibold text-white"
                  style={{ backgroundColor: WA_DARK }}>
                  Your Details
                </div>
                <div className="p-4 space-y-3">
                  <input required placeholder="Full name"
                    value={contact.name}
                    onChange={e => setContact(c => ({ ...c, name: e.target.value }))}
                    className="w-full border-b border-gray-200 pb-2 text-sm focus:outline-none focus:border-green-400 bg-transparent" />
                  <input required type="email" placeholder="Email address"
                    value={contact.email}
                    onChange={e => setContact(c => ({ ...c, email: e.target.value }))}
                    className="w-full border-b border-gray-200 pb-2 text-sm focus:outline-none focus:border-green-400 bg-transparent" />
                  <input placeholder="Phone (optional)"
                    value={contact.phone}
                    onChange={e => setContact(c => ({ ...c, phone: e.target.value }))}
                    className="w-full border-b border-gray-200 pb-2 text-sm focus:outline-none focus:border-green-400 bg-transparent" />
                  <button type="submit"
                    className="w-full py-2 rounded-xl text-white text-sm font-semibold"
                    style={{ backgroundColor: WA_DARK }}>
                    Submit
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Done card */}
          {phase === "done" && band && (
            <div className="my-3 flex justify-center">
              <div className="bg-white rounded-2xl shadow-md overflow-hidden w-full max-w-[85%] border border-gray-100">
                <div className="px-4 py-3 text-white text-sm font-semibold text-center"
                  style={{ backgroundColor: WA_DARK }}>
                  Case Assessment Complete
                </div>
                <div className="p-4 text-center">
                  <div className="text-3xl font-black mb-1" style={{ color: bandColor[band] ?? "#6b7280" }}>
                    Band {band}
                  </div>
                  <p className="text-xs text-gray-500 mb-4 leading-relaxed">{cta}</p>
                  <div className="flex flex-col gap-2">
                    {sessionId && (
                      <a href={`/demo/result?session=${sessionId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-4 py-2.5 rounded-xl text-white text-xs font-semibold text-center"
                        style={{ backgroundColor: bandColor[band] ?? WA_DARK }}>
                        View your case record →
                      </a>
                    )}
                    <a href="/demo"
                      className="block px-4 py-2 rounded-xl text-xs font-semibold text-center border"
                      style={{ borderColor: WA_DARK, color: WA_DARK }}>
                      Back to Demo
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        {phase === "chat" && (
          <div className="shrink-0 flex items-center gap-2 px-2 py-2 bg-[#F0F0F0]">
            {/* Emoji icon (cosmetic) */}
            <button className="text-gray-400 hover:text-gray-600 p-1">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </button>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
              placeholder="Message"
              disabled={loading}
              className="flex-1 rounded-full px-4 py-2 text-sm bg-white focus:outline-none shadow-sm"
            />
            {/* Mic / Send */}
            {input.trim() ? (
              <button onClick={() => send()}
                className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 transition hover:opacity-90"
                style={{ backgroundColor: WA_DARK }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
                </svg>
              </button>
            ) : (
              <button className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0"
                style={{ backgroundColor: WA_DARK }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Caption below phone */}
      <div className="hidden sm:block absolute bottom-6 left-0 right-0 text-center">
        <p className="text-white/30 text-xs">
          WhatsApp intake simulation — powered by CaseLoad Select
        </p>
      </div>
    </div>
  );
}
