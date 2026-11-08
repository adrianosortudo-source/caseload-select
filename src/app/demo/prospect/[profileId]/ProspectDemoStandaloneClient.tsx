"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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


export function ProspectDemoStandaloneClient({ profileId }: { profileId: string }) {
  const [view, setView] = useState<ScreenDemoView>(EMPTY_VIEW);
  const [registrations, setRegistrations] = useState<ProspectDemoRegistration[]>([]);
  const [availability, setAvailability] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let current = true;
    async function prepareRequestedProfile() {
      let registration: ProspectDemoRegistration | null = null;
      try {
        if (profileId === walkerLawProspectDemoProfile.id) {
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
            await ensureProspectDemoProfile(walkerLawProspectDemoProfile, asset);
            registration = { profile: walkerLawProspectDemoProfile, asset };
          }
        }

        const requestedProfile = await readProspectDemoProfile(profileId);
        if (!current) return;
        setRegistrations(registration ? [registration] : []);
        setAvailability(requestedProfile ? "ready" : "missing");
      } catch {
        if (current) setAvailability("missing");
      }
    }
    void prepareRequestedProfile();
    return () => { current = false; };
  }, [profileId]);

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
          initialDescription={context.scenario.description}
          onDemoStateChange={receiveView}
          consentCaptureEnabled={false}
        />
      </div>
    ),
    renderReview: () => (
      <div className="space-y-4">
        <div data-ui-component-content="demo-ai-status"><p role="status" className="w-full" data-ui-copy="supporting">{demoExtractionLabel(view)}</p><p className="mt-3 w-full" data-ui-copy="body">Live AI can send the fictional description to Google Gemini. Guided samples run in your browser. Do not enter client or confidential information.</p></div>
        <DemoOperatorPanel view={view} contained />
      </div>
    ),
    onRestart: () => setView(EMPTY_VIEW),
  }), [receiveView, view]);

  if (availability !== "ready") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F4F3EF] p-6 text-[#182538]">
        <section className="w-full border border-[#182538]/15 bg-white p-7 shadow-sm" data-ui-component-content="prospect-demo-standalone-status">
          <p className="w-full text-xs font-bold uppercase tracking-[0.16em] text-[#90734B]">CaseLoad Select prospect preview</p>
          <h1 className="mt-3 w-full text-2xl font-extrabold" data-ui-copy="heading">
            {availability === "loading" ? "Opening the saved demonstration." : "This demonstration is not saved in this browser."}
          </h1>
          <p className="mt-3 w-full text-sm leading-6 text-[#566170]" data-ui-copy="body">
            {availability === "loading"
              ? "The selected firm profile and website screenshot are loading."
              : "Return to the prospect demo builder, save or import the profile, then open it again."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <ProspectDemoPresentation
      key={profileId}
      sessionAdapter={adapter}
      registrations={registrations}
      initialProfileId={profileId}
      strictInitialProfile
      appearance="caseload"
    />
  );
}
