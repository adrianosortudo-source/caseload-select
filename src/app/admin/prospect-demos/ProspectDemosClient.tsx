"use client";

import { useEffect, useState } from "react";
import { ProspectDemoBuilder } from "@/components/prospect-demo/ProspectDemoBuilder";
import { walkerLawProspectDemoProfile } from "@/lib/prospect-demo-profiles/walker-law";
import { ensureProspectDemoProfile } from "@/lib/prospect-demo/store";

export function ProspectDemosClient() {
  const [walkerReady, setWalkerReady] = useState(false);
  const [walkerError, setWalkerError] = useState(false);

  useEffect(() => {
    let current = true;
    async function seedWalkerProfile() {
      try {
        const response = await fetch(
          "/prospect-demos/walker-law/walker-law-consultation-reference.png",
          { cache: "force-cache" },
        );
        if (!response.ok) throw new Error(`Screenshot request failed with ${response.status}.`);
        const blob = await response.blob();
        await ensureProspectDemoProfile(walkerLawProspectDemoProfile, {
          assetId: walkerLawProspectDemoProfile.screenshot.assetId,
          blob,
          width: walkerLawProspectDemoProfile.screenshot.width,
          height: walkerLawProspectDemoProfile.screenshot.height,
          mimeType: "image/png",
        });
      } catch {
        if (current) setWalkerError(true);
      } finally {
        if (current) setWalkerReady(true);
      }
    }
    void seedWalkerProfile();
    return () => { current = false; };
  }, []);

  function openStandaloneDemo(profileId: string) {
    window.open(
      `/demo/prospect/${encodeURIComponent(profileId)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <div>
      <div className="border-b border-[#182538]/15 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto w-full max-w-[1440px]">
          <p className="w-full text-xs leading-5 text-[#566170]">
            Build profiles here. Each website demonstration opens in its own clean browser tab.
          </p>
        </div>
      </div>
      <main className="min-h-screen bg-[#F4F3EF] p-4 sm:p-6">
        <div className="mx-auto w-full max-w-[1440px]">
          {!walkerReady ? (
            <p className="mb-4 w-full border border-[#182538]/15 bg-white p-4 text-sm text-[#566170]" role="status">
              Preparing the browser-local demo library.
            </p>
          ) : null}
          {walkerError ? (
            <p className="mb-4 w-full border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="status">
              The built-in Walker Law screenshot could not load. Existing saved profiles remain available.
            </p>
          ) : null}
          {walkerReady ? <ProspectDemoBuilder onPresent={openStandaloneDemo} /> : null}
        </div>
      </main>
    </div>
  );
}
