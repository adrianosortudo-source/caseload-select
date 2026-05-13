"use client";

import { useState, useRef, useCallback } from "react";
import { IntakeControllerV2 } from "@/components/intake-v2/IntakeControllerV2";
import ChatBubble from "./ChatBubble";
import WhatsAppChat from "./whatsapp/WhatsAppChat";
import DemoScenarioPicker from "@/components/demo/DemoScenarioPicker";
import DemoTour from "@/components/demo/DemoTour";
import type { DemoFirmBranding } from "./provision-demo-firm";
import { DEMO_SCENARIOS } from "@/components/demo/demo-scenarios";
import type { ScenarioId } from "@/components/demo/demo-scenarios";

// ── Constants ────────────────────────────────────────────────────────────────

const NAVY = "#1B3A6B";
const GOLD = "#C4A45A";
const EMAIL = "contact@hartwelllaw.ca";
const ADDRESS = "100 King Street West, Suite 5400\nToronto, ON M5X 1C7";

interface Props {
  firmId: string;
  practiceAreaLabels: string[];
  branding: DemoFirmBranding;
}

export default function DemoLandingPage({ firmId, practiceAreaLabels, branding }: Props) {
  const PHONE_DISPLAY = branding.phone_number;
  const PHONE_TEL = branding.phone_tel;

  const widgetRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);
  const whatsappRef = useRef<HTMLDivElement>(null);

  const [contactForm, setContactForm] = useState({ name: "", email: "", message: "" });
  const [contactSent, setContactSent] = useState(false);
  const [contactSending, setContactSending] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ── Demo state ──────────────────────────────────────────────────────────────
  const [showPicker, setShowPicker] = useState(false);
  const [activeScenario, setActiveScenario] = useState<ScenarioId | null>(null);
  const [demoStep, setDemoStep] = useState("intent");

  const handleScenarioSelect = useCallback((id: ScenarioId) => {
    setShowPicker(false);
    setActiveScenario(id);
    setDemoStep("intent");
    setTimeout(() => {
      widgetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }, []);

  const exitDemo = useCallback(() => {
    setActiveScenario(null);
    setDemoStep("intent");
  }, []);

  // Map IntakeControllerV2's step names to the legacy step names DemoTour's
  // BALLOON map keys on. Keeps the side-balloon working with the new widget
  // without touching DemoTour. New steps (thinking_r3, round3) fall through
  // to the existing "questions" balloon, which is the right narrative cue.
  const STEP_ALIAS: Record<string, string> = {
    kickoff: "intent",
    thinking: "submitting",
    questions: "questions",
    identity: "identity",
    otp: "otp",
    thinking_r3: "submitting",
    round3: "questions",
    done: "result",
    error: "error",
  };
  const handleStepChange = useCallback((step: string) => {
    setDemoStep(STEP_ALIAS[step] ?? step);
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function scrollToWidget() {
    widgetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function scrollToContact() {
    contactRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function scrollToWhatsapp() {
    whatsappRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    setContactSending(true);
    try {
      await fetch("/api/demo/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactForm),
      });
    } catch {
      // Silent  -  show confirmation regardless
    }
    setContactSending(false);
    setContactSent(true);
  }

  return (
    <div className="min-h-screen font-sans antialiased text-gray-900 bg-white">

      {/* ── DEMO BANNER ─────────────────────────────────────────────────── */}
      <div
        className="w-full text-center py-2.5 px-4 text-xs font-medium flex flex-wrap items-center justify-center gap-x-4 gap-y-1"
        style={{ backgroundColor: GOLD, color: "#1a1a2e" }}
      >
        <span>
          🎯 <strong>Live Demo:</strong> Hartwell Law PC is a fictional firm built to show CaseLoad Select in action.
        </span>
        <span className="hidden sm:inline text-black/30">·</span>
        <span className="flex items-center gap-3">
          <a href="/demo/sms" className="underline underline-offset-2 hover:opacity-70 transition">
            Try SMS intake
          </a>
          <span className="text-black/30">·</span>
          <a href="/demo/whatsapp" className="underline underline-offset-2 hover:opacity-70 transition">
            Try WhatsApp
          </a>
        </span>
      </div>

      {/* ── STICKY HEADER ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/10 shadow-sm" style={{ backgroundColor: NAVY }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">

          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: GOLD }}>
              H
            </div>
            <span className="text-white font-bold tracking-wide text-sm sm:text-base">HARTWELL LAW PC</span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm text-white/80">
            <button onClick={scrollToWidget} className="hover:text-white transition">Start Consultation</button>
            <button onClick={() => document.getElementById("practice-areas")?.scrollIntoView({ behavior: "smooth" })} className="hover:text-white transition">
              Practice Areas
            </button>
            <button onClick={scrollToContact} className="hover:text-white transition">Contact</button>
          </nav>

          {/* CTA */}
          <div className="flex items-center gap-2">
            <a
              href={PHONE_TEL}
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition hover:opacity-90"
              style={{ backgroundColor: GOLD, color: "#1a1a2e" }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {PHONE_DISPLAY}
            </a>
            <button onClick={() => setMobileMenuOpen(m => !m)} className="md:hidden text-white p-1">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 px-4 py-3 space-y-2" style={{ backgroundColor: NAVY }}>
            <button onClick={() => { scrollToWidget(); setMobileMenuOpen(false); }} className="block w-full text-left text-sm text-white/80 hover:text-white py-2">
              Start Consultation
            </button>
            <button onClick={() => { document.getElementById("practice-areas")?.scrollIntoView({ behavior: "smooth" }); setMobileMenuOpen(false); }} className="block w-full text-left text-sm text-white/80 hover:text-white py-2">
              Practice Areas
            </button>
            <button onClick={() => { scrollToContact(); setMobileMenuOpen(false); }} className="block w-full text-left text-sm text-white/80 hover:text-white py-2">
              Contact
            </button>
            <a href={PHONE_TEL} className="flex items-center gap-2 text-sm font-semibold py-2" style={{ color: GOLD }}>
              📞 {PHONE_DISPLAY}
            </a>
          </div>
        )}
      </header>

      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <section className="py-16 lg:py-24" style={{ backgroundColor: "#F7F6F2" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">

            {/* Left: copy */}
            <div className="flex flex-col justify-center">
              <div
                className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest mb-6 px-3 py-1.5 rounded-full w-fit"
                style={{ backgroundColor: `${GOLD}22`, color: GOLD }}
              >
                Ontario Law Firm
              </div>
              <h1 className="text-4xl lg:text-5xl xl:text-6xl font-extrabold leading-tight mb-6" style={{ color: NAVY }}>
                Get Your Case Reviewed in{" "}
                <span style={{ color: GOLD }}>3 Minutes</span>
              </h1>
              <p className="text-lg text-gray-600 leading-relaxed mb-8">
                Our AI intake system tells you immediately whether we can help and how urgent your matter is.
                No gatekeeping, no waiting room, no intake forms that go nowhere.
              </p>
              <ul className="space-y-3 mb-10">
                {[
                  "35 practice areas across Ontario",
                  "Immediate priority assessment  -  no waiting room",
                  "Your lawyer receives a prepared case memo before the call",
                  "Confidential under Ontario law from the first message",
                ].map(item => (
                  <li key={item} className="flex items-start gap-3 text-sm text-gray-700">
                    <span className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-white text-xs" style={{ backgroundColor: NAVY }}>
                      ✓
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3">
                <button onClick={scrollToWidget} className="px-6 py-3 rounded-xl text-white font-semibold text-sm transition hover:opacity-90 shadow-lg" style={{ backgroundColor: NAVY }}>
                  Submit for review
                </button>
                <a href={PHONE_TEL} className="px-6 py-3 rounded-xl font-semibold text-sm transition hover:opacity-90 border-2 flex items-center gap-2" style={{ borderColor: NAVY, color: NAVY }}>
                  📞 {PHONE_DISPLAY}
                </a>
                <button onClick={scrollToWhatsapp} className="px-6 py-3 rounded-xl font-semibold text-sm transition hover:opacity-90 flex items-center gap-2" style={{ backgroundColor: "#25D366", color: "white" }}>
                  <span>📲</span> WhatsApp
                </button>
                <a href="/demo/sms" className="px-6 py-3 rounded-xl font-semibold text-sm transition hover:opacity-90 flex items-center gap-2 border-2" style={{ borderColor: "#6b7280", color: "#374151" }}>
                  <span>💬</span> SMS
                </a>
              </div>
            </div>

            {/* Right: widget + demo trigger */}
            <div className="flex flex-col items-center lg:items-end gap-3">

              {/* Demo trigger strip  -  visually distinct from site UI */}
              <div className="w-full max-w-md">
                {!activeScenario ? (
                  /* Inactive state: invite to try a scenario */
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setShowPicker(true)}
                      className="flex items-center gap-2 text-[11px] font-bold px-3.5 py-2 rounded-full transition-all hover:opacity-90"
                      style={{ background: "#1E2F58", color: "white" }}
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      Try a demo scenario
                    </button>
                    <span className="text-[10px] text-gray-400">or type your own case below</span>
                  </div>
                ) : (
                  /* Active state: show which scenario is running */
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                    <span className="text-[11px] font-semibold text-[#1E2F58]">Demo running</span>
                    <span className="text-[10px] text-black/30">·</span>
                    <span className="text-[10px] text-black/50">
                      {DEMO_SCENARIOS.find(s => s.id === activeScenario)?.outcome ?? ""}
                    </span>
                    <button
                      onClick={exitDemo}
                      className="ml-auto text-[10px] font-medium text-black/40 hover:text-black/70 transition underline"
                    >
                      Exit
                    </button>
                  </div>
                )}
              </div>

              {/* Widget container  -  renders the same IntakeControllerV2
                  used in production at /widget/[firmId]. The demo seeds the
                  kickoff narrative from the chosen scenario; the prospect can
                  still edit before submitting. The `key` forces a remount on
                  scenario switch so all internal state resets cleanly. */}
              <div
                ref={widgetRef}
                className="w-full max-w-md transition-all duration-300"
                style={activeScenario ? { position: "relative", zIndex: 35 } : {}}
              >
                <IntakeControllerV2
                  key={activeScenario ?? "free"}
                  firmId={firmId}
                  firmName="Hartwell Law PC"
                  kickoffSeed={
                    activeScenario
                      ? DEMO_SCENARIOS.find(s => s.id === activeScenario)?.message
                      : undefined
                  }
                  onStepChange={handleStepChange}
                />
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── WHATSAPP SIMULATOR ──────────────────────────────────────────── */}
      {/* Same intake engine as the website widget, rendered in WhatsApp's
          one-question-at-a-time format. Lets the operator test how the
          conversation flows on the channel before pointing real GHL traffic
          at it. The standalone /demo/whatsapp page still exists for sharing. */}
      <section
        ref={whatsappRef}
        id="whatsapp-simulator"
        className="py-16 lg:py-20"
        style={{ backgroundColor: "#1A1A2E" }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">

            {/* Left: framing copy */}
            <div className="text-white">
              <div
                className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest mb-5 px-3 py-1.5 rounded-full w-fit"
                style={{ backgroundColor: "#25D36622", color: "#25D366" }}
              >
                Same intake, WhatsApp channel
              </div>
              <h2 className="text-3xl lg:text-4xl font-extrabold leading-tight mb-5">
                The conversation, on WhatsApp
              </h2>
              <p className="text-base text-white/70 leading-relaxed mb-6">
                Try the screen here in WhatsApp's format. The same engine drives the website widget above; the difference is the rhythm: one question at a time, plain text, quick-reply chips when they help.
              </p>
              <ul className="space-y-2.5 text-sm text-white/70 mb-8">
                {[
                  "One question at a time, no walls of options",
                  "Quick-reply chips render as tappable WhatsApp Business pills",
                  "Identity capture happens inside the chat, not on a form",
                  "The lead lands in the same triage queue as the widget",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span
                      className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-white text-xs"
                      style={{ backgroundColor: "#25D366" }}
                    >
                      ✓
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-white/40 leading-relaxed max-w-md">
                This is a UI simulator for testing the script, not a live WhatsApp Business number. Hooking the same flow into a real WhatsApp Business API account is a separate switch.
              </p>
            </div>

            {/* Right: phone-frame simulator */}
            <div className="flex items-start justify-center">
              <WhatsAppChat firmId={firmId} variant="embed" />
            </div>

          </div>
        </div>
      </section>

      {/* ── TRUST STRIP ─────────────────────────────────────────────────── */}
      <section style={{ backgroundColor: NAVY }} className="py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center text-white">
            {[
              { stat: "35",    label: "Practice Areas" },
              { stat: "500+", label: "Cases Handled" },
              { stat: "20+",  label: "Years of Practice" },
              { stat: "<3 min", label: "Average Intake Time" },
            ].map(({ stat, label }) => (
              <div key={label}>
                <div className="text-3xl font-extrabold" style={{ color: GOLD }}>{stat}</div>
                <div className="text-sm text-white/70 mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────────────────────── */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-extrabold text-center mb-4" style={{ color: NAVY }}>How It Works</h2>
          <p className="text-center text-gray-500 mb-14 max-w-xl mx-auto">
            Four steps. Your lawyer walks into the call already prepared.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
            {[
              {
                step: "01",
                title: "Describe Your Situation",
                body: "Type what happened in plain language. The AI understands legal context without jargon.",
              },
              {
                step: "02",
                title: "Two Rounds of Questions",
                body: "Adaptive questions specific to your practice area. The system scores your case in real time.",
              },
              {
                step: "03",
                title: "Case Details  -  Round 3",
                body: "Evidence inventory, parties, deadlines, expectations. Rounds 1 and 2 decide whether to take the meeting. Round 3 decides how your lawyer walks in prepared.",
                highlight: true,
              },
              {
                step: "04",
                title: "Your Lawyer Gets a Case Memo",
                body: "Before the consultation, your lawyer receives a structured case file  -  not a sticky note. That is the difference.",
              },
            ].map(({ step, title, body, highlight }) => (
              <div key={step} className={`flex flex-col items-start ${highlight ? "relative" : ""}`}>
                {highlight && (
                  <span
                    className="absolute -top-3 left-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: GOLD, color: "#1a1a2e" }}
                  >
                    New
                  </span>
                )}
                <div className="text-5xl font-black mb-4 leading-none" style={{ color: `${GOLD}44` }}>{step}</div>
                <div className="w-8 h-1 rounded mb-4" style={{ backgroundColor: GOLD }} />
                <h3 className="text-lg font-bold mb-2" style={{ color: NAVY }}>{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRACTICE AREAS ──────────────────────────────────────────────── */}
      <section id="practice-areas" className="py-20" style={{ backgroundColor: "#F7F6F2" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-extrabold text-center mb-4" style={{ color: NAVY }}>35 Practice Areas</h2>
          <p className="text-center text-gray-500 mb-12 max-w-xl mx-auto">
            Our AI intake system covers virtually every area of Ontario law. If you have a legal matter, start a consultation.
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {practiceAreaLabels.map(label => (
              <button
                key={label}
                onClick={scrollToWidget}
                className="px-4 py-2 rounded-full text-sm font-medium border transition hover:text-white hover:border-transparent"
                style={{ borderColor: `${NAVY}40`, color: NAVY }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = NAVY;
                  (e.currentTarget as HTMLElement).style.color = "white";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                  (e.currentTarget as HTMLElement).style.color = NAVY;
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="text-center mt-10">
            <button
              onClick={scrollToWidget}
              className="px-8 py-3 rounded-xl text-white font-semibold text-sm shadow-lg transition hover:opacity-90"
              style={{ backgroundColor: NAVY }}
            >
              Start a Free Consultation
            </button>
          </div>
        </div>
      </section>

      {/* ── INTAKE CHANNELS SHOWCASE ─────────────────────────────────────── */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-extrabold text-center mb-4" style={{ color: NAVY }}>Reach Us Any Way You Prefer</h2>
          <p className="text-center text-gray-500 mb-14 max-w-xl mx-auto">
            Every contact method routes to the same intake system. Your case is assessed regardless of channel.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: "🤖",
                title: "AI Intake (This Page)",
                desc: "Describe your situation. Our AI extracts the key facts and assigns a priority score in real time.",
                action: "Start Consultation",
                onClick: scrollToWidget,
              },
              {
                icon: "💬",
                title: "Live Chat",
                desc: "Click the chat bubble (bottom right). The AI works the same way, different entry point.",
                action: "Open Chat",
                onClick: () => document.querySelector<HTMLButtonElement>("[aria-label='Open chat']")?.click(),
              },
              {
                icon: "📞",
                title: "Call Directly",
                desc: "Speak with a receptionist who feeds your details into the same intake system.",
                action: PHONE_DISPLAY,
                href: PHONE_TEL,
              },
              {
                icon: "📲",
                title: "WhatsApp",
                desc: "Same screening engine, WhatsApp's one-question-at-a-time rhythm. Test the conversation flow below.",
                action: "Open WhatsApp",
                onClick: scrollToWhatsapp,
              },
            ].map(({ icon, title, desc, action, onClick, href }) => (
              <div key={title} className="border border-gray-200 rounded-2xl p-6 flex flex-col gap-4 hover:shadow-md transition">
                <div className="text-4xl">{icon}</div>
                <div>
                  <div className="font-bold text-sm mb-1" style={{ color: NAVY }}>{title}</div>
                  <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
                </div>
                {href ? (
                  <a href={href} className="mt-auto text-sm font-semibold text-center py-2.5 rounded-lg transition hover:opacity-90 text-white" style={{ backgroundColor: NAVY }}>
                    {action}
                  </a>
                ) : (
                  <button onClick={onClick} className="mt-auto text-sm font-semibold text-center py-2.5 rounded-lg transition hover:opacity-90 text-white" style={{ backgroundColor: NAVY }}>
                    {action}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CONTACT SECTION ──────────────────────────────────────────────── */}
      <section ref={contactRef} className="py-20" style={{ backgroundColor: "#F7F6F2" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-extrabold text-center mb-14" style={{ color: NAVY }}>Contact Hartwell Law</h2>
          <div className="grid lg:grid-cols-2 gap-12">

            {/* Left: info */}
            <div className="space-y-8">
              <div>
                <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: GOLD }}>Office</div>
                <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{ADDRESS}</p>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: GOLD }}>Phone</div>
                <a href={PHONE_TEL} className="text-sm font-semibold hover:underline" style={{ color: NAVY }}>{PHONE_DISPLAY}</a>
                <p className="text-xs text-gray-500 mt-1">Mon–Fri 8:00 am – 6:00 pm EST</p>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: GOLD }}>Email</div>
                <a href={`mailto:${EMAIL}`} className="text-sm font-semibold hover:underline" style={{ color: NAVY }}>{EMAIL}</a>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <a href={PHONE_TEL} className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-white font-semibold text-sm transition hover:opacity-90" style={{ backgroundColor: NAVY }}>
                  📞 Call Now
                </a>
                <button onClick={scrollToWhatsapp} className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition hover:opacity-90 text-white" style={{ backgroundColor: "#25D366" }}>
                  📲 WhatsApp
                </button>
                <button onClick={scrollToWidget} className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition hover:opacity-90 border-2" style={{ borderColor: NAVY, color: NAVY }}>
                  🤖 AI Intake
                </button>
              </div>
            </div>

            {/* Right: contact form */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
              {contactSent ? (
                <div className="text-center py-10">
                  <div className="text-5xl mb-4">✅</div>
                  <div className="font-bold text-lg mb-2" style={{ color: NAVY }}>Message Received</div>
                  <p className="text-sm text-gray-500">We&apos;ll reach out within one business day. For urgent matters, please call us directly.</p>
                  <button
                    onClick={() => { setContactSent(false); setContactForm({ name: "", email: "", message: "" }); }}
                    className="mt-6 text-sm font-medium hover:underline"
                    style={{ color: NAVY }}
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleContactSubmit} className="space-y-5">
                  <h3 className="font-bold text-lg" style={{ color: NAVY }}>Send a Message</h3>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name</label>
                    <input
                      required placeholder="Jane Smith"
                      value={contactForm.name}
                      onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Email Address</label>
                    <input
                      required type="email" placeholder="jane@example.com"
                      value={contactForm.email}
                      onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">How Can We Help?</label>
                    <textarea
                      required rows={5} placeholder="Briefly describe your legal matter..."
                      value={contactForm.message}
                      onChange={e => setContactForm(f => ({ ...f, message: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                    />
                  </div>
                  <p className="text-xs text-gray-400">
                    This form is for general enquiries only. For an immediate case assessment, use the AI intake above.
                    Nothing submitted here constitutes legal advice or a retainer agreement.
                  </p>
                  <button
                    type="submit" disabled={contactSending}
                    className="w-full py-3 rounded-xl text-white font-semibold text-sm transition hover:opacity-90 disabled:opacity-60"
                    style={{ backgroundColor: NAVY }}
                  >
                    {contactSending ? "Sending…" : "Send Message"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer style={{ backgroundColor: NAVY }} className="py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded flex items-center justify-center text-white font-bold text-xs" style={{ backgroundColor: GOLD }}>H</div>
              <span className="text-white font-bold text-sm">HARTWELL LAW PC</span>
            </div>
            <p className="text-white/40 text-xs text-center max-w-md leading-relaxed">
              This is a demonstration site. Hartwell Law PC is a fictional law firm created for sales demonstration purposes by CaseLoad Select.
              No legal advice is provided. Powered by{" "}
              <span style={{ color: GOLD }}>CaseLoad Select</span>.
            </p>
            <div className="flex gap-4 text-xs text-white/50">
              <span>Toronto, ON</span>
              <span>·</span>
              <a href={PHONE_TEL} className="hover:text-white/80">{PHONE_DISPLAY}</a>
            </div>
          </div>
        </div>
      </footer>

      {/* ── FLOATING CHAT BUBBLE ─────────────────────────────────────────── */}
      <ChatBubble firmId={firmId} firmName="Hartwell Law PC" branding={branding} />

      {/* ── MOBILE STICKY CALL BAR (hidden during demo) ──────────────────── */}
      {!activeScenario && (
        <div
          className="fixed bottom-0 left-0 right-0 sm:hidden z-30 border-t border-gray-200 bg-white flex"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <a href={PHONE_TEL} className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold" style={{ color: NAVY }}>
            📞 Call
          </a>
          <div className="w-px bg-gray-200" />
          <button onClick={scrollToWhatsapp} className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold" style={{ color: "#25D366" }}>
            📲 WhatsApp
          </button>
          <div className="w-px bg-gray-200" />
          <button onClick={scrollToWidget} className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white" style={{ backgroundColor: NAVY }}>
            🤖 Start
          </button>
        </div>
      )}

      {/* ── DEMO SYSTEM ─────────────────────────────────────────────────── */}
      {/* Scenario picker modal  -  z-70, above everything including header */}
      <DemoScenarioPicker
        open={showPicker}
        onSelect={handleScenarioSelect}
        onClose={() => setShowPicker(false)}
      />

      {/* Tour overlay + balloon  -  z-30 overlay, z-60 balloon/exit */}
      <DemoTour
        active={!!activeScenario}
        currentStep={demoStep}
        scenarioId={activeScenario}
        onExit={exitDemo}
      />

    </div>
  );
}
