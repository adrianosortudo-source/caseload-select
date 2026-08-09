# DRG release-authorization signer activation

The portal issues one short-lived `drg.release-authorization-envelope.v1`
for an exact staged sixteen-piece package. Staging receipts are deliberately
not release authorization and always retain `releaseAuthorizationGranted:
false`.

Production is intentionally unprovisioned in this branch. Do not generate a
key in application code, commit a private key, or treat a missing signer as an
approval. Activation requires a human-controlled provisioning change:

1. Generate an Ed25519 key pair in the approved secret-management process.
2. Add only the public PEM, its SPKI SHA-256, a stable key ID, the production
   environment, and explicit effective/retired bounds to
   `src/lib/drg-release-authorization-envelope.ts`.
3. Update the complete versioned `DRG_RELEASE_TRUST_BUNDLE` in the portal and
   website repositories atomically. Confirm both repositories compute the same
   canonical bundle SHA. Envelopes sign that SHA, so partial rotation fails
   closed.
4. Only after both reviewed bundles are present, store the private PEM in the
   portal server's secret environment as
   `DRG_RELEASE_AUTHORIZATION_PRIVATE_KEY_PEM`; set the matching key ID in
   `DRG_RELEASE_AUTHORIZATION_SIGNING_KEY_ID`.
5. Run the portal envelope tests, Publishing Kit verifier tests, and website
   materializer tests. Verify an unknown key, altered package, altered piece,
   expired envelope, active hold, revoked standing event, and invalid
   signature all fail before writes.
6. Activate through the ordinary reviewed PR/deployment process. Do not use a
   CLI production deploy and do not apply any database migration from an
   unpushed branch.

The repository contains the public RFC 8032 test-vector key only for
deterministic tests. Both signer and verifier reject that entry when
`NODE_ENV=production`.

The database staging RPC does not verify Ed25519 signatures. It is restricted
to the service-role adapter and trusts the adapter's already-verified input;
Postgres continues to enforce atomic staging, exact package hashes, and replay
semantics. Release-envelope signature verification belongs to the portal and
website adapters, not to SQL.
