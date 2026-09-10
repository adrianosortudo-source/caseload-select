# Prospecting Control Plane 100-record importer

This CLI provisions the reconciled 50 Beyond Agency and 50 Adam Erhart source records into the existing prospect-operations model. It does not merge identities, log activities, alter contactability, send messages, activate workflows, enroll contacts, delete data, or call HighLevel.

## Safety contract

- `source_system` is always `prospecting_control_plane`.
- `source_record_key` is the exact CLS record ID (`BA-...` or `AE-...`).
- The manifest must contain exactly 100 unique firms: 50 BA and 50 AE.
- The manifest must carry first-party source evidence and a complete, nullable HighLevel identity block.
- Exact duplicate CLS IDs, firm names, firm websites, and person emails are rejected. Nothing is fuzzy-matched.
- A generic firm inbox never populates `prospect_people.primary_email`, even when it is the approved outreach route. Keep it in `source_payload` contact-route/HighLevel metadata and set the person's `primary_email` to `null`.
- A non-null person email requires explicit named-person attribution backed by a first-party URL; attribution must be `null` when the person email is `null`.
- The RPC copies the validated top-level attribution into the payload passed to provisioning. The durable source link retains it at `source_payload.providedSourcePayload.person_email_attribution`; this field is set by the server, not trusted from arbitrary payload input.
- The source payload is capped at 50,000 UTF-8 bytes per record.
- Dry-run is the default. Apply requires both `--apply` and the exact manifest SHA-256 reported by a reviewed dry-run.
- The CLI makes exactly one authenticated Supabase RPC call. PostgreSQL performs all preflight reads, provisioning calls, and post-write assertions in that RPC transaction. Any exception rolls back the entire run.
- The batch RPC is `SECURITY INVOKER`; execution is revoked from `PUBLIC`, `anon`, and `authenticated`, and granted only to `service_role`.
- Existing exact source records are skipped only when their source URL, complete immutable source/organization/person provenance, provisioning basis, source link, conversation, exactly one provisioning event, and deterministic idempotency key agree.
- Every run writes a JSON receipt. Receipts never contain the Supabase service-role key.

## Manifest shape

```json
{
  "schema_version": "prospecting-control-plane-provision-manifest-v1",
  "generated_at": "2026-09-10T12:00:00Z",
  "records": [
    {
      "cls_record_id": "BA-B1-01",
      "arm": "BA",
      "source_url": "https://examplelaw.ca/team/jane-example",
      "organization": {
        "display_name": "Example Law",
        "city": "Toronto",
        "website_url": "https://examplelaw.ca/"
      },
      "person": {
        "display_name": "Jane Example",
        "primary_email": "jane@examplelaw.ca",
        "primary_phone": null,
        "role_title": "Founder",
        "email_attribution": {
          "mailbox_type": "named_person",
          "person_attribution_proven": true,
          "evidence_url": "https://examplelaw.ca/team/jane-example"
        }
      },
      "source_payload": {
        "arm": "BA",
        "method": "beyond_agency",
        "evidence": [
          {
            "url": "https://examplelaw.ca/team/jane-example",
            "observed_at": "2026-09-10T12:00:00Z",
            "label": "First-party owner profile"
          }
        ],
        "highlevel": {
          "location_id": "xXhW340nWLAJhOPzLbAA",
          "contact_id": null,
          "smart_list_id": null,
          "workflow_ids": []
        }
      },
      "provisioning_basis": "First-party owner profile and reconciled Control Plane identity."
    }
  ]
}
```

The same shape repeats for 100 records. AE records use `arm: "AE"` and `method: "adam_erhart"`.

## Reviewed dry-run

The batch migration must already be applied through the normal pushed-branch migration process. Load the existing server-only Supabase environment variables without printing their values.

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = <loaded securely by the operator>
$env:SUPABASE_SERVICE_ROLE_KEY = <loaded securely by the operator>
$env:PROSPECT_OPERATOR_ID = <active operator UUID>
npx tsx scripts/prospecting-control-plane/cli.ts --manifest D:\path\to\prospects.json --receipt D:\path\to\dry-run-receipt.json
```

Review the receipt. It reports exact existing/absent counts, every CLS key, the manifest digest, and the unchanged activity count. Dry-run calls the RPC once with `p_apply: false`; that code path performs no writes.

## Apply the reviewed bytes

Copy the SHA-256 from the reviewed dry-run. If the manifest changes by one byte, apply stops before connecting writes.

```powershell
npx tsx scripts/prospecting-control-plane/cli.ts --manifest D:\path\to\prospects.json --apply --expect-sha256 <reviewed digest> --receipt D:\path\to\apply-receipt.json
```

A successful apply receipt must show:

- `input: 100`, `BA: 50`, `AE: 50`;
- `existing + provisioned = 100`;
- `total_after: 100`;
- `canonical_bijection_after_apply: true`;
- identical `activities_before` and `activities_after`;
- `transaction: "rpc_atomic_apply"`.

Re-running the same manifest is safe: all 100 records should be classified as `existing`, with `provisioned: 0`.
