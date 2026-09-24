import "server-only";

import type { NextRequest } from "next/server";
import { constantTimeEquals } from "@/lib/cron-auth";

const MINIMUM_AGENT_TOKEN_BYTES = 32;

/** Reuse the existing dedicated prospect-agent credential and constant-time comparison. */
export function isProspectEnrichmentAgentAuthorized(request: NextRequest): boolean {
  const expected = process.env.GTA_PROSPECT_AGENT_DRAFT_TOKEN;
  const authorization = request.headers.get("authorization");
  if (
    typeof expected !== "string"
    || Buffer.byteLength(expected, "utf8") < MINIMUM_AGENT_TOKEN_BYTES
    || !authorization?.startsWith("Bearer ")
  ) return false;
  const presented = authorization.slice("Bearer ".length).trim();
  return Boolean(presented) && constantTimeEquals(presented, expected);
}

/** Actor identity is server-configured; callers can never select another actor. */
export function prospectEnrichmentAgentActor(): string {
  const configured = process.env.GTA_PROSPECT_AGENT_DRAFT_ACTOR?.trim().toLocaleLowerCase("en-CA") ?? "authorized-agent";
  return /^[-_a-z0-9]{1,120}$/.test(configured) ? configured : "authorized-agent";
}
