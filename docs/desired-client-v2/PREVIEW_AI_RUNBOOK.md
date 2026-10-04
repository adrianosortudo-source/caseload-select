# Desired Client preview AI verification

Use this runbook after a code change to the Desired Client AI flow. Preview verification is required before treating a live-model repair as complete.

## Keep the check isolated

1. Create the Vercel deployment from the task branch and use its protected preview URL.
2. Configure only the Vercel Preview environment. Do not copy preview settings into Production as part of this check.
3. Confirm the existing preview configuration has DESIRED_CLIENT_AI_ENABLED=true, one provider key (GOOGLE_AI_API_KEY or GEMINI_API_KEY), UPSTASH_REDIS_REST_URL, and UPSTASH_REDIS_REST_TOKEN. Enter and read secret values only in Vercel's environment settings. Never paste them into a shell, test fixture, log, issue, or this runbook.
4. If a required setting is unavailable, stop the live test and report which setting is absent by name. Keep the interface's disabled state truthful; do not use a fake provider response as evidence of live AI.
5. Leave Production environment settings and user data untouched. Use the protected Vercel dashboard flow; do not run a direct production deploy or promotion.

## Run the synthetic flow

Use only fictional law-firm and client facts. Never submit client names, matter details, contact details, or confidential information to the model.

1. Open the preview's Desired Client tool and confirm its AI status reports available. If not, record the visible status and stop before submitting answers.
2. Complete one fictional acquisition profile, including at least one unanswered circumstance, so the report can show an evidence gap.
3. Consent to AI follow-ups. Ask one bounded clarification, choose an answer, advance, and confirm the next AI request succeeds with the saved follow-up history.
4. Generate the blueprint. Confirm the response is a valid Desired Client Blueprint, unanswered circumstances remain marked unknown, and the specific client, matter, practical benefit, firm rationale, conditions, progress target, and review period remain in their respective sections.
5. Repeat with negative contribution and zero capacity. Confirm the report keeps those constraints prominent and does not claim that the work is profitable or currently supportable.
6. Save, reload, review, and export the report. Confirm supporting answers and evidence gaps remain intact.

Limit the session to eight top-level AI requests and three follow-ups. Count a retry as a request. Stop after a failed response that reports disabled AI, rate limiting, invalid output, or a provider error; preserve only the request ID and sanitized error code for diagnosis. Never copy answers or generated prose into runtime logs or external reports.

## Record the result

Record the deployment URL and commit, UTC test time, whether availability passed, each operation's HTTP status and sanitized request ID, and which fictional scenario was used. Do not record provider responses, API keys, limiter tokens, or real user data.

Separate these outcomes:

- **Automated checks:** unit, route and browser tests, including any mocked provider response.
- **Live model check:** successful provider-backed follow-up and blueprint generation in the protected preview.
- **Production verification:** repeat only after the reviewed PR has been merged and deployed through GitHub's normal production pipeline.

A passing automated check does not substitute for either live-model or production verification.
