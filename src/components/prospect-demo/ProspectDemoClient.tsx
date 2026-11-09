"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEmbeddedWidgetResize } from "@/components/intake-v2/useEmbeddedWidgetResize";
import { demoExtractionLabel } from "@/components/intake-v2/ScreenDemoWorkspace";
import { DemoOperatorPanel } from "@/components/intake-v2/DemoOperatorPanel";
import {
  ScreenEnginePublicWidget,
  type ScreenDemoView,
} from "@/components/intake-v2/ScreenEnginePublicWidget";
import {
  ProspectDemoPresentation,
  type ProspectDemoRegistration,
} from "@/components/prospect-demo/ProspectDemoPresentation";
import { exampleLawFirmProspectDemoProfile } from "@/lib/prospect-demo-profiles/example-law-firm";
import { walkerLawProspectDemoProfile } from "@/lib/prospect-demo-profiles/walker-law";
import {
  ensureProspectDemoProfile,
  readProspectDemoProfile,
} from "@/lib/prospect-demo/store";
import type {
  ProspectDemoSessionAdapter,
} from "@/lib/prospect-demo/types";
import { themeToCssVars, type WidgetTheme } from "@/lib/widget-theme";

const EMPTY_VIEW: ScreenDemoView = {
  stage: "kickoff",
  state: null,
  currentQuestion: null,
  report: null,
  extraction: { status: "not-requested" },
  runtime: "demo",
};

function widgetTheme(): WidgetTheme {
  return {
    colors: {
      bg: "#F4F3EF",
      surface: "#FFFFFF",
      text: "#0D1520",
      textMuted: "rgba(38, 38, 38, 0.64)",
      accent: "#1E2F58",
      accentText: "#FFFFFF",
      border: "rgba(38, 38, 38, 0.16)",
      borderHover: "#1E2F58",
    },
    fonts: { display: "var(--font-manrope), sans-serif", body: "DM Sans Variable, sans-serif" },
  };
}


