# RUNBOOK — Render isolation deploy (Website Design & Conversion Check)

**Version:** v1 · 2026-08-07
**For:** @devops (Gage)
**Branch this ships from:** `feat/render-isolation` (local only, never pushed;
worktree `.claude/worktrees/render-isolation`), branched from
`feat/website-design-check-deploy` @ `7f1739d3`
**Related:** `docs/BUILD_PLAN_render_isolation_v1.md` (what was built and why),
`Version3_CaseLoadSelect/CaseLoadSelect_RendererIsolation_Spec_2026-08-07.md`
(the engineering spec), `Version3_CaseLoadSelect/CaseLoadSelect_DevOps_Handoff_2026-08-07.md`
(the original branch-state handoff this supersedes for the design-check
branch specifically)

**Do not execute any step below without reading it in full first.** Several
steps are destructive-adjacent (production env var changes, a merge to
`main`) and this document is written for someone else to run, not for the
agent that wrote it. Push, PR, merge, and deploy are @devops's authority per
the repo's standing rule — nothing in this runbook should be executed by an
agent.

---

## 0. What state this branch is in

`feat/render-isolation` is **isolation-ready, not launch-ready.** Every
acceptance criterion in `docs/BUILD_PLAN_render_isolation_v1.md` §5 that can
be verified locally has been (see the build's own report for the full
pass/fail table). What it has **not** been through: a real Vercel deployment,
a real cold start, a real render under `@sparticuz/chromium` on Vercel's
actual Linux runtime, or a real network hop between two live services. That
is what this runbook exists to do. Do not merge or launch on the strength of
local verification alone — serverless rendering under this isolated
architecture has never run in production.

---

## 1. Create the render service as its own Vercel project

1. In the Vercel dashboard (or `vercel` CLI **from this repo's checkout on
   the machine you deploy from, never from a duplicate checkout under
   `05_Product`** — see the standing hazard note in the DevOps handoff),
   create a **new** project, not a new environment of the existing app.
   Suggested name: `caseload-render`.
2. **Root Directory:** `services/render`. This is the setting that makes
   Vercel treat `services/render/` as the project root — its own
   `package.json`, its own `vercel.json` (sets `maxDuration: 300` on
   `api/render.ts`), its own dependency tree
   (`playwright-core`, `@sparticuz/chromium@149.0.0`, `undici`).
3. **Framework preset:** none / "Other". This is a plain Node.js Serverless
   Function project (`api/render.ts` exports a Node-http-style handler), not
   Next.js. Do not let Vercel auto-detect Next.js from the parent repo.
4. **Environment variables: set NONE beyond `RENDER_SERVICE_TOKEN` (step 2
   below).** This is the entire point of the isolation. Do not copy any
   environment-variable group from the main `caseload-select` project. If
   Vercel offers to "link" or "inherit" env vars from another project in this
   team, decline. `services/render/auth.ts`'s `assertNoApplicationSecrets`
   will make every request fail loudly (visible in function logs) if any of
   the eight known application-secret names below is present, but that is a
   safety net, not a substitute for a clean env var list at project creation:

   | Never set on this project |
   |---|
   | `SUPABASE_SERVICE_ROLE_KEY` |
   | `DIRECT_DATABASE_URL` |
   | `VERCEL_API_TOKEN` |
   | `CLIO_CLIENT_SECRET` |
   | `RESEND_API_KEY` |
   | `TWILIO_AUTH_TOKEN` |
   | `GEMINI_API_KEY` |
   | `GOOGLE_SERVICE_ACCOUNT_KEY` |

5. Confirm the plan tier supports `maxDuration: 300` on a serverless
   function (Vercel Pro supports this; the master `CLAUDE.md`'s Tech Stack
   table lists Vercel Pro for this account). If the project defaults to a
   lower ceiling, raise it explicitly in the function's settings or confirm
   `vercel.json`'s `maxDuration` is actually being honored after first
   deploy (function logs will show a 10s/60s timeout if it is not).

## 2. Generate and set `RENDER_SERVICE_TOKEN`

1. Generate a high-entropy token, e.g. `openssl rand -hex 32`.
2. Set it as `RENDER_SERVICE_TOKEN` in the **`caseload-render`** project's
   environment variables (Production, and Preview if you intend to run
   preview-deploy validation against a preview URL — recommended, see §3).
3. Set the **identical value** as `RENDER_SERVICE_TOKEN` in the **main**
   `caseload-select` Vercel project's environment variables (Production and
   Preview).
