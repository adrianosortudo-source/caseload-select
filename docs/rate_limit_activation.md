# Rate-limit activation (APP-007)

Code shipped 2026-05-14 in `src/lib/rate-limit.ts`. Five public POST routes
are now wired through the limiter:

| Route | Bucket | Limit | Window |
|---|---|---|---|
| `/api/portal/request-link` | `requestLink` | 5 | 10 min |
| `/api/intake-v2` | `intake` | 30 | 1 min |
| `/api/voice-intake` | `intake` | 30 | 1 min |
| `/api/screen` | `screen` | 30 | 1 min |
| `/api/firm-onboarding/[token]/submit` | `firmOnboarding` | 10 | 1 hr |

Rate limiting is **inactive** until you provision Upstash Redis and set
two env vars in Vercel. Until then the limiter logs a one-time warn at
cold start and returns `ok: true` on every check (fail-open). The deploy
is safe today; activating the limits is a separate operator step that can
happen at any time without a code change.

## Provisioning (one-time, ~5 minutes)

1. Go to:
```
https://console.upstash.com/redis
```

2. Click **Create Database**:
   - Name: `caseload-select-ratelimit`
   - Type: Regional (cheaper, sufficient for this workload)
   - Region: `us-east-1` (closest to the Vercel us-east region we deploy in)
   - Eviction: Enabled (default)
   - Free tier: yes

3. After creation, scroll to **REST API** section. Copy these two values:
   - `UPSTASH_REDIS_REST_URL` (looks like `https://us1-graceful-wolf-12345.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN` (a long base64-ish string)

4. Add both to Vercel Production env vars:
```
https://vercel.com/adrianosortudo-7282s-projects/caseload-select/settings/environment-variables
```

Set scope to **Production** only (the Preview environment can stay
fail-open during PR previews — we don't want PR test traffic to count
against the production buckets, and we don't want PR test traffic to be
limited either).

5. Redeploy production (env var changes don't take effect until the next
   build). Either push a commit, or use the Vercel dashboard's
   `Redeploy` button on the current production deployment.

## Verification

After the redeploy, the cold-start log line:

```
[rate-limit] UPSTASH_REDIS_REST_URL / TOKEN not set; rate limiting is FAIL-OPEN. Set both env vars in Vercel to engage limits.
```

should NOT appear in Vercel function logs. You can also tell directly by
checking the response headers on a `/api/intake-v2` call (any method;
the limiter runs before any of the body validation):

```
curl -i -X OPTIONS https://app.caseloadselect.ca/api/intake-v2 -H 'Origin: https://app.caseloadselect.ca'
```

Once active, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset` headers will be present.

## Tuning

The bucket sizes were picked for current scale (zero real lead traffic
yet, busy intake form maxes at ~5 calls/minute under normal use). If
real traffic patterns invalidate any bucket:

- Edit `BUCKET_CONFIG` in `src/lib/rate-limit.ts`
- Push to main; Vercel rebuilds; limits update on next cold start
- No Upstash console changes required — the bucket config lives in code

Free tier (10,000 commands/day) covers ~6,500 limit checks per day across
all five routes; comfortably above any realistic intake volume for the
next year.

## Failure modes

If Upstash has an outage and the limiter errors mid-request, the helper
catches the error, logs it, and returns `ok: true` (fail-open). Intake
keeps working; the operator sees a `[rate-limit] backing-store error`
line in Vercel logs. This is intentional — never block intake on a
limiter hiccup.

## Disabling without removing the code

To temporarily disable limits without removing the wiring, delete both
env vars in Vercel and redeploy. The limiter goes back to fail-open mode
on the next cold start. Re-enable by re-adding the env vars.
