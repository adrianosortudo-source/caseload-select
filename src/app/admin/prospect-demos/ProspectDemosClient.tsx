"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProspectDemoPresentation, type ProspectDemoRegistration } from "@/components/prospect-demo/ProspectDemoPresentation";
import { ProspectDemoBuilder } from "@/components/prospect-demo/ProspectDemoBuilder";
import { DemoOperatorPanel } from "@/components/intake-v2/DemoOperatorPanel";
import { ScreenEnginePublicWidget, type ScreenDemoView } from "@/components/intake-v2/ScreenEnginePublicWidget";
import { walkerLawProspectDemoProfile } from "@/lib/prospect-demo-profiles/walker-law";
import type { ProspectDemoSessionAdapter, ProspectDemoSessionContext } from "@/lib/prospect-demo/types";
import { ensureProspectDemoProfile } from "@/lib/prospect-demo/store";
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
  if (view.runtime === "demo") return "Guided sample. The deterministic demonstration stays in this browser.";
  if (view.extraction.status === "reading") return "Reading the fictional description with live AI.";
  if (view.extraction.status === "live") return "Live AI interpretation completed for this fictional description.";
  if (view.extraction.status === "fallback") return `Live AI was unavailable. The deterministic fallback is active${view.extraction.reason ? `: ${view.extraction.reason}` : "."}`;
  return "Live AI will read the fictional description when the intake begins.";
}

export function ProspectDemosClient() {
  const [registrations, setRegistrations] = useState<ProspectDemoRegistration[]>([]);
  const [view, setView] = useState<ScreenDemoView>(EMPTY_VIEW);
  const [workspace, setWorkspace] = useState<"present" | "builder">("present");
  const [requestedProfileId, setRequestedProfileId] = useState("walker-law");

  useEffect(() => {
    let current = true;
    async function loadWalkerAsset() {
      try {
        const response = await fetch("/prospect-demos/walker-law/walker-law-consultation-reference.png", { cache: "force-cache" });
        if (!response.ok) throw new Error(`Screenshot request failed with ${response.status}.`);
        const blob = await response.blob();
        if (!current) return;
        await ensureProspectDemoProfile(walkerLawProspectDemoProfile, {
          assetId: walkerLawProspectDemoProfile.screenshot.assetId,
          blob,
          width: walkerLawProspectDemoProfile.screenshot.width,
          height: walkerLawProspectDemoProfile.screenshot.height,
          mimeType: "image/png",
        });
        if (!current) return;
        setRegistrations([{
          profile: walkerLawProspectDemoProfile,
          asset: {
            assetId: walkerLawProspectDemoProfile.screenshot.assetId,
            blob,
            width: walkerLawProspectDemoProfile.screenshot.width,
            height: walkerLawProspectDemoProfile.screenshot.height,
            mimeType: "image/png",
          },
        }]);
      } catch {
        if (current) setRegistrations([]);
      }
    }
    void loadWalkerAsset();
    return () => { current = false; };
  }, []);

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
        <p className="border-b border-white/15 pb-3 text-xs leading-5 text-white/70">{extractionLabel(view)}</p>
        <DemoOperatorPanel view={view} />
      </div>
    ),
    onRestart: () => setView(EMPTY_VIEW),
  }), [receiveView, view]);

  return (
    <div>
      <div className="border-b border-[#182538]/15 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-5 text-[#566170]">Profiles, screenshots, and packages remain in this browser unless you export one.</p>
          <div className="flex gap-2" aria-label="Prospect demo workspace">
            <button type="button" onClick={() => setWorkspace("present")} aria-pressed={workspace === "present"} className={workspace === "present" ? "border border-[#182538] bg-[#182538] px-3 py-2 text-xs font-bold text-white" : "border border-[#182538]/20 bg-white px-3 py-2 text-xs font-bold text-[#374457]"}>Present</button>
            <button type="button" onClick={() => setWorkspace("builder")} aria-pressed={workspace === "builder"} className={workspace === "builder" ? "border border-[#182538] bg-[#182538] px-3 py-2 text-xs font-bold text-white" : "border border-[#182538]/20 bg-white px-3 py-2 text-xs font-bold text-[#374457]"}>Build or import</button>
          </div>
        </div>
      </div>
      {workspace === "builder" ? (
        <main className="min-h-screen bg-[#F4F3EF] p-4 sm:p-6">
          <div className="mx-auto w-full max-w-[1440px]">
            <ProspectDemoBuilder onPresent={(profileId) => {
              setRequestedProfileId(profileId);
              setWorkspace("present");
            }} />
          </div>
        </main>
      ) : (
        <ProspectDemoPresentation key={requestedProfileId} sessionAdapter={adapter} registrations={registrations} initialProfileId={requestedProfileId} />
      )}
    </div>
  );
}
