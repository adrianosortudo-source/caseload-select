# Single-request recovery after projection repair

This runbook documents a possible recovery for the one exhausted Casey & Moss held-evidence request. It is not an authorization to activate the migration or send the request. Do not execute it until the migration has passed its separate protected release, a supported request-wrapper recovery control exists, and Adriano gives exact action-time approval.

## Fixed request identity

The only eligible request is the original `domain:caseyandmoss.com` held-evidence request identified in the review-only task record:

- request key: `pe-held-evidence-v1-5d4d1767f39d2be1a8d50c7289a6b57905dfe41135a98c4d3b9d4b4fc5578c57`
- request SHA-256: `d8370d1516c79cfcb78062918b0292a6bfd728109541ba2111be8992826f0e69`
- body SHA-256: `ced28dd6b0aee352ba96f85ef409f1a6d03b9ed04901a6e292dc1fc95f0bbfa5`
- held-evidence SHA-256: `54196cbbafa96b95a66b7a6beca9208c48652601d74aa2a1a1a6c236e3460be9`
- exact saved request-file SHA-256: `d8370d1516c79cfcb78062918b0292a6bfd728109541ba2111be8992826f0e69`
- exact exhausted-state file SHA-256: `a56fb9f4cfab2b91ad876a09cb4c63628ef21fdba6149900d09854f30f077de7`
- original open-run comparison-request SHA-256: `7a9ab00e3cb5912449c8fd7e7b742daf35eeb3f4e7f28b5c905637cb20a2d40d`
- open run id / expected package count: `run-2a85614af50ae60be67addd30ace5ea6b098fa783429e374` / `28`
- source manifest/run manifest: `fb5f2d02f2ff5ee9379def3397b543479be17a84bc2c5446e704dfee2938832f` / `c64a287b1262f9efb52b4a3b93192e4846706ce3d8e6ceafd7bc0eedb0deaa21`
- original request state: `retry_exhausted`, five attempts, last response HTTP 503, no receipt

The source request, request body, held evidence, entry, run, both manifest hashes and state file must be re-read and hash-verified immediately before any attempt. A receipt, changed hash, changed state, identity/source conflict, signature failure or any unexpected ledger/catalog state stops the procedure.

The separate recovery authorization file must use schema `prospect-held-evidence-recovery-authorization/v1` and contain exactly `requestKey`, `requestBodySha256`, `evidenceSha256`, `sourceManifestSha256`, `runManifestSha256`, and a non-empty `authorizationReference` in addition to `schemaVersion`. Supply its actual SHA-256 with `--recovery-authorization-sha256`; the CLI verifies both the raw file hash and every pinned request/manifest value. The existing manifest delivery approval is still required separately.

## Required gates

1. The exact projection migration must already be present in the production migration ledger. Verify its source statements and both function bodies, original ACLs, invoker flags and empty search paths from the protected writer receipt.
2. Obtain a fresh signed admin-prospect-enrichment-bootstrap-resume/v1 comparison from the existing resumable-run reader for the unchanged original comparison request (request hash above; 28-package manifest). The recovery command requires that exact request binding and an empty returned package list, proving the parent run is still open. Confirm there is no existing receipt or conflicting stored body. Confirm the sole-writer lock and inspect the original attempt history.
3. Obtain separate explicit approval to attempt this exact request once. Migration approval does not authorize request recovery.
4. Use only the supported recover-held-evidence CLI operation with --profile whole-firm; it takes no package --key because it never submits a package. It still requires the exact manifest chunks, all held evidence, the 28-package source list, fresh open-run comparison, existing delivery approval, separate action-time authorization file and SHA-256. It pins the original request-file bytes, body, evidence, entry, run, source/run manifests, original comparison request, and exhausted-state bytes. Under the submission lock it performs a second fresh comparison check before writing the one-use marker or incrementing the attempt. If that check fails, it returns not_sent, makes zero network requests, and preserves the original five-attempt state. Otherwise it preserves the prior state in an append-only audit event, records attempt 5 to 6, and sends only the unchanged held-evidence request; it does not finalize the manifest or submit a package.
5. Send the unchanged original request through the existing protected held-evidence endpoint. Never insert held or package rows by SQL, invoke an intake RPC directly, edit local retry state, reset an attempt counter, change the request key, or replay any other firm's request.
6. Preserve the complete response and audit receipt. Independently read back the exact held body, source/run/entry lineage, all projected fields and source tuples, search vectors and canonical body/hash. Require idempotent replay evidence without sending a second request.

## Current execution blocker

The one-use wrapper is implemented as the explicitly named recover-held-evidence CLI command. It remains unavailable for execution until the projection migration is separately released through its protected workflow and a fresh, separate action-time authorization file and SHA-256 are provided for this exact recovery. No request attempt has been executed. The protected migration workflow does not execute this recovery.
