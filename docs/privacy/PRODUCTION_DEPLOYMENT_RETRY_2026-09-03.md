# Production deployment retry — 2026-09-03

PR #210 merged successfully, but both Git-integrated Vercel production deployments were rejected by the Hobby rolling deployment limit. This record creates a fresh Git-integrated deployment attempt after capacity returned.

Release guardrails remain unchanged:

- Do not deploy, redeploy, or promote directly.
- Do not apply the pending Supabase migrations until the Git-integrated production build is ready and the privacy recovery route is verified to fail closed.
- Keep the external-deletion circuit locked throughout migration and reconciliation.
- Treat this commit only as a deployment retry and activation evidence marker.