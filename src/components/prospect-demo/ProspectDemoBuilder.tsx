"use client";

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { assetFromImageFile, downloadFile, exportPackageFile, importPackageFile, newProspectDemoId, screenshotDataUrl } from "@/lib/prospect-demo/browser";
import { listProspectDemoProfiles, readProspectDemoAsset, saveProspectDemoProfile } from "@/lib/prospect-demo/store";
import { type ProspectDemoAsset, type ProspectDemoProfile, PROSPECT_DEMO_FORMAT_VERSION } from "@/lib/prospect-demo/types";

interface Props {
  onPresent?(profileId: string): void;
}

const now = () => new Date().toISOString();

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "prospect";
}

function defaultProfile(name: string, asset: ProspectDemoAsset, websiteUrl: string): ProspectDemoProfile {
  const timestamp = now();
  return {
    formatVersion: PROSPECT_DEMO_FORMAT_VERSION,
    id: newProspectDemoId("prospect"),
    slug: slugify(name),
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    firmName: name.trim(),
    websiteTitle: `${name.trim()} website`,
    reference: { url: websiteUrl.trim() || "https://example.invalid", capturedAt: timestamp },
    screenshot: { assetId: asset.assetId, width: asset.width, height: asset.height, mimeType: asset.mimeType },
    placement: { x: 0.08, y: 0.25, width: 0.35, height: 0.62 },
    theme: { accent: "#B28B50", surface: "#FFFFFF", text: "#182538", buttonText: "#FFFFFF" },
    scenarios: [
      { id: "unpaid-invoice", label: "Unpaid invoice", description: "I run a small business and a client has not paid a $28,000 invoice for completed work. I have the signed proposal, invoice, and email thread." },
      { id: "employment-dispute", label: "Employment issue", description: "I was dismissed from a management position after eight years. I received a severance offer yesterday and have been asked to respond this week." },
      { id: "custom", label: "Custom fictional scenario", description: "Describe a fictional situation for this demonstration." },
    ],
    defaultView: "website",
    defaultMode: "guided",
  };
}

