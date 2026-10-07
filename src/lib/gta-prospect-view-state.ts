"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { prospectListReturnPath } from "./gta-prospect-return-path";
import type { EvidenceAvailability, LawyerCountBand, OwnerContactFilter } from "@/lib/gta-prospect-records";
import type { DowntownGeographyStatus } from "@/lib/downtown-toronto-cohort";
import type { AdvertisingActivityState, EvidenceFreshness, QualificationState, QualifiedProspectConfidence } from "@/lib/qualified-gta-prospects";
import type { UnifiedIdentityState, UnifiedProspectQuickView, UnifiedProspectSource } from "@/app/admin/prospects/prospect-unified-view";

export type UnifiedProspectViewState = {
  quickView: UnifiedProspectQuickView; showAdvanced: boolean;
  query: string; profileField: string; profileValue: string; city: string;
  countFilter: "" | "1-10" | "2-3" | LawyerCountBand; customMinimum: string; customMaximum: string;
  practiceArea: string; advertising: EvidenceAvailability | ""; gbp: EvidenceAvailability | "";
  advertisingActivity: AdvertisingActivityState | ""; advertisingSourceType: string;
  gbpOpportunityType: string; websiteOpportunityType: string; intakeChannel: string;
  lawyerCountConfidence: QualifiedProspectConfidence | ""; freshness: EvidenceFreshness | "";
  qualification: QualificationState | ""; cohortId: string; hasOwner: boolean | ""; hasPublicEmail: boolean | "";
  source: UnifiedProspectSource | ""; identity: UnifiedIdentityState | "";
  ownerContact: OwnerContactFilter | ""; downtownGeography: DowntownGeographyStatus | ""; page: number;
};
const defaults: UnifiedProspectViewState = {
  quickView:"all",showAdvanced:false,query:"",profileField:"",profileValue:"",city:"",countFilter:"",customMinimum:"",customMaximum:"",
  practiceArea:"",advertising:"",gbp:"",advertisingActivity:"",advertisingSourceType:"",gbpOpportunityType:"",websiteOpportunityType:"",intakeChannel:"",
  lawyerCountConfidence:"",freshness:"",qualification:"",cohortId:"",hasOwner:"",hasPublicEmail:"",source:"",identity:"",ownerContact:"",downtownGeography:"",page:0,
};
const PREFIX = "up_";
const keys = Object.keys(defaults) as (keyof UnifiedProspectViewState)[];
const enumValues: Partial<Record<keyof UnifiedProspectViewState, readonly string[]>> = {
  quickView:["all","downtown_1_10","shared_registry","audit_ready","identity_review"],
  countFilter:["","1-10","2-3","1","2","3","4-5","6-10","11-20","21-50","51+","unknown"],
  advertising:["","observed","none","unknown"],gbp:["","observed","none","unknown"],
  advertisingActivity:["","observable_current","observable_recent","observable_historical"],
  lawyerCountConfidence:["","high","moderate"],freshness:["","last_30_days","31_to_180_days","older_than_180_days","unknown"],
  qualification:["","qualified","needs_evidence","disqualified"],source:["","shared_registry","research_ledger","reviewed_fixture","legacy_provenance"],
  downtownGeography:["","inside","outside","needs_manual_review"],
  identity:["","linked","reviewed_match","review_needed","provisional"],ownerContact:["","identified","direct_owner_email","needs_direct_email"],
};

export function readUnifiedProspectView(search: URLSearchParams): UnifiedProspectViewState {
  const result = { ...defaults };
  for (const key of keys) {
    const value = search.get(PREFIX + key);
    if (value === null) continue;
    if (key === "page") { if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) result.page = Number(value); }
    else if (key === "showAdvanced") result.showAdvanced = value === "true";
    else if (key === "hasOwner" || key === "hasPublicEmail") { if (value === "true" || value === "false") result[key] = value === "true"; }
    else if (!enumValues[key] || enumValues[key]!.includes(value)) Object.assign(result, { [key]: value });
  }
  return result;
}
export function writeUnifiedProspectView(search: URLSearchParams, state: UnifiedProspectViewState): URLSearchParams {
  const result = new URLSearchParams(search);
  for (const key of keys) {
    if (state[key] === defaults[key]) result.delete(PREFIX + key);
    else result.set(PREFIX + key,String(state[key]));
  }
  return result;
}

/** Restore after hydration; preserve Next history state and unrelated query namespaces. */
export function useUnifiedProspectViewState() {
  const [state,setState] = useState<UnifiedProspectViewState>(defaults);
  const [restored,setRestored] = useState(false);
  const [navigationContext,setNavigationContext] = useState({search:"",hash:""});
  useEffect(() => {
    const restore = () => {
      const {search,hash} = window.location;
      setState(readUnifiedProspectView(new URLSearchParams(search)));
      setNavigationContext({search,hash});
      setRestored(true);
    };
    restore();
    window.addEventListener("popstate",restore);
    return () => window.removeEventListener("popstate",restore);
  },[]);
  useEffect(() => {
    if (!restored) return;
    const url = new URL(window.location.href);
    url.search = writeUnifiedProspectView(url.searchParams,state).toString();
    if (url.href !== window.location.href) window.history.replaceState(window.history.state,"",url);
  },[state,restored]);
  function field<K extends keyof UnifiedProspectViewState>(key: K): readonly [UnifiedProspectViewState[K],Dispatch<SetStateAction<UnifiedProspectViewState[K]>>] {
    return [state[key],action => setState(current => {
      const value = typeof action === "function" ? (action as (previous:UnifiedProspectViewState[K])=>UnifiedProspectViewState[K])(current[key]) : action;
      return Object.is(value,current[key]) ? current : { ...current,[key]:value };
    })];
  }
  const returnSearch = writeUnifiedProspectView(new URLSearchParams(navigationContext.search),state).toString();
  return {field,returnTo:prospectListReturnPath(returnSearch ? "?" + returnSearch : "",navigationContext.hash)};
}
