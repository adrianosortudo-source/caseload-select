import type { ProspectEnrichmentEnvelope } from "../../src/lib/prospect-enrichment-contract";
import { ADAPTER_VERSION, DEFAULT_OUTPUT, SOURCE_NAME, SOURCE_SYSTEM, protocolHash } from "./model";

export type EnrichmentProfile = "legacy-backfill" | "whole-firm";
export const WHOLE_FIRM_PROFILE = {
  adapterVersion: "whole-firm-adapter/v1",
  sourceSystem: "caseload-whole-firm-v1",
  sourceName: "whole-firm-qualification",
  outputRoot: String.raw`D:\00_Work\01_CaseLoad_Select\07_Prospects\Whole_Firm_Enrichment_v1`,
} as const;
export function parseProfile(value: unknown): EnrichmentProfile {
  if (value === undefined || value === "legacy-backfill") return "legacy-backfill";
  if (value === "whole-firm") return value;
  throw Error("unknown_enrichment_profile");
}
export function profileConfig(profile: EnrichmentProfile) {
  return profile === "whole-firm" ? WHOLE_FIRM_PROFILE : { adapterVersion: ADAPTER_VERSION, sourceSystem: SOURCE_SYSTEM, sourceName: SOURCE_NAME, outputRoot: DEFAULT_OUTPUT };
}
export function wholeFirmRunId(sourceManifestSha256: string): string {
  return "run-" + protocolHash([WHOLE_FIRM_PROFILE.sourceSystem, sourceManifestSha256]).slice(0, 48);
}
export function wholeFirmPackageId(runId: string, researchKey: string, originalRevisionContent: unknown): string {
  return "pe-" + protocolHash([WHOLE_FIRM_PROFILE.sourceSystem, runId, researchKey, protocolHash(originalRevisionContent)]);
}

export function assertEnvelopeProfile(envelope: ProspectEnrichmentEnvelope, profile: EnrichmentProfile): void {
  const config = profileConfig(profile);
  if (envelope.sourceSystem !== config.sourceSystem || envelope.sourceName !== config.sourceName || !(profile === "whole-firm" ? /^run-[a-f0-9]{48}$/ : /^backfill-[a-f0-9]{48}$/).test(envelope.runId)) throw Error("envelope_profile_mismatch");
}
