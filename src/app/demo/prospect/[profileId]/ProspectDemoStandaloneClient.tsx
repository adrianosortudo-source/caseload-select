"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  ProspectDemoSessionContext,
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

function widgetTheme(context: ProspectDemoSessionContext): WidgetTheme {
  const { theme } = context.profile;
  return {
    colors: {
      bg: theme.surface,
      surface: "#FFFFFF",
      text: theme.text,
      textMuted: "rgba(38, 38, 38, 0.64)",
      accent: theme.accent,
      accentText: theme.buttonText,
      border: "rgba(38, 38, 38, 0.16)",
      borderHover: theme.accent,
    },
    fonts: { display: "Manrope, sans-serif", body: "DM Sans, sans-serif" },
  };
}

function extractionLabel(view: ScreenDemoView) {
  if (view.runtime === "demo") {
    return "Guided sample. The deterministic demonstration stays in this browser.";
  }
  if (view.extraction.status === "reading") {
    return "Reading the fictional description with live AI.";
  }
  if (view.extraction.status === "live") {
    return "Live AI interpretation completed for this fictional description.";
  }
  if (view.extraction.status === "fallback") {
    return `Live AI was unavailable. The deterministic fallback is active${view.extraction.reason ? `: ${view.extraction.reason}` : "."}`;
  }
  return "Live AI will read the fictional description when the intake begins.";
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
      <div style={themeToCssVars(widgetTheme(context))}>
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
        <p className="w-full border-b border-white/15 pb-3 text-xs leading-5 text-white/70">
          {extractionLabel(view)}
        </p>
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
    />
  );
}
