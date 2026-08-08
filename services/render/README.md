# caseload-render

The isolated render service for the Website Design & Conversion Check.
Deploys as its own Vercel project with **zero application secrets** — see
`docs/BUILD_PLAN_render_isolation_v1.md` and
`Version3_CaseLoadSelect/CaseLoadSelect_RendererIsolation_Spec_2026-08-07.md`
in the main repo for the full "why."

This file exists specifically to satisfy the isolation spec's §6.2: record
which Chromium launch flags disable OS-level sandboxing, why they cannot be
removed on this platform, and what actually bounds the residual risk. Do not
delete this file without re-deriving the same answer against whatever
platform the service runs on next — the honest answer changes if the
execution environment does.

## The launch flags, as of `@sparticuz/chromium@149.0.0`

`chromium.args` (imported at `renderer.ts`'s `launchBrowser()`, passed
through unmodified) currently resolves to these 22 flags. Verified live
against the actual installed package on 2026-08-07, not copied from the
package's docs or an older version:

```
--ash-no-nudges
--disable-domain-reliability
--disable-print-preview
--disk-cache-size=33554432
--no-default-browser-check
--no-pings
--single-process
--font-render-hinting=none
--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process
--enable-features=SharedArrayBuffer
--ignore-gpu-blocklist
--in-process-gpu
--use-gl=angle
--use-angle=swiftshader
--enable-unsafe-swiftshader
--allow-running-insecure-content
--disable-setuid-sandbox
--disable-site-isolation-trials
--disable-web-security
--headless='shell'
--no-sandbox
--no-zygote
```

Re-verify with `node -e "console.log(require('@sparticuz/chromium').args.join('\n'))"`
from inside `services/render/` (after `npm install`) whenever the
`@sparticuz/chromium` version changes — the isolation spec's own audit found
one already-stale flag list in prior project documentation, and this file
must not repeat that mistake.

## The five that disable real isolation

| Flag | What it disables |
|---|---|
| `--no-sandbox` | Chromium's own OS-level sandbox (seccomp-bpf + namespace isolation) for every renderer process |
| `--disable-setuid-sandbox` | The Linux setuid-helper sandbox, the fallback path when the main sandbox is unavailable |
| `--single-process` | Runs the browser process and every renderer/tab in ONE OS process — the single worst flag here, since it collapses Chromium's own browser-vs-renderer process boundary, not just the OS sandbox around it |
| `--no-zygote` | Disables the zygote process Chromium normally uses to fork new, pre-sandboxed renderer processes |
| `--disable-web-security` | Disables same-origin-policy enforcement inside the rendered page — irrelevant to sandboxing per se, but listed here because it means the rendered page's own script has no cross-origin restriction inside the browser (mitigated entirely by the SSRF guard controlling what that script can ever reach over the network, not by anything in the browser itself) |

`--disable-site-isolation-trials` and `--disable-features=...,IsolateOrigins,site-per-process`
compound the `--single-process` effect: even the process-per-site-instance
isolation Chromium ships by default for security is turned off.

## Why these cannot be removed on this platform

`@sparticuz/chromium`'s own README describes its args as "a set of
predefined arguments tailored for serverless platforms" and does not expose
a supported way to launch with a different flag set. This is not an
oversight in the package — it reflects a real platform constraint:
Chromium's own sandbox depends on Linux primitives (`unshare`, PID/user
namespace creation, seccomp-bpf filter installation) that Lambda-class
serverless execution environments — the category Vercel's Node.js
Serverless Functions belong to — do not generally permit to an unprivileged
process. `--single-process` and `--no-zygote` exist for the same reason:
forking additional sandboxed child processes is either unavailable or
prohibitively expensive to set up per invocation in this execution model.

Passing a custom, hand-edited args array that drops these flags was
considered and rejected for this service, for a concrete reason: there is no
way to verify a modified flag set actually works — versus silently
crash-looping on cold start — without a real Vercel deployment to test
against, and getting this wrong fails the render service's ONE job (holding
no secret, still rendering pages). Restoring the sandbox for real would mean
either a platform that grants the necessary Linux capabilities (a
containerized deployment with its own seccomp profile and non-root user,
which the isolation spec names as the alternative path for a platform that
"cannot sandbox") or Adriano revisiting the "second Vercel project on the
existing account, no new paid services" decision this build was scoped
against. Neither is this build's call to make unilaterally; both are noted
here as the honest options, not silently worked around.

## What actually bounds the residual risk

The isolation this whole service exists for is NOT "restore the OS
sandbox" — it is **"move the browser out of the process holding every
application secret."** That is done, unconditionally, regardless of this
file's contents: `auth.ts`'s `assertNoApplicationSecrets()` guarantees this
service's own environment carries nothing beyond `RENDER_SERVICE_TOKEN`. So
even with every flag above unchanged, the practical consequence of a full
Chromium renderer-to-browser-process compromise inside this service is an
attacker who gains control of a browser they already logically controlled
(they supplied the URL) and a token that lets them call this one render
endpoint — not `SUPABASE_SERVICE_ROLE_KEY`, not `DIRECT_DATABASE_URL`, not
any of the other 61 secrets the main app's runtime used to sit next to. The
SSRF guard (`renderer.ts`'s `guardContextRoutes`, DNS-pinned via
`ssrfSafeFetchOneHop`) is the control that actually matters for this
service's own blast radius: it bounds what the rendered page's own script
can reach over the network, independent of whether the OS sandbox around
the renderer process is intact.

## Still open, not addressed by this file

- **§6.4 egress restriction** (network policy / firewall so the service can
  reach the public internet and nothing internal) is a platform-level
  control this codebase cannot configure from inside a Vercel Serverless
  Function. Worth raising with @devops as a Vercel-account-level or
  DNS-level control if the platform ever offers one.
- **Resource limits beyond `vercel.json`'s `maxDuration`** (a hard memory
  cap, guaranteed process recycling between renders) are Vercel platform
  defaults for this function class, not something configured in this
  repo.
