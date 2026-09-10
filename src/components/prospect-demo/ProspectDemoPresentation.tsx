"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ensureProspectDemoProfile,
  listProspectDemoProfiles,
  readProspectDemoAsset,
} from "@/lib/prospect-demo/store";
import type {
  ProspectDemoAsset,
  ProspectDemoMode,
  ProspectDemoProfile,
  ProspectDemoSessionAdapter,
  ProspectDemoSessionContext,
  ProspectDemoView,
} from "@/lib/prospect-demo/types";

export interface ProspectDemoRegistration {
  profile: ProspectDemoProfile;
  asset: ProspectDemoAsset;
}

interface Props {
  sessionAdapter: ProspectDemoSessionAdapter;
  /** Optional shipped profiles are seeded only once, then remain browser-local. */
  registrations?: ProspectDemoRegistration[];
  initialProfileId?: string;
}

const VIEW_LABELS: Record<ProspectDemoView, string> = {
  website: "Website",
  review: "Lawyer view",
  split: "Split view",
};
const EMPTY_REGISTRATIONS: ProspectDemoRegistration[] = [];

function ScreenshotStage({
  profile,
  asset,
  children,
}: {
  profile: ProspectDemoProfile;
  asset: ProspectDemoAsset | null;
  children: ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!asset) {
      setUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(asset.blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [asset]);

  if (!asset || !url) {
    return (
      <div className="grid min-h-[34rem] place-items-center border border-[#182538]/15 bg-[#F3F0E9] p-6 text-center text-[#182538]" data-ui-component-content="prospect-demo-stage">
        <div className="w-full">
          <p className="text-sm font-semibold" data-ui-copy="heading">The website screenshot is loading.</p>
          <p className="mt-2 text-sm leading-6 text-[#566170]" data-ui-copy="supporting">This presentation remains browser-local. Reload the profile if the screenshot does not appear.</p>
        </div>
      </div>
    );
  }

  const { placement } = profile;
  return (
    <div className="overflow-x-auto bg-[#182538] p-3 sm:p-5" data-ui-component-content="prospect-demo-stage">
      <div className="relative mx-auto min-w-[720px] overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.32)]" style={{ aspectRatio: `${asset.width} / ${asset.height}`, width: "min(100%, 1170px)" }}>
        <img src={url} alt={`Reference screenshot of ${profile.websiteTitle}`} className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain" draggable={false} />
        <section
          className="absolute overflow-auto border-2 border-[#C59E5B]/70 bg-white shadow-[0_18px_42px_rgba(17,27,40,0.28)]"
          style={{
            left: `${placement.x * 100}%`,
            top: `${placement.y * 100}%`,
            width: `${placement.width * 100}%`,
            height: `${placement.height * 100}%`,
            backgroundColor: profile.theme.surface,
            color: profile.theme.text,
          }}
          aria-label={`${profile.firmName} intake preview`}
          data-prospect-demo-intake-overlay
        >
          {children}
        </section>
      </div>
    </div>
  );
}

function ReviewStage({ children }: { children: ReactNode }) {
  return (
    <aside className="min-h-[34rem] bg-[#111D30] p-4 text-white sm:p-6" aria-label="Lawyer review" data-ui-component-content="prospect-demo-review">
      {children}
    </aside>
  );
}

export function ProspectDemoPresentation({ sessionAdapter, registrations, initialProfileId }: Props) {
  const shippedProfiles = registrations ?? EMPTY_REGISTRATIONS;
  const [profiles, setProfiles] = useState<ProspectDemoProfile[]>([]);
  const [selectedId, setSelectedId] = useState(initialProfileId ?? "");
  const [asset, setAsset] = useState<ProspectDemoAsset | null>(null);
  const [view, setView] = useState<ProspectDemoView>("website");
  const [mode, setMode] = useState<ProspectDemoMode>("guided");
  const [scenarioId, setScenarioId] = useState("");
  const [sessionKey, setSessionKey] = useState(0);
  const [status, setStatus] = useState("Loading browser-local prospect previews…");

  const refreshProfiles = useCallback(async () => {
    try {
      await Promise.all(shippedProfiles.map(({ profile, asset: screenshot }) => ensureProspectDemoProfile(profile, screenshot)));
      const nextProfiles = await listProspectDemoProfiles();
      setProfiles(nextProfiles);
      const resolvedId = nextProfiles.some((profile) => profile.id === selectedId)
        ? selectedId
        : initialProfileId && nextProfiles.some((profile) => profile.id === initialProfileId)
          ? initialProfileId
          : nextProfiles[0]?.id ?? "";
      setSelectedId(resolvedId);
      setStatus(resolvedId ? "" : "No prospect profile is available in this browser yet.");
    } catch {
      setStatus("This browser could not open the local prospect preview library.");
    }
  }, [initialProfileId, selectedId, shippedProfiles]);

  useEffect(() => { void refreshProfiles(); }, [refreshProfiles]);

  const profile = useMemo(() => profiles.find((item) => item.id === selectedId) ?? null, [profiles, selectedId]);
  const scenario = profile?.scenarios.find((item) => item.id === scenarioId) ?? profile?.scenarios[0] ?? null;

  useEffect(() => {
    if (!profile) return;
    setView(profile.defaultView);
    setMode(profile.defaultMode);
    setScenarioId(profile.scenarios[0]?.id ?? "");
    setSessionKey((current) => current + 1);
    void readProspectDemoAsset(profile.screenshot.assetId).then(setAsset).catch(() => setAsset(null));
  }, [profile?.id]); // changing prospects starts a fresh presentation session

  const session = useMemo<ProspectDemoSessionContext | null>(() => profile && scenario ? {
    profile,
    scenario,
    mode,
    sessionKey,
  } : null, [mode, profile, scenario, sessionKey]);

  const restart = useCallback(() => {
    if (!session) return;
    sessionAdapter.onRestart?.(session);
    setSessionKey((current) => current + 1);
  }, [session, sessionAdapter]);

  function changeScenario(nextScenarioId: string) {
    setScenarioId(nextScenarioId);
    setSessionKey((current) => current + 1);
  }

  if (!session || !profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F4F3EF] p-6" data-ui-component-content="prospect-demo-empty">
        <div className="w-full border border-[#182538]/15 bg-white p-7 text-[#182538] shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#90734B]">CaseLoad Select prospect preview</p>
          <h1 className="mt-3 text-2xl font-extrabold" data-ui-copy="heading">Set up a browser-local website demo.</h1>
          <p className="mt-3 text-sm leading-6 text-[#566170]" data-ui-copy="body">{status}</p>
        </div>
      </main>
    );
  }

  const intake = sessionAdapter.renderIntake(session);
  const review = sessionAdapter.renderReview(session);

  return (
    <main className="min-h-screen bg-[#F4F3EF] text-[#182538]" data-prospect-demo-presentation>
      <header className="border-b border-[#182538]/15 bg-white px-4 py-4 sm:px-6" data-ui-component-content="prospect-demo-toolbar">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4">
          <div className="w-full">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#90734B]">CaseLoad Select prospect preview</p>
            <h1 className="mt-1 w-full text-xl font-extrabold tracking-[-0.02em] sm:text-2xl" data-ui-copy="heading">{profile.firmName} intake demonstration</h1>
          </div>
          <div className="grid w-full gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="block text-xs font-semibold text-[#374457]">
              Prospect
              <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="mt-1.5 w-full border border-[#182538]/20 bg-white px-3 py-2.5 text-sm text-[#182538] focus:border-[#B28B50] focus:outline-none">
                {profiles.map((item) => <option key={item.id} value={item.id}>{item.firmName}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-[#374457]">
              Fictional client scenario
              <select value={scenario.id} onChange={(event) => changeScenario(event.target.value)} className="mt-1.5 w-full border border-[#182538]/20 bg-white px-3 py-2.5 text-sm text-[#182538] focus:border-[#B28B50] focus:outline-none">
                {profile.scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={restart} className="self-end border border-[#182538] bg-[#182538] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#283A54]">Restart demo</button>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Presentation layout">
            {(Object.keys(VIEW_LABELS) as ProspectDemoView[]).map((item) => (
              <button key={item} type="button" onClick={() => setView(item)} aria-pressed={view === item} className={view === item ? "border border-[#182538] bg-[#182538] px-3 py-2 text-xs font-bold text-white" : "border border-[#182538]/20 bg-white px-3 py-2 text-xs font-bold text-[#374457] hover:border-[#182538]/50"}>{VIEW_LABELS[item]}</button>
            ))}
            <span className="h-8 w-px bg-[#182538]/15" aria-hidden="true" />
            {(["guided", "live-ai"] as ProspectDemoMode[]).map((item) => (
              <button key={item} type="button" onClick={() => { setMode(item); setSessionKey((current) => current + 1); }} aria-pressed={mode === item} className={mode === item ? "border border-[#B28B50] bg-[#F7F1E6] px-3 py-2 text-xs font-bold text-[#765724]" : "border border-[#182538]/20 bg-white px-3 py-2 text-xs font-bold text-[#374457] hover:border-[#182538]/50"}>{item === "guided" ? "Guided sample" : "Live AI"}</button>
            ))}
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-[1440px] p-3 sm:p-5">
        {/** Both sides stay mounted. Layout changes must never discard intake answers. */}
        <div className={view === "split" ? "grid overflow-hidden border border-[#182538]/15 xl:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]" : ""}>
          <div className={view === "review" ? "hidden" : ""} aria-hidden={view === "review"}>
            <ScreenshotStage profile={profile} asset={asset}>{intake}</ScreenshotStage>
          </div>
          <div className={view === "website" ? "hidden" : ""} aria-hidden={view === "website"}>
            <ReviewStage>{review}</ReviewStage>
          </div>
        </div>
      </section>
    </main>
  );
}
