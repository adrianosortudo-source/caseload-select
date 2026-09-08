# Downtown Toronto Geography Evidence Contract

This companion ledger establishes whether a firm office is inside the City of
Toronto Downtown Plan (Secondary Plan 41). It is not a postal-code, city-name,
or neighbourhood-label shortcut.

## Stable linkage

Each observation is stored against `gta_prospect_firms.id`; the service-only
operator summary returns the same stable `source_record_key` used by the core
prospect ledger. A geography observation cannot create a firm or silently
deduplicate one.

## Required evidence

Every record carries:

- a normalized, firm-confirmed office address;
- the fixed Downtown Plan boundary identifier and authoritative ArcGIS source;
- an SHA-256 hash of the exact boundary geometry used;
- the date observed and an explicit confidence value; and
- an `inside`, `outside`, or `needs_manual_review` conclusion.

`inside` and `outside` require latitude, longitude, coordinate provenance, and
the coordinate-source URL. `needs_manual_review` may retain an address without
coordinates, but cannot be treated as cohort eligible. The cohort helper still
requires an exact 1–10 published lawyer count separately.

## Privacy and operational boundary

The observation table is append-only, RLS-protected, and has no browser-role
table grant. Only a narrow service-role RPC returns the latest current summary
for already applied GTA prospect identities. This foundation does not import
records into a live database, contact a firm, submit a form, open chat, or set
CRM or outreach state.
