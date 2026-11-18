# Public GPT pilot operations

The two website reviews share a US$20 grant allowance. Tone of Voice has a separate US$10 allowance. Why Choose Your Firm, Best Case Profile and the fictional SCREEN demo share a third allowance of US$10 in total. New GPT calls stop at **December 9, 2026 at 00:00 UTC**. Every GPT call and repair reserves its worst-case cost before it begins. A timeout can keep the whole reservation. The `used` balance therefore measures committed and conservatively estimated usage. The OpenAI project dashboard supplies actual billed usage.

## Approved production settings

| Feature | Provider | Eligible traffic | Funded model |
|---|---|---|---|
| Website Design Review | `WEBSITE_DESIGN_CHECK_PROVIDER=openai` | `WEBSITE_DESIGN_CHECK_OPENAI_PERCENT=100` | `gpt-6.1-terra` |
| Website Message Review | `POSITIONING_CHECK_PROVIDER=openai` | `POSITIONING_CHECK_OPENAI_PERCENT=100` | `gpt-6.1-terra` |
| Tone of Voice | `FIRM_VOICE_BUILDER_PROVIDER=openai` | `FIRM_VOICE_BUILDER_OPENAI_PERCENT=10` | `gpt-6-luna` |
| Why Choose Your Firm (claim tightening) | `WHY_YOUR_FIRM_ASSIST_PROVIDER=openai` | `WHY_YOUR_FIRM_ASSIST_OPENAI_PERCENT=10` | `gpt-6-luna` |
| Best Case Profile | `DESIRED_CLIENT_PROVIDER=openai` | `DESIRED_CLIENT_OPENAI_PERCENT=10` | `gpt-6-luna` |

Both website reviews assign every eligible new run to GPT. When the shared allowance cannot fund the first call, the store is unavailable, or the grant expires, a new review uses Gemini. Each review keeps its provider through both visual rubrics or a report repair. Any further GPT call still requires a reservation.

Apply percentage changes through the reviewed deployment path. To roll back either website review independently, explicitly set its percentage to 0 or its provider to `gemini`. Removing a percentage on an enabled GPT feature sets it to 100. Tone of Voice stays at 10% of eligible new sessions. On Voice rollback or grant expiry, a GPT session receives a reload prompt and the visitor reviews the provider before resuming.

