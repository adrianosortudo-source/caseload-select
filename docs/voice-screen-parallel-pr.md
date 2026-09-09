Adds an isolated `/demo/voice-to-screen` prototype for a short reception call followed by an optional Screen and one combined lawyer brief. The existing journey, shared Screen engine and phone routing are unchanged.

The fictional browser demo requires explicit text permission and safe/correct number confirmation before showing its simulated invitation. Existing clients, urgent calls and callers without permission retain the human follow-up path. The Screen reuses the existing adaptive selector and carries forward captured contact facts.

Includes an inactive, pure production eligibility policy requiring current-call proof, plus a detailed bridge contract. This PR does not implement real SMS, persistent continuation tokens, live call processing, database migrations or production activation. Those remaining dependencies are documented in `docs/voice-screen-parallel-journey.md`.

Validation: 12 focused engine continuity and bridge eligibility tests pass. Rendered verification and TypeScript status are recorded in the journey documentation when complete.

Do not merge without Adriano's explicit approval of this PR.
