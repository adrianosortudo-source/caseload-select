import "server-only";
import { Redis } from "@upstash/redis";
import { waitUntil } from "@vercel/functions";
import type { AiProvider } from "./openai";

export const pilotTools = ["design", "message", "voice"] as const;
type PilotTool = typeof pilotTools[number];
type Outcome = "completed" | "degraded" | "failed";
const upperBoundsMs = [1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 14000, 16000,
  18000, 20000, 22000, 24000, 26000, 28000, 30000, 33000, 36000, 40000, 45000,
  50000, 55000, 60000, 70000, 80000, 90000, 105000, 120000];

export function pilotMetricsKey(day: string, tool: PilotTool, provider: AiProvider) {
  return `caseload:public-ai-pilot:daily:v1:${day}:${tool}:${provider}`;
}

const increment = `
for i = 1, #ARGV do redis.call('HINCRBY', KEYS[1], ARGV[i], 1) end
redis.call('EXPIRE', KEYS[1], 3888000)
return 1`;

// Background-only counters have a 45-day TTL. No submitted text, identifiers or raw timestamps.
function record(key: string, fields: string[]) {
  if (process.env.VERCEL_ENV !== "production") return;
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    const redis = new Redis({ url, token, retry: false, enableAutoPipelining: false, signal: () => AbortSignal.timeout(1000) });
    waitUntil(redis.eval(increment, [key], fields).catch(() => undefined));
  } catch { /* Analytics cannot delay or reject an admitted run. */ }
}

export function startPilotMetrics(tool: PilotTool, cohort: AiProvider, startMs: number) {
  const day = new Date(startMs).toISOString().slice(0, 10);
  const cohortKey = pilotMetricsKey(day, tool, cohort);
  record(cohortKey, ["assigned"]);
  let actualKey: string | undefined;
  let finished = false;
  return {
    attempt(provider: AiProvider, firstTurn = false) {
      if (actualKey || finished) return;
      actualKey = pilotMetricsKey(day, tool, provider);
      const fields = ["attempted"];
      if (cohort !== provider) fields.push("fallback_from_openai");
      if (tool === "voice" && firstTurn) fields.push("voice_first_turn");
      record(actualKey, fields);
    },
    finish(outcome: Outcome, voiceEvent?: "voice_profile" | "voice_revision" | "voice_capacity") {
      if (finished) return;
      finished = true;
      if (!actualKey) {
        record(cohortKey, ["preflight_failed"]);
        return;
      }
      const ms = Math.max(0, Date.now() - startMs);
      const boundary = upperBoundsMs.find(upper => ms <= upper) ?? "over";
      const fields = [outcome, "latency_ms_" + boundary];
      if (tool === "voice" && voiceEvent) fields.push(voiceEvent);
      record(actualKey, fields);
    },
  };
}