Production uses the existing server-side `CASELOAD_OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. A branch preview can explicitly exercise the same budget with `CASELOAD_OPENAI_PILOT_BUDGET=true` and the same protected Redis database. Daily traffic metrics count Vercel production only.

## Assisted writing and public SCREEN pilot controls

Why Choose qualified for the 10% pilot after an independent review of 30 fictional examples. The reviewer accepted 27 rewrites, found no critical invented claims and confirmed that the tool flagged all ten unsupported rankings. Three otherwise grounded rewrites omitted a detail. To confirm activation, open Why Choose from the public Tools menu in a fresh browser session, check the named recipient, and submit a fictional claim in an OpenAI-assigned session. Check the returned suggestion and the `public-tools` ledger settlement for that deployment.

For Best Case, the final staff replay delivered all 30 fictional profiles. The independent reviewer accepted all 30 profiles and 29 follow-ups, with zero critical findings. One follow-up asked about the client's behaviour when the worksheet asked about the firm's supporting evidence. In 15 profiles, the app used worksheet wording for one or more fields. The report identifies those fields in the saved and exported versions. A report reconstructed entirely from the worksheet is available separately as a structured draft. To check the 10% pilot, complete a fictional worksheet in an OpenAI-assigned session, verify the returned profile and match the deployment's `public-tools` settlement.

The public SCREEN opt-in uses `SCREEN_DEMO_AI_PROVIDER` and `SCREEN_DEMO_AI_OPENAI_PERCENT`. The page discloses the assigned recipient before the visitor chooses whether to send fictional details. A change of cohort or provider requires a fresh disclosure. An unchecked demo runs locally.

Why Choose uses `WHY_YOUR_FIRM_ASSIST_PROVIDER` and `WHY_YOUR_FIRM_ASSIST_OPENAI_PERCENT`. Best Case uses `DESIRED_CLIENT_PROVIDER` and `DESIRED_CLIENT_OPENAI_PERCENT`. Each tool discloses the assigned recipient before the visitor submits. Why Choose keeps the editable claim when the suggestion is unavailable. Best Case keeps the worksheet and structured draft. Every paid suggestion, clarification, report and repair reserves from the same allowance as the public SCREEN demo.

For the approved pilot, deploy the percentage-aware code first, then configure the shared US$10 allowance and the 10% setting for each approved tool. Set each provider to `openai` only after verifying those settings. A random HTTP-only session cookie keeps a browser in its cohort across reloads and network changes. The public menu and its app embeds share the same site. For a partial rollout, a POST missing its session cookie is eligible only for Gemini and must match that disclosure. In the daily counts, `why` covers rewrite attempts and `best` covers blueprint attempts. Follow-up requests draw from the wallet separately.

Production needs a separately approved dollar amount in `CASELOAD_PUBLIC_TOOLS_PILOT_USD` and an explicit percentage to assign a visitor to GPT. An absent amount or percentage keeps the new pilot off. Apply the same controls to a protected preview with `CASELOAD_OPENAI_PILOT_BUDGET=true`. Eligible public tools share one grant-period allowance, so increasing a single tool's percentage can reduce the capacity available to the others. Set its percentage to zero to roll back that tool.

Every extraction, option mapping call and retry reserves the maximum input plus its output limit before calling the funded model `gpt-6-luna`. The largest reservation is US$0.926096. Missing storage, an exhausted allowance or grant expiry blocks new GPT calls. A visitor who consented to OpenAI can continue the simulation locally. The private intake and transcription controls are independent.

## Read daily usage

From the app checkout, provide the pilot Redis URL and preferably a read-only token in `UPSTASH_REDIS_REST_READ_ONLY_TOKEN`. The script issues only `HGETALL` commands. Dates are inclusive and in UTC.

```sh
node --conditions=react-server --import tsx scripts/read-public-pilot-metrics.ts 2026-11-17 2026-11-23
```

For the daily website budget check, filter the app’s production runtime logs for `[public-tool-pilot] ledger settled` and `websites`. The latest `usedMicros` is the shared balance at that settlement, including outstanding reservations. Divide by 1,000,000 for US dollars and compare with the US$20 allowance. Record the timestamp with the balance. If there is no recent settlement, use the production app’s configured Redis to read the current balance.

Each hash uses the UTC date on which the request began. For example, these Redis commands read November 17 website activity and the committed grant balances in millionths of a US dollar.

```text
HGETALL caseload:public-ai-pilot:daily:v1:2026-11-17:design:openai
HGET caseload:openai:websites:grant-ending-2026-12-09 used
HGET caseload:openai:voice:grant-ending-2026-12-09 used
HGET caseload:openai:public-tools:grant-ending-2026-12-09 used
```

Daily hashes expire after 45 days. They contain counts grouped by tool (`design`, `message`, `voice`, `screen-demo`, `why`, `best`) and provider (`openai`, `gemini`). The writer accepts no website address, transcript, IP, session ID or API key as a metric. Background writes are best effort. An absent hash can mean no eligible traffic or unavailable telemetry.

SCREEN counts accepted opt-in requests. A completed request returned live extraction and any requested option mapping. A degraded request returned to the simulator with one of those model steps unavailable. A handler exception counts as failed. Opening the page or running the simulation locally increments no provider counter.

- **Assigned** counts eligible requests after initial validation and rate limits. **Attempted** counts runs admitted to provider processing, including model credential or capacity failures. Website fallback runs are counted under their original assignment and their actual attempted provider. `fallbackFromOpenAI` is reported on Gemini.
- **Completed** counts full successful reports or Voice turns. **Degraded** counts a returned Design report missing at least one visual rubric, or a Message report returned with partial evidence coverage. **Failed** counts an unsuccessful attempted run. **Preflight failed** covers a failure before provider processing, such as an unreadable website.
- **p95** reports the upper edge in milliseconds of the first latency bucket containing at least 95% of finished attempts, measured from HTTP handler entry. It includes rendering and collection for website reports. The last bucket is open above 120 seconds. Missing timings return null.
- **Voice** counts first-turn requests and deliveries of complete first profiles and revisions. A revision requires an earlier interviewer entry with a complete profile. The counts include repeat submissions.
- **Attempted minus outcomes** helps identify incomplete records. Check complete UTC days because in-flight requests or failed background writes can temporarily leave a gap.

## Monitor the website reviews and evaluate the Voice pilot

At 100%, compare each website review with its earlier baseline over complete UTC days and count budget fallbacks separately. Check the two reviews’ combined spending against the US$20 allowance. For Tone of Voice, compare its simultaneous GPT and Gemini groups and keep transition days separate. Before expanding Voice, the proposed minimum is 30 finished attempts per provider and more than one day of traffic. Compare first-profile and revision deliveries too. Sparse profile counts call for additional observation and a synthetic full-interview check.

Review delivered, degraded and failed rates, preflight failures, fallback counts, p95 latency and actual daily project spend. Investigate any missing outcome counts or substantial coverage losses. Hold Voice at 10% if GPT p95 exceeds 120% of Gemini, reliability deteriorates, a critical quality or privacy issue appears, or the remaining credit cannot cover the next step. Bucket rounding can make a close latency comparison inconclusive. Use the existing blinded fixture checks and direct staff examples for content quality. These counters retain no review output. Check the grant balance at 50% and 80% of each allowance and before increasing traffic.
