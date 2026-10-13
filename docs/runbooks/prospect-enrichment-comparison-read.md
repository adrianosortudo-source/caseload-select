# Read-only Casey and Moss comparison workflow

The `Read-only Casey and Moss prospect comparison` workflow obtains one signed bootstrap/resume snapshot for the frozen Casey & Moss request. It does not register the run, submit packages, change retry state, apply a migration, or perform recovery.

## Required GitHub configuration

Before dispatch, configure the repository environment with this exact name: `Prospect comparison read`.

- Restrict deployments to the `main` branch and configure the environment's required reviewer protection according to the repository's release policy.
- Define the non-secret environment variables `PROSPECT_ENRICHMENT_COMPARISON_TRUSTED_KEY_ID` and `PROSPECT_ENRICHMENT_COMPARISON_TRUSTED_PUBLIC_KEY_PEM`. They must identify the Ed25519 public key corresponding to the deployed application's existing comparison-signing private key. Do not put the private signing key in GitHub Actions.
- The application deployment must contain the existing signing key variables and the new route on the current `main` deployment.

The workflow is restricted to manual dispatch on current `main`, with `contents: read` and `id-token: write`. The server accepts only the exact repository, repository ID, branch, workflow file, environment, event, audience, issuer, and a short-lived signed GitHub token. It hashes the token's `jti` for audit and never logs or returns the token.

## Read and verify

1. Dispatch `Read-only Casey and Moss prospect comparison` from current `main` after the environment's reviewer gate is satisfied.
2. The workflow verifies that the checked-out SHA is still current `main`, checks the frozen request hash and manifest pins, and sends only that canonical request to the read-only endpoint.
3. Before retaining the one-day artifact, the workflow verifies the Ed25519 signature, request hash, GitHub run provenance, and an empty `packages` array. The artifact is the signed snapshot JSON.
4. Preserve the artifact bytes and run ID as evidence. The local `recover-held-evidence` CLI can verify this machine-authenticated snapshot only inside its existing exact request, signature, one-use, prior-state, authorization, and retry-budget gates.

The workflow read is not recovery authorization. Any production recovery still requires the already-scoped approval and all existing checks; this runbook does not authorize it. A different request, source, run, environment, or workflow requires new review and explicit approval before any recovery attempt.
