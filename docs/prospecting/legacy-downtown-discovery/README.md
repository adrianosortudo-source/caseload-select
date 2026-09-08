# Legacy GTA Downtown Plan 41 discovery queue

`legacy-gta-directory-2026-07` is preserved source evidence from an older LSO
address-cluster artifact. This queue narrows research by testing a manually
or independently geocoded street address against the City of Toronto's official
Downtown Plan, Secondary Plan 41 polygon.

Run it from the repository root:

```powershell
node scripts/build-legacy-downtown-discovery.mjs
```

The command downloads the City feature directly from its ArcGIS layer and saves
the exact returned GeoJSON in this directory. It writes
`legacy-gta-downtown-geocode-queue.json`, with one retained source row per
legacy record.

The queue has four geography statuses:

- `inside_confirmed`: a sourced address coordinate falls within Plan 41.
- `outside_confirmed`: a sourced address coordinate falls outside Plan 41.
- `requires_manual_geocoding`: an address exists but has no source-backed
  coordinate yet.
- `address_incomplete`: the source lacks enough street-address information to
  geocode.

Add coordinates using a JSON array passed as `--geocodes`. Every entry needs
`sourceRecordKey`, `longitude`, `latitude`, `sourceUrl`, and `observedOn`.
Postal-code centroids and city labels are not permitted as coordinates because
they cannot establish that an office lies inside the Downtown Plan boundary.
`geocodingPriority` helps order the work using the legacy city label, but is not
a geography decision; only a sourced coordinate can produce an inside or
outside status.

This is a discovery queue. It does not identify a firm, merge rows, establish
the current firm lawyer count, or write to the prospect database.
