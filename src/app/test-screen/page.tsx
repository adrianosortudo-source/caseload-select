"use client";

/**
 * /test-screen — CaseLoad Screen Engine test harness
 *
 * Lets you fire messages at /api/screen and see:
 *   - GPT's response text
 *   - Practice area detected
 *   - Next question to ask
 *   - Live CPI breakdown (fit + value + total + band)
 *   - Extracted entities
 *   - Session state (finalize, collect_identity)
 *
 * This page is for dev testing only. Not deployed to production.
 */

import { useState, useRef, useEffect } from "react";

const SAKURABA_FIRM_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

interface CpiBreakdown {
  fit_score: number;
  geo_score: number;
  practice_score: number;
  legitimacy_score: number;
  referral_score: number;
  value_score: number;
  urgency_score: number;
  complexity_score: number;
  multi_practice_score: number;
  fee_score: number;
  total: number;
  band: string | null;
  band_locked: boolean;
}

interface ScreenResponse {
  session_id: string;
  practice_area: string | null;
  practice_area_confidence: string;
  next_question: { id: string; text: string; options: Array<{ label: string; value: string }> } | null;
  next_questions: Array<{ id: string; text: string; options: Array<{ label: string; value: string }> }> | null;
  cpi: CpiBreakdown;
  response_text: string;
  finalize: boolean;
  collect_identity: boolean;
  situation_summary: string | null;
  extracted_entities: Record<string, unknown> | null;
  questions_answered: string[] | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  response?: ScreenResponse;
}

const BAND_COLORS: Record<string, string> = {
  A: "bg-emerald-600",
  B: "bg-blue-600",
  C: "bg-amber-500",
  D: "bg-orange-500",
  E: "bg-red-600",
};

const QUICK_MESSAGES = [
  "I was fired from my job last week without any reason",
  "My boss fired me after 12 years without cause and I never signed anything",
  "I think I was discriminated against at work because of my race",
  "Fui demitido sem justa causa depois de 8 anos na empresa",
  "I resigned but I was basically forced out: hostile work environment",
  "My landlord is refusing to return my deposit (should route to out of scope)",
  "I want to sue my employer for wrongful dismissal",
];

