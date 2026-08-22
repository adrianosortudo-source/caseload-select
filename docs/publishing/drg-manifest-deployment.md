# DRG manifest deployment

DR-122 defines a reusable private-placement path from a validated DRG weekly run into Deliverables and Publishing Kit. The input is data, not portal source code: one `drg-deployment-bundle-v1` JSON file carries the six-field Weekly Strategic Record, exactly sixteen deliverables and versions, approved logical assets, and deterministic Publishing Kit row IDs.

The operator workflow is `prepare -> gate -> apply -> prove`. `npm run drg:deploy -- run --bundle <bundle> --root <run-root> --authorization <authorization>` is permitted only after this branch's migration and writer are merged to `main`. The authorization must be generated from the final bundle, bind its canonical SHA-256, name every period, package, deliverable, version, logical asset, materialized Publishing Kit row, event, operation, deployment receipt and exact storage object, contain no broader targets, and remain unexpired.

The database RPC is transactional and keyed by `(firm_id, deployment_key)`. Concurrent identical calls serialize to one write transaction and one verified no-op. Reusing a key with different bundle bytes or authorization content hash fails. Storage paths are immutable, content-addressed, and constrained to exact authorized object keys under the bundle's firm/deployment prefix. An interrupted database apply may leave an unreferenced immutable object, but a retry reuses and byte-verifies it; the writer never overwrites an existing different object.

Authority trust is pair-bound. New bundles use `DRG-LAW-CSB-4.26` with SHA-256 `817dc22c9480a6a74051b7a36c1b616dc1eff7ef9d43265c15110167d58ece2c`. The exact historical `DRG-LAW-CSB-4.22` pair remains trusted only for byte-identical replay and proof of older bundles. A release from one pair combined with the hash from the other is rejected.

The bundle stores a promoted page's canonical on-site route in `ctaTargetPath`. Publishing Kit materializes the publisher-facing absolute HTTPS URL from that route and the firm's configured public website origin; the deployment writer does not duplicate that portal logic or require a schema change.

Placement creates an `in_review` Deliverables period and a draft Publishing Kit. It does not write lawyer approvals, publication receipts, publish dates, release-ready status, notifications, website content, social posts, or external-platform state. Human merge is required before the migration can be applied. CI's fresh Supabase job must replay the migration and execute the real-Postgres idempotency test before production use.