/** Shared canonical prospect presentation. Public samples never read the operator's local library. */
export function ProspectDemoClient({ profileId, embedded = false, sampleOnly = false }: {
  profileId: string;
  embedded?: boolean;
  sampleOnly?: boolean;
}) {
  const [view, setView] = useState<ScreenDemoView>(EMPTY_VIEW);
  const [contactUsed, setContactUsed] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [draft, setDraft] = useState("Thank you for sharing these details. We can discuss the next steps together.");
  const [reply, setReply] = useState<string | null>(null);
  const replyShown = useRef(false);
  const resetContinuation = useCallback(() => {
    replyShown.current = false;
    setView(EMPTY_VIEW); setContactUsed(false); setReplyOpen(false);
    setDraft("Thank you for sharing these details. We can discuss the next steps together."); setReply(null);
  }, []);
  const showReply = useCallback(() => {
    if (replyShown.current || !draft.trim()) return;
    replyShown.current = true;
    setReply(draft);
  }, [draft]);
  const [registrations, setRegistrations] = useState<ProspectDemoRegistration[]>([]);
  const [availability, setAvailability] = useState<"loading" | "ready" | "missing">("loading");

  const root = useRef<HTMLDivElement>(null);
  useEmbeddedWidgetResize(root, availability === "ready");

  useEffect(() => {
    let current = true;
    async function prepareRequestedProfile() {
      let registration: ProspectDemoRegistration | null = null;
      try {
        if (sampleOnly && profileId === exampleLawFirmProspectDemoProfile.id) {
          let blob = new Blob([], { type: exampleLawFirmProspectDemoProfile.screenshot.mimeType });
          try {
            const response = await fetch("/prospect-demos/example-law-firm/example-law-firm.png", { cache: "force-cache" });
            if (response.ok) blob = await response.blob();
          } catch {
            // Keep the fictional intake available if the screenshot cannot load.
          }
          const asset = { ...exampleLawFirmProspectDemoProfile.screenshot, blob };
          registration = { profile: exampleLawFirmProspectDemoProfile, asset };
        } else if (!sampleOnly && profileId === walkerLawProspectDemoProfile.id) {
          const response = await fetch(
            "/prospect-demos/walker-law/walker-law-consultation-reference.png",
            { cache: "force-cache" },
          );
          if (response.ok) {
            const blob = await response.blob();
            const asset = {
              assetId: walkerLawProspectDemoProfile.screenshot.assetId,
              blob,
              width: walkerLawProspectDemoProfile.screenshot.width,
              height: walkerLawProspectDemoProfile.screenshot.height,
              mimeType: "image/png" as const,
            };
            if (!sampleOnly) await ensureProspectDemoProfile(walkerLawProspectDemoProfile, asset);
            registration = { profile: walkerLawProspectDemoProfile, asset };
          }
        }

        const requestedProfile = sampleOnly ? registration?.profile : await readProspectDemoProfile(profileId);
        if (!current) return;
        setRegistrations(registration ? [registration] : []);
        setAvailability(requestedProfile ? "ready" : "missing");
      } catch {
        if (current) setAvailability("missing");
      }
    }
    void prepareRequestedProfile();
    return () => { current = false; };
  }, [profileId, sampleOnly]);

  const receiveView = useCallback((next: ScreenDemoView) => setView(next), []);
  const adapter = useMemo<ProspectDemoSessionAdapter>(() => ({
    renderIntake: (context) => (
      <div style={themeToCssVars(widgetTheme())}>
        <ScreenEnginePublicWidget
          key={`${context.profile.id}-${context.sessionKey}-${context.mode}`}
          firmId={`prospect-demo-${context.profile.slug}`}
          firmName={context.profile.firmName}
          runtime={context.mode === "live-ai" ? "demo-live-ai" : "demo"}
          layout="contained"
          reportEmbeddedHeight={false}
          initialDescription={context.scenario.description}
          onDemoStateChange={receiveView}
          demoContinuation={{ onUseSampleContact: () => setContactUsed(true), reply, onShowReview: context.showReview }}
          consentCaptureEnabled={false}
        />
      </div>
    ),
    renderStatus: () => (
      <div data-ui-component-content="demo-ai-status">
        <p role="status" className="w-full" data-ui-copy="supporting">{demoExtractionLabel(view)}</p>
        <p className="mt-3 w-full" data-ui-copy="body">Live AI can send the fictional description to Google Gemini.</p>
        <p className="mt-3 w-full" data-ui-copy="body">Guided samples run in your browser.</p>
        <p className="mt-3 w-full" data-ui-copy="body">Use fictional examples only. Keep client and confidential details out.</p>
        {sampleOnly && <p className="mt-3 w-full" data-ui-copy="supporting">Example Law Firm is fictional. The website and inquiries are for demonstration only.</p>}
      </div>
    ),
    renderReview: () => <DemoOperatorPanel view={view} contained continuation={{ contactUsed, replyOpen, onOpenReply: () => setReplyOpen(true), draft, onDraftChange: setDraft, reply, onShowReply: showReply }} />,
    onSessionReset: resetContinuation,
  }), [receiveView, sampleOnly, view, contactUsed, replyOpen, draft, reply, showReply, resetContinuation]);

  if (availability !== "ready") {
    return (
      <div ref={root}><main className="grid min-h-screen place-items-center bg-[#F4F3EF] p-6 text-[#182538]">
        <section className="w-full border border-[#182538]/15 bg-white p-7 shadow-sm" data-ui-component-content="prospect-demo-standalone-status">
          <p className="w-full text-xs font-bold uppercase tracking-[0.16em] text-[#90734B]">CaseLoad Select prospect preview</p>
          <h1 className="mt-3 w-full text-2xl font-extrabold" data-ui-copy="heading">
            {availability === "loading" ? "Opening the demonstration." : sampleOnly ? "The sample could not load." : "This demonstration is not saved in this browser."}
          </h1>
          <p className="mt-3 w-full text-sm leading-6 text-[#566170]" data-ui-copy="body">
            {availability === "loading"
              ? "The selected firm profile and website screenshot are loading."
              : sampleOnly ? "Reload the page to try the website sample again." : "Return to the prospect demo builder, save or import the profile, then open it again."}
          </p>
        </section>
      </main></div>
    );
  }

  return (
    <div ref={root} data-screen-demo="prospect">
    <ProspectDemoPresentation
      key={profileId}
      sessionAdapter={adapter}
      registrations={registrations}
      initialProfileId={profileId}
      strictInitialProfile
      appearance="caseload"
      embedded={embedded}
      browserLocalProfiles={!sampleOnly}
    />
    </div>
  );
}