export default function TestScreenPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [channel, setChannel] = useState<string>("widget");
  const [lastResponse, setLastResponse] = useState<ScreenResponse | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(messageText?: string) {
    const text = messageText ?? input.trim();
    if (!text || loading) return;

    setInput("");
    setLoading(true);

    const userMsg: Message = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch("/api/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          firm_id: SAKURABA_FIRM_ID,
          channel,
          message: text,
          message_type: "text",
        }),
      });

      const data = await res.json() as ScreenResponse;

      if (!sessionId && data.session_id) {
        setSessionId(data.session_id);
      }

      setLastResponse(data);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.response_text ?? "(no response text)",
        response: data,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Error: ${String(err)}`,
      }]);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setMessages([]);
    setSessionId(null);
    setLastResponse(null);
    setInput("");
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      {/* Left: Conversation */}
      <div className="flex flex-col flex-1 max-w-2xl border-r border-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
          <div>
            <h1 className="text-sm font-semibold text-white">CaseLoad Screen: Engine Test</h1>
            <p className="text-xs text-gray-400">Sakuraba Law · {channel}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={channel}
              onChange={e => setChannel(e.target.value)}
              className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200"
            >
              <option value="widget">Widget</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="chat">Chat</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
            </select>
            <button
              onClick={reset}
              className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded px-3 py-1"
            >
              New Session
            </button>
          </div>
        </div>

        {/* Session ID */}
        {sessionId && (
          <div className="px-4 py-1 bg-gray-900 border-b border-gray-800">
            <span className="text-xs text-gray-500 font-mono">Session: {sessionId}</span>
          </div>
        )}

        {/* Quick messages */}
        {messages.length === 0 && (
          <div className="p-4 space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Quick test messages</p>
            {QUICK_MESSAGES.map((msg, i) => (
              <button
                key={i}
                onClick={() => send(msg)}
                className="block w-full text-left text-xs bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-300"
              >
                {msg}
              </button>
            ))}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-blue-700 text-white"
                  : "bg-gray-800 text-gray-100"
              }`}>
                {msg.content}
                {/* Show next question(s) inline in the chat bubble */}
                {msg.response?.next_question && (
                  <div className="mt-2 pt-2 border-t border-gray-600">
                    <p className="text-xs font-medium text-gray-200">{msg.response.next_question.text}</p>
                  </div>
                )}
                {msg.response?.next_questions && msg.response.next_questions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-600 space-y-1.5">
                    {msg.response.next_questions.map(q => (
                      <p key={q.id} className="text-xs font-medium text-gray-200">{q.text}</p>
                    ))}
                  </div>
                )}
                {msg.response?.finalize && (
                  <div className="mt-2 text-xs font-semibold text-emerald-400">✓ FINALIZED: ready for GHL</div>
                )}
                {msg.response?.collect_identity && (
                  <div className="mt-2 text-xs font-semibold text-amber-400">→ Collect identity next</div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400 animate-pulse">
                Thinking...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-800 bg-gray-900">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Type a message..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded px-4 py-2 text-sm font-medium"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Right: Live state panel */}
      <div className="w-80 flex flex-col overflow-y-auto bg-gray-900">
        <div className="px-4 py-3 border-b border-gray-800">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Live State</h2>
        </div>

        {lastResponse ? (
          <div className="p-4 space-y-4">
            {/* Practice area */}
            <div>
              <p className="text-xs text-gray-500 mb-1">Practice Area</p>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">
                  {lastResponse.practice_area ?? "—"}
                </span>
                {lastResponse.practice_area_confidence && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    lastResponse.practice_area_confidence === "high" ? "bg-emerald-900 text-emerald-300"
                    : lastResponse.practice_area_confidence === "medium" ? "bg-amber-900 text-amber-300"
                    : "bg-gray-700 text-gray-400"
                  }`}>
                    {lastResponse.practice_area_confidence}
                  </span>
                )}
              </div>
            </div>

            {/* CPI */}
            <div>
              <p className="text-xs text-gray-500 mb-2">CPI Score</p>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl font-bold ${
                  lastResponse.cpi.band ? BAND_COLORS[lastResponse.cpi.band] : "bg-gray-700"
                }`}>
                  {lastResponse.cpi.band ?? "?"}
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{lastResponse.cpi.total}</div>
                  <div className="text-xs text-gray-500">
                    {lastResponse.cpi.band_locked ? "Band locked" : "In progress"}
                  </div>
                </div>
              </div>

              {/* Score bars */}
              <div className="space-y-1.5">
                {[
                  { label: "Fit Score", value: lastResponse.cpi.fit_score, max: 40 },
                  { label: "  Geographic", value: lastResponse.cpi.geo_score, max: 10, sub: true },
                  { label: "  Practice fit", value: lastResponse.cpi.practice_score, max: 10, sub: true },
                  { label: "  Legitimacy", value: lastResponse.cpi.legitimacy_score, max: 10, sub: true },
                  { label: "  Referral", value: lastResponse.cpi.referral_score, max: 10, sub: true },
                  { label: "Value Score", value: lastResponse.cpi.value_score, max: 60 },
                  { label: "  Urgency", value: lastResponse.cpi.urgency_score, max: 20, sub: true },
                  { label: "  Complexity", value: lastResponse.cpi.complexity_score, max: 25, sub: true },
                  { label: "  Multi-practice", value: lastResponse.cpi.multi_practice_score, max: 5, sub: true },
                  { label: "  Fee capacity", value: lastResponse.cpi.fee_score, max: 10, sub: true },
                ].map(({ label, value, max, sub }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className={sub ? "text-gray-500" : "text-gray-300 font-medium"}>{label}</span>
                      <span className={sub ? "text-gray-500" : "text-gray-300"}>{value}/{max}</span>
                    </div>
                    <div className={`rounded-full overflow-hidden ${sub ? "h-1 bg-gray-800" : "h-1.5 bg-gray-700"}`}>
                      <div
                        className={`h-full rounded-full transition-all ${sub ? "bg-gray-600" : "bg-blue-500"}`}
                        style={{ width: `${(value / max) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Next question */}
            {lastResponse.next_question && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Next Question</p>
                <p className="text-xs text-gray-300 font-medium mb-1">{lastResponse.next_question.text}</p>
                <div className="space-y-1">
                  {lastResponse.next_question.options.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => send(opt.label)}
                      className="block w-full text-left text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded px-2 py-1.5 text-gray-300"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Situation summary */}
            {lastResponse.situation_summary && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Situation Summary</p>
                <p className="text-xs text-gray-300 bg-gray-800 rounded p-2">{lastResponse.situation_summary}</p>
              </div>
            )}

            {/* Extracted entities */}
            {lastResponse.practice_area && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Extracted Entities</p>
                <pre className="text-xs text-gray-400 bg-gray-800 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify({
                    extracted_entities: lastResponse.extracted_entities ?? {},
                    questions_answered: lastResponse.questions_answered ?? [],
                  }, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 text-xs text-gray-500">
            Send a message to see the live CPI breakdown.
          </div>
        )}
      </div>
    </div>
  );
}
