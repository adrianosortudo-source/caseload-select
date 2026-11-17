# Public GPT pilot operations

The two website reviews share a US$20 grant allowance. Tone of Voice has a separate US$10 allowance. Production enforces both through **December 9, 2026 at 00:00 UTC**. Every GPT call and repair reserves its worst-case cost before it begins. A timeout can keep the whole reservation. The `used` balance therefore measures committed and conservatively estimated usage. The OpenAI project dashboard supplies actual billed usage.

## Production controls

| Feature | Provider | Eligible traffic | Funded model |
|---|---|---|---|
| Website Design Review | `WEBSITE_DESIGN_CHECK_PROVIDER=openai` | `WEBSITE_DESIGN_CHECK_OPENAI_PERCENT=10` | `gpt-6.1-terra` |
| Website Message Review | `POSITIONING_CHECK_PROVIDER=openai` | `POSITIONING_CHECK_OPENAI_PERCENT=10` | `gpt-6.1-terra` |
| Tone of Voice | `FIRM_VOICE_BUILDER_PROVIDER=openai` | `FIRM_VOICE_BUILDER_OPENAI_PERCENT=10` | `gpt-6-luna` |

Apply percentages through the normal reviewed deployment path. To expand one feature, change its percentage to 50, observe again, then move to 100 when approved. To roll it back, explicitly set its percentage to 0 or its provider to `gemini`. Removing a percentage on an enabled GPT feature sets it to 100. Website runs keep their chosen provider until they finish. On Voice rollback, a GPT session receives a reload prompt and the visitor reviews the provider before resuming.

Production uses the existing server-side `CASELOAD_OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. A branch preview can explicitly exercise the same budget with `CASELOAD_OPENAI_PILOT_BUDGET=true` and the same protected Redis database. Daily traffic metrics count Vercel production only.

## Read daily usage

From the app checkout, provide the pilot Redis URL and preferably a read-only token in `UPSTASH_REDIS_REST_READ_ONLY_TOKEN`. The script issues only `HGETALL` commands. Dates are inclusive and in UTC.

```sh
node --conditions=react-server --import tsx scripts/read-public-pilot-metrics.ts 2026-11-17 2026-11-23
```

Each hash uses the UTC date on which the request began. For example, these Redis commands read November 17 website activity and the committed grant balances in millionths of a US dollar.

```text
HGETALL caseload:public-ai-pilot:daily:v1:2026-11-17:design:openai
HGET caseload:openai:websites:grant-ending-2026-12-09 used
HGET caseload:openai:voice:grant-ending-2026-12-09 used
```

Daily hashes expire after 45 days. They contain counts grouped by tool (`design`, `message`, `voice`) and provider (`openai`, `gemini`). The writer accepts no website address, transcript, IP, session ID or API key as a metric. Background writes are best effort. An absent hash can mean no eligible traffic or unavailable telemetry.

- **Assigned** counts eligible requests after initial validation and rate limits. **Attempted** counts runs admitted to provider processing, including model credential or capacity failures. Website fallback runs are counted under their original assignment and their actual attempted provider. `fallbackFromOpenAI` is reported on Gemini.
- **Completed** counts full successful reports or Voice turns. **Degraded** counts a returned Design report missing at least one visual rubric, or a Message report returned with partial evidence coverage. **Failed** counts an unsuccessful attempted run. **Preflight failed** covers a failure before provider processing, such as an unreadable website.
- **p95** reports the upper edge in milliseconds of the first latency bucket containing at least 95% of finished attempts, measured from HTTP handler entry. It includes rendering and collection for website reports. The last bucket is open above 120 seconds. Missing timings return null.
- **Voice** counts first-turn requests and deliveries of complete first profiles and revisions. A revision requires an earlier interviewer entry with a complete profile. The counts include repeat submissions.
- **Attempted minus outcomes** helps identify incomplete records. Check complete UTC days because in-flight requests or failed background writes can temporarily leave a gap.

## Decide whether to expand

Compare each feature against its simultaneous Gemini group over complete UTC days at the same rollout setting. Keep transition days separate when changing the percentage. As a proposed minimum, wait for 30 finished attempts per provider and more than one day of traffic. For Voice, compare first-profile and revision deliveries too. Sparse profile counts call for additional observation and a synthetic full-interview check.

Review delivered, degraded and failed rates, preflight failures, fallback counts, p95 latency and actual daily project spend. Investigate any missing outcome counts or substantial coverage losses. Hold at 10% if GPT p95 exceeds 120% of Gemini, reliability deteriorates, a critical quality or privacy issue appears, or the remaining credit cannot cover the next step. Bucket rounding can make a close latency comparison inconclusive. Use the existing blinded fixture checks and direct staff examples for content quality. These counters retain no review output. Check the grant balance at 50% and 80% of each allowance and before increasing traffic.
