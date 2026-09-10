# HighLevel BA/AE live read-back

This script performs a strictly GET-only evidence extraction for the exact 100-record BA/AE prospect cohort in the CaseLoad Select HighLevel location.

It accepts only the canonical `prospecting-control-plane-provision-manifest-v1` shape. Before the first network request it proves 50 BA and 50 AE records, 100 unique non-null HighLevel contact IDs, and the fixed CaseLoad Select location on every record. It halts if any successful provider response contains another location. It then reads the exact 100 contacts, conversations, email messages since August 26, DND settings, appointments, and the two expected workflow summaries. It does not search, read, or change the KS cohort.

The token is accepted only through `GHL_CASELOAD_SELECT_TOKEN`. It is never printed, persisted, or placed in the API call ledger. Output includes normalized JSON, a one-row-per-prospect CSV index, a Markdown count report, and SHA-256 hashes.

Run from the repository root:

```powershell
node scripts/ghl-prospect-readback/index.mjs --manifest <canonical-provisioning-manifest.json>
```

The output directory must not already exist. This protects earlier evidence from silent overwrite.
