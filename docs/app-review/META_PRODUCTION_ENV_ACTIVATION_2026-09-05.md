# Meta production environment activation — 2026-09-05

**Status:** Deployment gate only. This change does not alter application logic, disclose secret values, change Meta configuration, or authorize App Review submission.

## Purpose

Trigger the normal Git-integrated production rebuild so the already-merged PRs #225 and #226 can load the independently rotated Production-only Messenger, Instagram, and WhatsApp webhook verification variables.

## Preconditions

- PRs #225 and #226 are merged on main.
- The three rotated verification variables are present in Vercel Production and their values remain outside source control.
- Meta callback URLs and verification values remain unchanged until the resulting production deployment is READY.

## Required post-deployment verification

1. Confirm the caseload-select production deployment is READY and resolves to the current main commit.
2. Verify all three canonical callback GET challenges at https://caseloadselect.ca using the rotated values without logging those values.
3. Only then update the matching Meta callbacks.
4. Run signed empty-event POST checks and aggregate-only no-write database checks.
5. Keep Meta App Secret rotation and final App Review submission behind their separate action-time gates.

Prepared at 2026-09-05 20:07 -04:00 after the prior Vercel Hobby deployment-limit interval.