Adds an isolated `/demo/voice-to-screen` prototype for a short reception call followed by an optional Screen and one combined lawyer brief. The existing journey, shared Screen engine and phone routing are unchanged.

The fictional browser demo requires explicit text permission and safe/correct number confirmation before showing its simulated invitation. Existing clients, urgent calls and callers without permission retain the human follow-up path. The Screen reuses the existing adaptive selector and carries forward captured contact facts.

Includes a separate persisted pilot behind disabled server gates: exact authenticated GHL call hydration, current-call permission/safety/number evidence, durable inquiry/outbox, opaque expiring continuation, partial/completed Screen saves, authenticated combined brief and human takeover. A dedicated allowlisted GHL sender adapter is implemented but unconfigured and has sent nothing. The service-only migration is committed for review, not applied. Daily retention, bounded full expiry purge and manual subject erasure are implemented; privacy-registry replay suppression and actual GHL payload/delivery verification remain rollout blockers.

The original journey and shared Screen engine remain unchanged. Activation requires explicit approval, verified scope/credentials, mandatory retention, active rate limiting and approved test numbers. No production merge/deploy, migration application or live sending occurred.

Validation: the first commit passed all 14 CI checks, including TypeScript, ESLint, the full Vitest suite and real Postgres integration. The follow-up carries the explicitly stated invoice amount and other known call facts into the Screen, and expands focused coverage to 13 tests including skipping questions. Latest CI and rendered verification status are recorded in the journey documentation.

Do not merge without Adriano's explicit approval of this PR.