export function ProspectDemoBuilder({ onPresent }: Props) {
  const screenshotInput = useRef<HTMLInputElement>(null);
  const replacementInput = useRef<HTMLInputElement>(null);
  const packageInput = useRef<HTMLInputElement>(null);
  const [profiles, setProfiles] = useState<ProspectDemoProfile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [asset, setAsset] = useState<ProspectDemoAsset | null>(null);
  const [assetDirty, setAssetDirty] = useState(false);
  const [firmName, setFirmName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [draft, setDraft] = useState<ProspectDemoProfile | null>(null);
  const [notice, setNotice] = useState("Your profiles and screenshots stay in this browser until you export a package.");
  const selected = useMemo(() => profiles.find((profile) => profile.id === selectedId) ?? null, [profiles, selectedId]);
  const hasUnsavedChanges = useMemo(
    () => assetDirty || Boolean(draft && selected && JSON.stringify(draft) !== JSON.stringify(selected)),
    [assetDirty, draft, selected],
  );

  const refresh = useCallback(async (selectId = selectedId) => {
    const next = await listProspectDemoProfiles();
    setProfiles(next);
    const nextId = next.some((profile) => profile.id === selectId) ? selectId : next[0]?.id ?? "";
    setSelectedId(nextId);
    const profile = next.find((item) => item.id === nextId) ?? null;
    setDraft(profile);
    setAsset(profile ? await readProspectDemoAsset(profile.screenshot.assetId) : null);
    setAssetDirty(false);
  }, [selectedId]);

  useEffect(() => { void refresh().catch(() => setNotice("This browser could not open the local preview library.")); }, [refresh]);

  async function selectProfile(id: string) {
    setSelectedId(id);
    const profile = profiles.find((item) => item.id === id) ?? null;
    setDraft(profile);
    setAsset(profile ? await readProspectDemoAsset(profile.screenshot.assetId) : null);
    setAssetDirty(false);
  }

  async function createFromScreenshot(file: File) {
    try {
      if (!firmName.trim()) throw new Error("Enter the prospect’s firm name before choosing its screenshot.");
      const nextAsset = await assetFromImageFile(file);
      const profile = defaultProfile(firmName, nextAsset, websiteUrl);
      await saveProspectDemoProfile(profile, nextAsset);
      await refresh(profile.id);
      setNotice(`${profile.firmName} is ready. Adjust the gold overlay to cover the old form, then save.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The screenshot could not be used.");
    } finally {
      if (screenshotInput.current) screenshotInput.current.value = "";
    }
  }

  async function replaceScreenshot(file: File) {
    if (!draft || !asset) return;
    try {
      const replacement = await assetFromImageFile(file, asset.assetId);
      const nextProfile: ProspectDemoProfile = {
        ...draft,
        screenshot: {
          assetId: replacement.assetId,
          width: replacement.width,
          height: replacement.height,
          mimeType: replacement.mimeType,
        },
      };
      setAsset(replacement);
      setAssetDirty(true);
      setDraft(nextProfile);
      setNotice("Replacement screenshot is ready. Save the profile to keep it in this browser.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The replacement screenshot could not be used.");
    } finally {
      if (replacementInput.current) replacementInput.current.value = "";
    }
  }

  async function savePlacement() {
    if (!draft || !asset) return;
    try {
      const profile = { ...draft, revision: draft.revision + 1, updatedAt: now() };
      await saveProspectDemoProfile(profile, asset);
      await refresh(profile.id);
      setNotice("Profile settings saved in this browser.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The profile could not be saved.");
    }
  }

  async function exportCurrent() {
    if (!selected || !asset) return;
    try {
      downloadFile(await exportPackageFile(selected, asset));
      setNotice("Exported a portable profile package with the screenshot and settings.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The profile could not be exported.");
    }
  }

  async function importPackage(file: File) {
    try {
      const imported = await importPackageFile(file);
      await saveProspectDemoProfile(imported.profile, imported.asset);
      await refresh(imported.profile.id);
      setNotice(`${imported.profile.firmName} was imported into this browser.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The selected package could not be imported.");
    } finally {
      if (packageInput.current) packageInput.current.value = "";
    }
  }

  async function duplicateCurrent() {
    if (!selected || !asset) return;
    try {
      const timestamp = now();
      const nextAsset = { ...asset, assetId: newProspectDemoId("screenshot") };
      const nextProfile: ProspectDemoProfile = {
        ...selected,
        id: newProspectDemoId("prospect"),
        slug: `${selected.slug}-copy`.slice(0, 120),
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        firmName: `${selected.firmName} copy`,
        screenshot: { ...selected.screenshot, assetId: nextAsset.assetId },
      };
      await saveProspectDemoProfile(nextProfile, nextAsset);
      await refresh(nextProfile.id);
      setNotice("Created a separate browser-local copy. Update its name, screenshot, or placement before presenting it.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The profile could not be duplicated.");
    }
  }

  return (
    <section className="w-full border border-[#182538]/15 bg-white p-5 sm:p-7" data-ui-component-content="prospect-demo-builder">
      <div className="w-full">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#90734B]">Prospect website demo builder</p>
        <h2 className="mt-2 w-full text-2xl font-extrabold tracking-[-0.02em] text-[#182538]" data-ui-copy="heading">Build a working visual preview from a website screenshot.</h2>
        <p className="mt-3 w-full text-sm leading-6 text-[#566170]" data-ui-copy="body">Choose a screenshot, mark the old form area, and use the same presentation with another prospect by switching profiles.</p>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="border border-[#182538]/15 bg-[#F7F5F0] p-4 sm:p-5">
          <h3 className="w-full text-sm font-extrabold text-[#182538]" data-ui-copy="heading">Create or move a profile</h3>
          <div className="mt-4 grid gap-3">
            <label className="block text-xs font-semibold text-[#374457]">Firm name<input value={firmName} onChange={(event) => setFirmName(event.target.value)} placeholder="Walker Law" className="mt-1.5 w-full border border-[#182538]/20 bg-white px-3 py-2.5 text-sm" /></label>
            <label className="block text-xs font-semibold text-[#374457]">Reference website<input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://example.com" type="url" className="mt-1.5 w-full border border-[#182538]/20 bg-white px-3 py-2.5 text-sm" /></label>
            <input ref={screenshotInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void createFromScreenshot(file); }} />
            <button type="button" onClick={() => screenshotInput.current?.click()} className="w-full bg-[#182538] px-4 py-3 text-sm font-bold text-white hover:bg-[#283A54]">Choose screenshot and create profile</button>
            <input ref={packageInput} type="file" accept="application/json,.json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPackage(file); }} />
            <div className="grid gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => packageInput.current?.click()} className="border border-[#182538]/25 bg-white px-3 py-2.5 text-sm font-bold text-[#182538] hover:border-[#182538]">Import package</button>
              <button type="button" onClick={() => void exportCurrent()} disabled={!selected || !asset || hasUnsavedChanges} className="border border-[#182538]/25 bg-white px-3 py-2.5 text-sm font-bold text-[#182538] hover:border-[#182538] disabled:cursor-not-allowed disabled:opacity-50">Export selected</button>
              <button type="button" onClick={() => void duplicateCurrent()} disabled={!selected || !asset || hasUnsavedChanges} className="border border-[#182538]/25 bg-white px-3 py-2.5 text-sm font-bold text-[#182538] hover:border-[#182538] disabled:cursor-not-allowed disabled:opacity-50">Duplicate selected</button>
            </div>
          </div>
          <p className="mt-4 w-full text-xs leading-5 text-[#566170]" data-ui-copy="supporting">{notice}</p>
          <ol className="mt-4 grid gap-1.5 border-t border-[#182538]/15 pt-4 text-xs leading-5 text-[#566170]">
            <li>1. Enter the firm name and choose a screenshot.</li>
            <li>2. Select the saved prospect and place the gold mask over its old form.</li>
            <li>3. Edit the fictional scenarios, then save.</li>
            <li>4. Select Open website demo to launch the presentation in a clean browser tab.</li>
          </ol>
        </div>

        <div className="border border-[#182538]/15 p-4 sm:p-5">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 w-full flex-1 text-xs font-semibold text-[#374457]">Saved prospect
              <select value={selectedId} onChange={(event) => void selectProfile(event.target.value)} className="mt-1.5 w-full border border-[#182538]/20 bg-white px-3 py-2.5 text-sm text-[#182538]">
                <option value="">Choose a profile</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.firmName}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => selected && onPresent?.(selected.id)} disabled={!selected || hasUnsavedChanges} className="w-full border border-[#B28B50] bg-[#F7F1E6] px-4 py-2.5 text-sm font-bold text-[#765724] disabled:opacity-50 sm:w-auto">Open website demo</button>
          </div>
          {hasUnsavedChanges ? <p className="mt-3 w-full text-xs leading-5 text-[#765724]" role="status">Save the profile before presenting, exporting, or duplicating it.</p> : null}
          {draft && asset ? <PlacementEditor draft={draft} asset={asset} replacementInput={replacementInput} onChange={setDraft} onReplace={(file) => void replaceScreenshot(file)} onSave={() => void savePlacement()} /> : <p className="mt-5 w-full text-sm leading-6 text-[#566170]" data-ui-copy="supporting">Choose a saved profile to set its old-form replacement area.</p>}
        </div>
      </div>
    </section>
  );
}

function PlacementEditor({ draft, asset, replacementInput, onChange, onReplace, onSave }: { draft: ProspectDemoProfile; asset: ProspectDemoAsset; replacementInput: RefObject<HTMLInputElement>; onChange(next: ProspectDemoProfile): void; onReplace(file: File): void; onSave(): void }) {
  const [url, setUrl] = useState("");
  const [imageError, setImageError] = useState("");
  useEffect(() => {
    let current = true;
    setUrl("");
    setImageError("");
    void screenshotDataUrl(asset.blob)
      .then((next) => { if (current) setUrl(next); })
      .catch((error: unknown) => { if (current) setImageError(error instanceof Error ? error.message : "The saved screenshot could not be displayed."); });
    return () => { current = false; };
  }, [asset]);
  const setPlacement = (key: keyof ProspectDemoProfile["placement"], value: number) => onChange({ ...draft, placement: { ...draft.placement, [key]: value } });
  const setScenario = (index: number, key: "label" | "description", value: string) => onChange({
    ...draft,
    scenarios: draft.scenarios.map((scenario, scenarioIndex) => scenarioIndex === index ? { ...scenario, [key]: value } : scenario),
  });
  const setFirmName = (value: string) => onChange({
    ...draft,
    firmName: value,
    websiteTitle: value.trim() ? `${value.trim()} website` : draft.websiteTitle,
  });
  const setReferenceUrl = (value: string) => onChange({ ...draft, reference: { ...draft.reference, url: value } });
  const controls: Array<[keyof ProspectDemoProfile["placement"], string, number]> = [["x", "Left", 0], ["y", "Top", 0], ["width", "Width", 5], ["height", "Height", 5]];
  const maximumFor = (key: keyof ProspectDemoProfile["placement"]) => {
    if (key === "x") return Math.max(0, 100 - Math.round(draft.placement.width * 100));
    if (key === "y") return Math.max(0, 100 - Math.round(draft.placement.height * 100));
    if (key === "width") return Math.max(5, 100 - Math.round(draft.placement.x * 100));
    return Math.max(5, 100 - Math.round(draft.placement.y * 100));
  };
  return (
    <div className="mt-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-[#374457]">Prospect name<input value={draft.firmName} onChange={(event) => setFirmName(event.target.value)} className="mt-1.5 w-full border border-[#182538]/20 bg-white px-3 py-2.5 text-sm" /></label>
        <label className="block text-xs font-semibold text-[#374457]">Reference website<input value={draft.reference.url} onChange={(event) => setReferenceUrl(event.target.value)} type="url" className="mt-1.5 w-full border border-[#182538]/20 bg-white px-3 py-2.5 text-sm" /></label>
      </div>
      <input ref={replacementInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onReplace(file); }} />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="w-full text-xs leading-5 text-[#566170]">Replace the screenshot before adjusting its percentage-based form mask.</p>
        <button type="button" onClick={() => replacementInput.current?.click()} className="w-full shrink-0 border border-[#182538]/25 bg-white px-3 py-2.5 text-sm font-bold text-[#182538] hover:border-[#182538] sm:w-auto">Replace screenshot</button>
      </div>
      <div className="relative overflow-hidden bg-[#182538]" style={{ aspectRatio: `${asset.width} / ${asset.height}` }}>
        {url ? <Image src={url} alt="Reference website screenshot" width={asset.width} height={asset.height} unoptimized className="absolute inset-0 h-full w-full object-contain" onError={() => setImageError("The saved screenshot could not be displayed.")} /> : null}
        {imageError ? <p className="absolute inset-0 grid place-items-center bg-[#182538] px-4 text-center text-sm leading-6 text-white" role="alert">{imageError}</p> : null}
        <div className="absolute border-2 border-[#C59E5B] bg-[#C59E5B]/10" style={{ left: `${draft.placement.x * 100}%`, top: `${draft.placement.y * 100}%`, width: `${draft.placement.width * 100}%`, height: `${draft.placement.height * 100}%` }} aria-label="Widget placement" />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {controls.map(([key, label, min]) => <label key={key} className="text-xs font-semibold text-[#374457]">{label}: {Math.round(draft.placement[key] * 100)}%<input type="range" min={min} max={maximumFor(key)} step={1} value={Math.round(draft.placement[key] * 100)} onChange={(event) => setPlacement(key, Number(event.target.value) / 100)} className="mt-2 w-full accent-[#B28B50]" /></label>)}
      </div>
      <div className="mt-5 border-t border-[#182538]/15 pt-5">
        <h3 className="w-full text-sm font-extrabold text-[#182538]" data-ui-copy="heading">Fictional scenarios</h3>
        <div className="mt-3 grid gap-4">
          {draft.scenarios.map((scenario, index) => <div key={scenario.id} className="border border-[#182538]/15 bg-[#F7F5F0] p-3">
            <label className="block text-xs font-semibold text-[#374457]">Scenario name<input value={scenario.label} onChange={(event) => setScenario(index, "label", event.target.value)} className="mt-1.5 w-full border border-[#182538]/20 bg-white px-3 py-2 text-sm" /></label>
            <label className="mt-3 block text-xs font-semibold text-[#374457]">Fictional description<textarea value={scenario.description} onChange={(event) => setScenario(index, "description", event.target.value)} rows={3} className="mt-1.5 w-full resize-y border border-[#182538]/20 bg-white px-3 py-2 text-sm leading-5" /></label>
          </div>)}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={onSave} className="bg-[#182538] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#283A54]">Save profile</button>
        <p className="w-full flex-1 text-xs leading-5 text-[#566170] sm:w-auto">The gold rectangle masks the old form. It is stored as a percentage of the original screenshot, so it remains aligned at every presentation size.</p>
      </div>
    </div>
  );
}
