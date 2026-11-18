import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { requestOpenAI, type AiProvider } from "./openai";

// Production deployments share each allowance. The two website tools share one ledger.
const expiresAt = Date.UTC(2026, 11, 9) / 1000;
// Terra permits 922K input tokens. $8/M input covers $2/M long-context input plus
// $5/M long-context cache writes, including a 10% regional premium. $9/M output
// covers the $7.50/M long-context rate and the same premium. Standard tier only.
const maxInput = 922_000;
// Luna's corresponding input, cache write, and output pricing stays under $1/M each.
const policies = {
  websites: { model: "gpt-6.1-terra", budgetMicros: 20_000_000, inputMicros: 8, outputMicros: 9, maxOutput: 8192 },
  voice: { model: "gpt-6-luna", budgetMicros: 10_000_000, inputMicros: 1, outputMicros: 1, maxOutput: 16384 },
};
type Tool = keyof typeof policies;

const reserveScript = `
if tonumber(redis.call('TIME')[1]) >= tonumber(ARGV[1]) then return 0 end
local used = tonumber(redis.call('HGET', KEYS[1], 'used') or 0)
if used + tonumber(ARGV[3]) > tonumber(ARGV[2]) then return 0 end
redis.call('HINCRBY', KEYS[1], 'used', ARGV[3])
redis.call('HSET', KEYS[1], ARGV[4], ARGV[3])
redis.call('EXPIREAT', KEYS[1], ARGV[1])
return 1`;

// Removing the reservation and returning its unused portion are atomic and idempotent.
const settleScript = `
local reserved = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or 0)
if reserved == 0 then return end
local used = redis.call('HINCRBY', KEYS[1], 'used', math.min(reserved, tonumber(ARGV[2])) - reserved)
redis.call('HDEL', KEYS[1], ARGV[1])
return used`;

type Reservation = { tool: Tool; redis: Redis; key: string; id: string; outputLimit: number };
const run = new AsyncLocalStorage<{ first?: Reservation }>();
const guarded = () => process.env.VERCEL_ENV === "production" || process.env.CASELOAD_OPENAI_PILOT_BUDGET === "true";
const expired = () => Date.now() >= expiresAt * 1000;
export const publicPilotGrantExpired = () => guarded() && expired();

export class PublicPilotCapacityError extends Error {
  readonly status = 409;
  constructor() { super("GPT pilot capacity unavailable"); }
}

async function reserve(tool: Tool, outputLimit: number): Promise<Reservation | undefined> {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (expired() || !url || !token) return;
  const id = randomUUID();
  const key = "caseload:openai:" + tool + ":grant-ending-2026-12-09";
  const { inputMicros, outputMicros, budgetMicros } = policies[tool];
  const amount = maxInput * inputMicros + outputLimit * outputMicros;
  try {
    const redis = new Redis({ url, token, retry: false, enableAutoPipelining: false, signal: () => AbortSignal.timeout(1800) });
    if (await redis.eval(reserveScript, [key], [expiresAt, budgetMicros, amount, id]) === 1) {
      return { tool, redis, key, id, outputLimit };
    }
  } catch { console.warn("[public-tool-pilot] reservation unavailable", { tool }); }
}

async function settle(reservation: Reservation, usedMicros: number) {
  try {
    const ledgerUsed = await reservation.redis.eval(settleScript, [reservation.key], [reservation.id, usedMicros]);
    if (reservation.tool === "websites" && typeof ledgerUsed === "number" && Number.isSafeInteger(ledgerUsed) && ledgerUsed >= 0) {
      console.info("[public-tool-pilot] ledger settled", { tool: reservation.tool, usedMicros: ledgerUsed });
    }
  } catch { console.warn("[public-tool-pilot] settlement unconfirmed"); }
}

/** A run that cannot fund its first call stays on Gemini throughout. */
export async function withWebsiteReviewBudget<T>(provider: AiProvider, model: string | undefined, outputLimit: number, review: (provider: AiProvider) => Promise<T>): Promise<T> {
  if (provider === "gemini" || !guarded()) return review(provider);
  const validModel = (model?.trim() || policies.websites.model) === policies.websites.model;
  const first = validModel ? await reserve("websites", outputLimit) : undefined;
  if (!first) {
    console.info("[website-review] GPT pilot unavailable; routing new review to Gemini");
    return review("gemini");
  }
  const context = { first: first as Reservation | undefined };
  try { return await run.run(context, () => review("openai")); }
  finally { if (context.first) await settle(context.first, 0); }
}

/** Every generation, retry, and repair is reserved separately before reaching OpenAI. */
async function requestBudgeted(tool: Tool, request: Parameters<typeof requestOpenAI>[0]) {
  if (!guarded()) return requestOpenAI(request);
  const { model, inputMicros, outputMicros, maxOutput } = policies[tool];
  if (expired() || request.model !== model || !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0 || request.maxOutputTokens > maxOutput) throw new PublicPilotCapacityError();
  const context = tool === "websites" ? run.getStore() : undefined;
  let reservation = context?.first;
  if (reservation && reservation.outputLimit === request.maxOutputTokens) {
    context!.first = undefined;
  } else {
    reservation = await reserve(tool, request.maxOutputTokens);
  }
  if (!reservation || expired()) throw new PublicPilotCapacityError();
  const result = await requestOpenAI({ ...request, serviceTier: "default" });
  const { inputTokens, outputTokens } = result;
  if (Number.isSafeInteger(inputTokens) && inputTokens > 0 && inputTokens <= maxInput &&
      Number.isSafeInteger(outputTokens) && outputTokens > 0 && outputTokens <= request.maxOutputTokens) {
    await settle(reservation, inputTokens * inputMicros + outputTokens * outputMicros);
  }
  return result;
}

export const requestWebsiteOpenAI: typeof requestOpenAI = request => requestBudgeted("websites", request);
export const requestVoiceOpenAI: typeof requestOpenAI = request => requestBudgeted("voice", request);
