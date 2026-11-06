# Local law-firm research cutover

The local database is `D:\00_Work\01_CaseLoad_Select\07_Prospects\LocalResearch\migration-20261106\research.sqlite3`. It holds exact PostgreSQL row JSON compressed per record, original source identifiers, column metadata, constraint/index/function/trigger definitions, and block verification receipts. Search uses SQLite FTS5. No local search calls Supabase.

Double-click `Search Research.cmd` in that folder. Agents can run `python research.py "search terms"`, retrieve source records with `--table TABLE --id ID --output FILE`, and check every stored row with `--verify`. Original numeric JSON text and Unicode remain in the compressed record; the archive never converts JSON numbers into floating-point values.

## Release sequence

1. Complete the export and compare every source block digest and table count. Reconstruct all retained content chunks and verify their SHA-256. Check every local record hash and SQLite integrity. Test local search and exact candidate/history retrieval. Retain a second verified copy in the D: archive area.
2. Push this branch, pass required CI, and obtain Adriano's explicit approval to merge this specific PR, as required by AGENTS.md. Merging ships the local-research notice and authenticated HTTP 410 responses; it does not delete research data.
3. Apply only the pushed migration, under its exact filename version. The migration only creates a postgres-only cutover function. Check the ledger version before proceeding. Do not use direct production deploys.
4. Immediately recheck source counts and local verification. Invoke `archive_candidate_research_to_local_v1` with the exact seven archived table counts and SHA-256 of the verified manifest. Its transaction locks all seven relations, refuses changed counts, disables only the derived projection triggers, and truncates those seven relations without CASCADE. Any external FK must block this operation. It does not drop tables, source evidence, CRM records, client accounts, deliverables or stored files.
5. Confirm the database is below 400 MB, projection triggers remain disabled, operational row counts match, and authenticated portal/client workflows still function. Only then downgrade the organization to Free and verify the dashboard says Free.

## Scope and limits

The seven large derived candidate tables move out of the live database. Small original source and operational tables remain online to preserve the portal's existing firm, CRM, evidence-review and client dependencies. This does not promise that every law-firm name disappears from Supabase. Future bulk research belongs in the local workspace; existing online import/review routes must not be used to rebuild the removed projection. Pure package-validation helpers remain available.

The export performs read-only source queries. It is not a full PostgreSQL/Supabase runtime backup and does not copy Storage object bytes, which remain online. Source blocks are compared a second time and complete source counts are checked; this detects changes during export, but it is not a single PostgreSQL snapshot across every table. The seven candidate tables reject UPDATE/DELETE and are count-checked again under cutover locks. The D: safety copy protects against accidental editing, not a failure of the physical D: drive.

The cutover is intentionally a separate invocation after deployment and verified backup. Neither migration creation nor a passing test is evidence of a completed move, production release or billing downgrade.
