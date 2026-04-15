"use client";

import { useState } from "react";
import { IntakeWidget } from "@/components/intake/IntakeWidget";
import type { DemoFirmBranding } from "./provision-demo-firm";

type View = "menu" | "sms" | "chat" | "whatsapp";

interface ChatBubbleProps {
  firmId: string;
  firmName: string;
  branding: DemoFirmBranding;
}

export default function ChatBubble({ firmId, firmName, branding }: ChatBubbleProps) {
  const ACCENT = branding.accent_color || "#1B3A6B";
  const PHONE = branding.phone_tel || "";
  const PHONE_DISPLAY = branding.phone_number || "";
  const ASSISTANT_NAME = branding.assistant_name || "Alex";
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [smsForm, setSmsForm] = useState({ name: "", phone: "", message: "" });
  const [smsSent, setSmsSent] = useState(false);

  function close() {
    setOpen(false);
    setTimeout(() => setView("menu"), 300);
  }

  function handleSmsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSmsSent(true);
  }

  return (
    <>
      {/* ── Floating trigger button ── */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
        style={{ backgroundColor: ACCENT }}
        aria-label="Open chat"
      >
        {open ? (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}
      </button>

      {/* ── Widget panel ── */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          style={{ maxHeight: "calc(100vh - 120px)" }}>

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ backgroundColor: ACCENT }}>
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0 overflow-hidden">
              <img
                src="/brand/logos/icon-light-transparent.png"
                alt="CaseLoad Select"
                className="w-6 h-6 object-contain"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{firmName}</div>
              <div className="text-xs text-white/70">{ASSISTANT_NAME} · How can I help?</div>
            </div>
            <button onClick={close} className="text-white/70 hover:text-white transition p-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="bg-white flex-1 overflow-y-auto">

            {/* ── Menu ── */}
            {view === "menu" && (
              <div className="p-4 space-y-3">
                <p className="text-sm text-gray-500 text-center py-2">
                  Choose how you&apos;d like to connect with us.
                </p>

                <button onClick={() => setView("chat")}
                  className="w-full flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition text-left">
                  <span className="text-2xl">💬</span>
                  <div>
                    <div className="font-semibold text-sm text-gray-800">Start AI Consultation</div>
                    <div className="text-xs text-gray-500">Describe your situation — get an instant assessment</div>
                  </div>
                </button>

                <button onClick={() => setView("sms")}
                  className="w-full flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition text-left">
                  <span className="text-2xl">📩</span>
                  <div>
                    <div className="font-semibold text-sm text-gray-800">Send a Message</div>
                    <div className="text-xs text-gray-500">We&apos;ll get back to you within the hour</div>
                  </div>
                </button>

                <a href="/demo/whatsapp"
                  className="w-full flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-green-300 hover:bg-green-50 transition">
                  <span className="text-2xl">📲</span>
                  <div>
                    <div className="font-semibold text-sm text-gray-800">Chat via WhatsApp</div>
                    <div className="text-xs text-gray-500">Open a WhatsApp conversation now</div>
                  </div>
                </a>

                {PHONE && (
                  <a href={`tel:${PHONE}`}
                    className="w-full flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition">
                    <span className="text-2xl">📞</span>
                    <div>
                      <div className="font-semibold text-sm text-gray-800">Call Us Now</div>
                      <div className="text-xs text-gray-500">{PHONE_DISPLAY} — Mon–Fri 8am–6pm</div>
                    </div>
                  </a>
                )}
              </div>
            )}

            {/* ── SMS / Message form ── */}
            {view === "sms" && (
              <div className="p-4">
                <button onClick={() => setView("menu")} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-4">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
                {smsSent ? (
                  <div className="text-center py-8">
                    <div className="text-3xl mb-3">📱</div>
                    <div className="font-semibold text-gray-800">SMS sent to your phone</div>
                    <div className="text-sm text-gray-500 mt-1">You&apos;ll receive a text within seconds.</div>
                    <a href="/demo/sms"
                      className="mt-4 inline-block px-5 py-2.5 rounded-lg text-white text-sm font-semibold"
                      style={{ backgroundColor: ACCENT }}>
                      View SMS Conversation
                    </a>
                  </div>
                ) : (
                  <form onSubmit={handleSmsSubmit} className="space-y-3">
                    <p className="text-sm text-gray-600 font-medium">Send us a message</p>
                    <input required placeholder="Your name"
                      value={smsForm.name}
                      onChange={e => setSmsForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    <input placeholder="Phone number (optional)"
                      value={smsForm.phone}
                      onChange={e => setSmsForm(f => ({ ...f, phone: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    <textarea required rows={4} placeholder="How can we help you?"
                      value={smsForm.message}
                      onChange={e => setSmsForm(f => ({ ...f, message: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
                    <label className="flex items-start gap-2 text-xs text-gray-500 cursor-pointer">
                      <input type="checkbox" defaultChecked className="mt-0.5" />
                      By submitting you agree to be contacted via SMS or email. Standard rates may apply.
                    </label>
                    <button type="submit"
                      className="w-full py-2.5 rounded-lg text-white text-sm font-semibold transition hover:opacity-90"
                      style={{ backgroundColor: ACCENT }}>
                      Send Message
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* ── Live Chat (AI widget) ── */}
            {view === "chat" && (
              <div className="p-2">
                <button onClick={() => setView("menu")} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-2 px-2">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
                <IntakeWidget
                  firmId={firmId}
                  firmName={firmName}
                  accentColor={ACCENT}
                  assistantName={ASSISTANT_NAME}
                  assistantAvatar="/brand/logos/icon-light-transparent.png"
                  firmPhone={PHONE_DISPLAY}
                  firmPhoneTel={PHONE}
                  firmBookingUrl={branding.booking_url || undefined}
                  firmPrivacyUrl={branding.privacy_policy_url || undefined}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
