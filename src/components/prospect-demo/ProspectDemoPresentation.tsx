"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { screenshotDataUrl } from "@/lib/prospect-demo/browser";
import styles from "./ProspectDemoPresentation.module.css";
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
  /** Never substitute another browser-local profile when a direct presentation URL is missing. */
  strictInitialProfile?: boolean;
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
  const [imageError, setImageError] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setImageError(false);
    if (!asset) {
      return;
    }
    void screenshotDataUrl(asset.blob)
      .then((nextUrl) => { if (active) setUrl(nextUrl); })
      .catch(() => { if (active) setImageError(true); });
    return () => { active = false; };
  }, [asset]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const width = canvas.clientWidth;
      // A hidden Lawyer view must not change the active intake's layout or state.
      if (width > 0) setCanvasWidth(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const { placement } = profile;
  const screenshot = asset ?? profile.screenshot;
  const imageAvailable = Boolean(url) && !imageError;
  const compact = !imageAvailable || canvasWidth * placement.width < 320;
  const sourceRatio = screenshot.height / screenshot.width;
  const formStart = sourceRatio * placement.y;
  const formHeight = sourceRatio * placement.height;
  const formEnd = formStart + formHeight;
  const remainingHeight = Math.max(0, sourceRatio - formEnd);

  function screenshotSlice(start: number, height: number, description: string) {
    return (
      <div className={styles.screenshotSlice} style={{ aspectRatio: `1 / ${height}` }} aria-hidden="true">
        {imageAvailable && <Image src={url!} alt={description} width={screenshot.width} height={screenshot.height} unoptimized loading="eager" className={styles.screenshotImage} style={{ top: `${-(start / height) * 100}%` }} draggable={false} onError={() => setImageError(true)} />}
      </div>
    );
  }

  return (
    <div ref={canvasRef} className={styles.websiteStage} style={{ backgroundColor: profile.theme.surface }} data-ui-component-content="prospect-demo-stage" data-prospect-demo-stage-layout={compact ? "focused" : "website"}>
      {!imageAvailable && <div className="w-full border-b border-[#182538]/15 bg-[#F3F0E9] p-4 text-[#182538]" role="status" data-ui-component-content="prospect-demo-image-status">
        <p className="w-full text-sm leading-6" data-ui-copy="supporting">{imageError ? "The website screenshot could not load. The intake remains available below." : "Loading the website screenshot. You can begin the intake below."}</p>
      </div>}
      {imageAvailable && formStart > 0 && screenshotSlice(0, formStart, `Top of ${profile.websiteTitle}`)}
      <div className={styles.formRegion} style={{ minHeight: compact ? undefined : canvasWidth * formHeight }}>
        {!compact && imageAvailable && <div className={styles.formBackdrop} style={{ height: canvasWidth * formHeight }} aria-hidden="true">
          <Image src={url!} alt="" width={screenshot.width} height={screenshot.height} unoptimized loading="eager" className={styles.screenshotImage} style={{ top: -(canvasWidth * formStart) }} draggable={false} onError={() => setImageError(true)} />
        </div>}
        <section
          className={styles.intake}
          style={{
            marginLeft: compact ? 0 : `${placement.x * 100}%`,
            width: compact ? "100%" : `${placement.width * 100}%`,
            minHeight: compact ? undefined : canvasWidth * formHeight,
            backgroundColor: profile.theme.surface,
            color: profile.theme.text,
          }}
          aria-label={`${profile.firmName} intake preview`}
          data-prospect-demo-intake-overlay
        >
          {children}
        </section>
      </div>
      {imageAvailable && remainingHeight > 0 && screenshotSlice(formEnd, remainingHeight, `Bottom of ${profile.websiteTitle}`)}
    </div>
  );
}

function ReviewStage({ children }: { children: ReactNode }) {
  return (
    <aside className="min-w-0 bg-[#111D30] p-3 text-white sm:p-5" aria-label="Lawyer review" data-ui-component-content="prospect-demo-review">
      {children}
    </aside>
  );
}

export function ProspectDemoPresentation({
  sessionAdapter,
  registrations,
  initialProfileId,
  strictInitialProfile = false,
}: Props) {
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
      const initialProfileIsAvailable = Boolean(
        initialProfileId && nextProfiles.some((profile) => profile.id === initialProfileId),
      );
      const resolvedId = nextProfiles.some((profile) => profile.id === selectedId)
        ? selectedId
        : initialProfileIsAvailable
          ? initialProfileId!
          : strictInitialProfile
            ? ""
            : nextProfiles[0]?.id ?? "";
      setSelectedId(resolvedId);
      setStatus(
        resolvedId
          ? ""
          : strictInitialProfile
            ? "This demonstration is not saved in this browser. Return to the prospect demo builder, save or import the profile, then open it again."
            : "No prospect profile is available in this browser yet.",
      );
    } catch {
      setStatus("This browser could not open the local prospect preview library.");
    }
  }, [initialProfileId, selectedId, shippedProfiles, strictInitialProfile]);

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

  if (!session || !profile || !scenario) {
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
            <h1 className="mt-1 w-full text-pretty text-[17px] font-extrabold leading-snug tracking-[-0.02em] sm:text-2xl" data-ui-copy="heading">{profile.firmName} intake preview</h1>
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

      <section className={styles.presentationBody}>
        {/** Both sides stay mounted. Layout changes must never discard intake answers. */}
        <div className={`${styles.panels} ${view === "split" ? styles.split : ""}`}>
          <div className={view === "review" ? "hidden" : "min-w-0"} aria-hidden={view === "review"}>
            <ScreenshotStage profile={profile} asset={asset}>{intake}</ScreenshotStage>
          </div>
          <div className={view === "website" ? "hidden" : "min-w-0"} aria-hidden={view === "website"}>
            <ReviewStage>{review}</ReviewStage>
          </div>
        </div>
      </section>
    </main>
  );
}