4. Set `RENDER_SERVICE_URL` in the main `caseload-select` project to the
   render service's deployed URL (e.g.
   `https://caseload-render.vercel.app`, no trailing slash — the client
   in `src/lib/design-check/render-client.ts` strips one if present, but
   set it clean). Use the Preview deployment URL first for §3, then the
   Production URL once promoted.
5. Document both values in whatever secret manager or password vault the
   operator uses for the rest of the app's 63 env vars — `.env.example` in
   this repo documents the two variable NAMES but never a real value.

## 3. Preview-deploy validation

Deploy `feat/render-isolation`'s `services/render/` to a **Preview**
deployment first (push the branch to a remote the render-service Vercel
project is connected to, or use `vercel deploy` from inside
`services/render/` with a Preview target — never `--prod` at this stage).

1. **Confirm cold start succeeds.** Hit the preview URL's `/api/render` with
   a bad/missing token first (`curl -X POST <url>/api/render` with no
   Authorization header) and confirm a `401` JSON body, not a `500` or a
   raw stack trace. A `500` here likely means `assertNoApplicationSecrets`
   fired at module load (check function logs for
   `ApplicationSecretPresentError`) — if so, STOP and re-check step 1.4
   above before proceeding.
2. **Real render, known site.** Point a temporary Preview deployment of the
   main app (`RENDER_SERVICE_URL` set to the render service's Preview URL,
   `RENDER_SERVICE_TOKEN` matching) at `/tools/website-design-check` and
   submit `drglaw.ca` — the calibration field case referenced throughout
   this tool's build history (`docs/BUILD_PLAN_design_check_calibration_v1.md`
   and others). Confirm:
   - A 200 response with a populated report (score, dimension bar, ranked
     findings) — not a 502/504/500.
   - **Measure and record actual duration and memory.** This is the first
     time `@sparticuz/chromium` has run in this account's Vercel
     environment for this tool. Vercel's function logs show both. If
     duration approaches `maxDuration` (300s) or memory approaches the
     function's configured limit, that is a real signal to raise the
     memory allocation on the `caseload-render` project (Vercel functions
     size CPU proportionally to configured memory) before going further —
     do not treat "it eventually returned" as sufficient.
3. **A genuinely broken/unreachable site.** Submit a domain that will not
   resolve (e.g. `this-domain-does-not-exist-caseload-test.invalid`).
   Confirm the main app surfaces its existing
   `"Could not render this site. Try again or check the domain."` message,
   not a raw error.

## 4. Byte-parity check against the pre-isolation path

The base branch (`feat/website-design-check-deploy` @ `7f1739d3`, still on
its own worktree at `.claude/worktrees/design-check-deploy` as of this
writing) still has the old in-process `renderUrl()` path intact. Before
trusting the new path's output:

1. On a **local checkout of `feat/website-design-check-deploy`** (not the
   isolation branch), run the tool locally against `drglaw.ca` and capture
   the full JSON response from `/api/tools/website-design-check` (the
   dimension scores, `letterGrade`, `rankedFindings`, `redFlagPanel`).
2. On the **Preview deployment of `feat/render-isolation`** from §3, submit
   the same `drglaw.ca` URL and capture the same JSON response.
3. Diff the two. Expected: **identical scores, identical letter grade,
   identical ranked findings.** Any difference is a serialization bug, most
   likely in the screenshot base64/Buffer round-trip
   (`render-types.ts` ↔ `render-client.ts`'s `decodeCapture`) or in the
   `html` field's removal changing some downstream code path's behavior —
   re-verify against `docs/BUILD_PLAN_render_isolation_v1.md`'s acceptance
   criterion 4 (`html` absent from wire format and capture code) if a
   diff appears in a place `html` could plausibly have fed.
   - **Small, expected differences:** timestamps (`checkedAt`), and any
     Gemini vision-judgment wording if the LLM call is non-deterministic
     between runs (score bands from that pass should still match; exact
     phrasing may not). Neither is a parity failure.

## 5. Re-prove the SSRF fix against the deployed service

The original finding (`7f1739d3`) and this isolation work's own local proof
(a real Chromium redirect-to-loopback test, run once during the build and
then deleted per the build plan — see the build report for its result) both
confirmed this offline. Re-confirm against the **actual deployed service**,
because a Vercel-specific network/DNS configuration difference is exactly
the kind of thing local verification cannot see:

1. Stand up (or reuse) a small publicly-reachable HTTP endpoint you control
   that responds to `GET /` with a `302` redirect to `http://127.0.0.1:1/`
   (or any address in a blocked range — see `src/lib/ssrf.ts`'s
   `ipInBlockedRange` for the full list; a cloud metadata address
   `169.254.169.254` is the highest-value one to prove specifically, since
   that is the credential-theft vector on most cloud platforms).
2. Submit that endpoint's URL to the deployed `/tools/website-design-check`
   (via the Preview deployment from §3, pointed at the render service's
   Preview deployment).
3. Confirm the response is the refusal path — the same
   `"That domain can't be checked."` message the tool's own pre-check
   returns for an obviously-internal target (this is deliberate: a 403 from
   the render service is mapped onto that exact string by
   `render-client.ts` / `route.ts`, so the two guard layers are
   indistinguishable from outside — see acceptance criterion 2's rationale
   in the build plan).
4. Confirm the render service's own function logs show the block (the
   `blockedRequests` mechanism logs the reason, e.g. `"hostname resolved to
   a blocked address"` or `"blocked_hostname"`), not a silent pass-through.

