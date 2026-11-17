import { Redis } from "@upstash/redis";
import { pilotMetricsKey, pilotTools } from "../src/lib/ai/public-pilot-metrics";

const usage = "Usage: node --conditions=react-server --import tsx scripts/read-public-pilot-metrics.ts YYYY-MM-DD [YYYY-MM-DD]";
const dayMs = 86_400_000;

function parseDay(s: string | undefined) {
  const ms = Date.parse(s + "T00:00:00Z");
  if (!s || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== s) throw new Error("Use a valid UTC calendar date.");
  return ms;
}

function percentile95(totals: Record<string, number>) {
  const buckets = Object.entries(totals)
    .filter(([f]) => /^latency_ms_(?:\d+|over)$/.test(f))
    .map(([f, n]) => ({ upper: f === "latency_ms_over" ? Infinity : Number(f.slice(11)), n }))
    .sort((a, b) => a.upper - b.upper);
  const target = Math.ceil(buckets.reduce((sum, b) => sum + b.n, 0) * .95);
  if (!target) return null;
  let cumulative = 0;
  for (const b of buckets) {
    cumulative += b.n;
    if (cumulative >= target) return Number.isFinite(b.upper) ? b.upper : ">120000";
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log(usage); return; }
  if (args.length < 1 || args.length > 2) throw new Error(usage);
  const start = parseDay(args[0]), end = parseDay(args[1] ?? args[0]);
  if (end < start || end - start >= 45 * dayMs) throw new Error("Use an inclusive range of 1 to 45 days.");
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_READ_ONLY_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Configure the pilot Redis REST URL and a read token.");
  const redis = new Redis({ url, token, retry: false, signal: () => AbortSignal.timeout(8000) });
  const days = Array.from({ length: 1 + (end - start) / dayMs }, (_, i) => new Date(start + i * dayMs).toISOString().slice(0, 10));
  const rows = [];
  for (const tool of pilotTools) {
    for (const provider of ["gemini", "openai"] as const) {
      const batch = redis.pipeline();
      for (const day of days) batch.hgetall(pilotMetricsKey(day, tool, provider));
      const results = await batch.exec<(Record<string, number | string> | null)[]>();
      const totals: Record<string, number> = {};
      for (const result of results) {
        for (const [f, value] of Object.entries(result ?? {})) {
          const n = Number(value);
          if (Number.isSafeInteger(n) && n > 0) totals[f] = (totals[f] ?? 0) + n;
        }
      }
      const attempted = totals.attempted ?? 0, completed = totals.completed ?? 0;
      const degraded = totals.degraded ?? 0, failed = totals.failed ?? 0;
      rows.push({ tool, provider, assigned: totals.assigned ?? 0, attempted, completed, degraded, failed,
        preflightFailed: totals.preflight_failed ?? 0, fallbackFromOpenAI: totals.fallback_from_openai ?? 0,
        attemptedMinusOutcomes: attempted - completed - degraded - failed, p95MsUpper: percentile95(totals),
        ...(tool === "voice" && { firstTurns: totals.voice_first_turn ?? 0, profiles: totals.voice_profile ?? 0,
          revisions: totals.voice_revision ?? 0, capacityUnavailable: totals.voice_capacity ?? 0 }),
      });
    }
  }
  console.log(JSON.stringify({ startUTC: days[0], endUTC: days.at(-1), rows }, null, 2));
}

main().catch(error => {
  // Credentials and unexpected provider error details must not enter command output.
  const known = [usage, "Use a valid UTC calendar date.", "Use an inclusive range of 1 to 45 days.", "Configure the pilot Redis REST URL and a read token."];
  console.error(error instanceof Error && known.includes(error.message) ? error.message : "Could not read the pilot counters from Redis.");
  process.exitCode = 1;
});
