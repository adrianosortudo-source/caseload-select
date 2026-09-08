# GTA prospect research dry-run import manifest

`gta-prospect-research-accepted-001-009.dry-run.json` is a deterministic, offline review artifact. It selects only records with an independent `accepted_for_staging` disposition from research batches 001 through 009.

It deliberately does not connect to a database, apply a migration, import data, create CRM records, contact anyone, deploy, or merge.

Run the generator without writes:

```powershell
npx tsx scripts/generate-gta-prospect-research-dry-run-manifest.ts
```

Regenerate the committed review artifact after a source or QA change:

```powershell
npx tsx scripts/generate-gta-prospect-research-dry-run-manifest.ts --write
```

The artifact keeps the importer-compatible projection separate from source/QA provenance. Held, rejected, and candidate-only records appear only in `exclusions`, never in `importRecords`.