## 6. Merge sequence — only after §3-§5 all pass

Do not merge on a local-only verification. Once the above are all green:

1. **`feat/render-isolation` → `feat/website-design-check-deploy`.** This
   branch was cut from `feat/website-design-check-deploy` @ `7f1739d3`
   specifically so this merge should be low-conflict — confirm no drift
   happened on the base branch in the meantime (`git log
   feat/website-design-check-deploy` since `7f1739d3`) before merging.
2. **`feat/website-design-check-deploy` → `main`.** This is the point where
   the tool actually goes live — it currently 404s in production (the
   route exists but was never merged) per the original DevOps handoff.
   Riding this same merge, per that handoff's §4 "naming reconciliation"
   ordering constraint (**it cannot land before the tool is live, and it
   cannot land long after**):
   - The naming reconciliation across `capture.html` / `tools.html`
     ("Law Firm Web Design Grader" → "Website Design & Conversion Check",
     including the FAQPage JSON-LD instances) — lives in the
     `caseloadselect-website` repo, coordinate with whoever is mid-way
     through the static-site remediation referenced in that handoff.
   - **`feat/design-check-proxy-rewrite`** in the separate
     `caseloadselect-website` repo — proxies
     `/tools/website-design-check` from `www.caseloadselect.ca` to
     `app.caseloadselect.ca`, mirroring the existing seo-check pattern.
     Without this, the tool is only reachable on the app subdomain.
3. **After merge, run the DevOps handoff's own §5 deploy verification
   checklist** (six items: both domains return 200, embed CSP headers
   correct on the three embed routes, `/portal`/`/admin` still carry
   `frame-ancestors 'none'`, the four static HTML pages embed cleanly, and
   — updated for this work — the redirect-to-loopback re-proof from §5
   above, now against the **production** render service rather than a
   Preview one).
4. `?embed=1` mode (PR #128, already merged 2026-08-07 per the master
   `CLAUDE.md`) and `feat/tools-embed-mode` are independent of this work
   and do not block or get blocked by it.

## 7. Rollback

If §3-§5 surface a problem after Production promotion:

- **Fastest safe rollback:** revert the main app's `RENDER_SERVICE_URL` /
  `RENDER_SERVICE_TOKEN` env vars is not a rollback path — with them unset,
  `fetchRenderResult` throws `RenderServiceUnavailableError` immediately,
  which the route maps to its generic
  `"Something went wrong scanning this site. Try again."` 500 response.
  This makes the tool fail closed (no scans succeed) rather than reopening
  the pre-isolation risk, which is the correct failure mode if the render
  service itself needs to be pulled — but it does mean the tool is down,
  not degraded.
- **Do not** redeploy the pre-isolation in-process renderer as a "quick
  fix." That reintroduces the exact secret-adjacency risk this entire body
  of work exists to remove. If the render service has a real bug, fix it
  there (it holds no application secret, so iterating on it carries none of
  the risk the main app's own hotfix cycle would).
- Standard Vercel deployment rollback (promote the prior Production
  deployment) applies normally to either project independently — the two
  are decoupled on purpose, so rolling back the render service does not
  require touching the main app's deployment and vice versa, aside from
  re-pointing `RENDER_SERVICE_URL` if the render service's URL itself
  changes (it should not, on a rollback within the same project).
