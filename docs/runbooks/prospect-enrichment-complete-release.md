# Complete prospect enrichment release

This is the fixed schema-release path for the authorized Admin research task. It replaces seven separately dispatched migration stages with one run of `prospect-enrichment-complete-release.yml`, using two sequential jobs in the existing `Production prospect migrations` environment. It does not change SQL, widen migration allowlists, import research, or complete A2-A7 by itself.

## Before dispatch

Review and merge the task PR after its required checks. Set `PROSPECT_CANDIDATE_RELEASE_REVIEWED_SHA` to the exact current reviewed main commit, and `PROSPECT_CANDIDATE_RELEASE_REVIEWED_RECEIPT_SHA256` to the SHA-256 of the committed bytes of `scripts/prospect-enrichment/additive-release-review.json`. Supply those same values as dispatch inputs. Supply all three exact confirmations: `RECONCILE-QUALIFICATION-HISTORY-V1`, `APPLY-PROSPECT-ENRICHMENT-V1`, and `APPLY-PROSPECT-CANDIDATE-PROFILES-V1`. Explicitly select temporary authentication. Source checkout, dispatch, protected variables, current main, project and receipt must agree.

Only the initial state with all eleven reviewed release migrations pending is accepted. Existing operator RPC history/catalog remains a required applied prerequisite. A different or partially applied state requires read-only reconciliation and the existing separately protected recovery tools; never edit state or receipt bytes to make this runner continue.

## One run, two reviews

The first protected job receives approval to acquire one temporary write-capable credential and execute read-only preflight. It stages byte-verified history, validates the operator RPC, compares the two qualification migration sources in scratch PostgreSQL against all fourteen live catalog contracts, and requires exactly eleven pending migrations with no seeds/roles. Its immutable artifact contains only validated, redacted checks. A manifest hashes every member and binds run ID, attempt, source SHA, project and receipt. Evidence expires after 24 hours.

The second job depends on the successful preflight and waits for the environment reviewer to inspect that artifact. The job summary names the exact artifact ID/digest and manifest digest plus the three intended write phases. This independent review cannot occur before its evidence exists. Do not auto-approve, disable reviewer protection, or describe the first approval as covering evidence that has not been produced.

After approval, the job checks same-run artifact metadata, downloads that artifact ID only, verifies its manifest against the trusted first job output, and verifies every member hash. It then repairs only the two qualification history entries, applies only the six enrichment files, and applies only the three candidate files. Each phase repeats source, receipt, ledger, catalog and exact applicable plan checks immediately before writing, then verifies source statements and full ledger before the next phase starts. Qualification repair uses the verified staged local files, which the pinned CLI records as the repaired history statements. Immediate staging verification follows the last CLI plan. All migration writers share one non-cancelling production concurrency group.

The six-file post-plan is empty only within prerequisite staging. The final candidate phase additionally requires all eleven source-statement rows and an empty complete pending plan. The operator RPC catalog is checked throughout.

## Credentials and failure recovery

The workflow permits at most four acquisitions: one preflight credential and one before each of the three release phases. Local exclusive acquisition markers reject duplicate acquisition. No credential crosses jobs or enters uploaded artifacts. Every database operation validates the exact endpoint, TLS trust and expiry. Writes need at least 210 seconds remaining for a bounded 180-second child process plus the thirty-second safety margin. An expired or too-short credential fails before the next operation; it is not silently renewed inside a phase.

The coordinator persists `started` before each write and `verified` only after its complete read-back succeeds. A write error still attempts read-only reconciliation; it never becomes success merely because later reads appear complete. Recovery evidence includes redacted ledger shape, validated source/catalog/full-ledger checks when obtainable, and the exact remaining plan when it can be validated. Raw CLI output, database connection values and credentials are never uploaded. If read-back cannot complete, the state remains started and unverified.

GitHub run attempts other than 1 are rejected. Do not use Re-run jobs to replay an uncertain write. Inspect retained evidence and perform a separately protected read-only reconciliation first. The complete runner also rejects a newly dispatched run after any release prefix has applied, preventing fresh local state from replaying prior work. The observed partial candidate run is recovered only through [the pinned candidate-suffix recovery](prospect-candidate-suffix-recovery.md), which accepts that exact nine-applied/two-pending state and has its own two protected reviews. Other partial states still require a separately designed, narrowly bound recovery.

After a fully verified release, immediately verify authenticated Admin run/package/candidate readers and continue the live firm pilot, evidence-state acceptance, historical delivery, delta reconciliation and producer cutover in the finish plan. Migration success does not establish research visibility or sync.
