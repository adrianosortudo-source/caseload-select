# Firm Assist shadow index

The operator worker embeds the included, successfully crawled chunks of one firm with `text-embedding-3-small` at 768 dimensions. The version is `openai/text-embedding-3-small/768/v1`. Firm Assist continues to answer through its current Gemini retrieval RPC. No scheduler starts a shadow backfill.

The migration `20261118010000_assist_shadow_embeddings.sql` must be present on the target database before using these commands. Use its existing server-side Supabase URL and service-role credential. Backfill also needs the existing CaseLoad project OpenAI API key. Check which database and firm are intended before running a backfill, since it sends the included chunk text to that project.

```sh
node --conditions=react-server --import tsx scripts/assist-shadow-index.ts status <firm-uuid>
node --conditions=react-server --import tsx scripts/assist-shadow-index.ts backfill <firm-uuid> <max-batches>
```

Status only reads counts. Backfill accepts 1–100 batches of up to 20 chunks each and prints the number offered and saved. Run one worker at a time per firm to avoid paying twice for concurrent requests for the same chunks. A retry reads the current missing set. Changed, removed or excluded candidates can reduce the saved count while a batch is in flight.

`ready` requires at least one included page, eligible nonempty corpus coverage for every included page, and an embedding for every matching chunk ID and content hash. A failed or unpopulated included page holds readiness until its corpus recovers or the operator excludes it. An unchanged recrawl keeps valid vectors. Replacement or deletion of canonical chunks cascades to the corresponding shadow rows. Readiness represents the stored corpus at query time. Benchmark quality, firm authorization, funding and a serving switch are separate release decisions.

The service-role RPC `match_assist_shadow_chunks` performs exact cosine search for one firm and version. Its prerequisites and results use the same database snapshot. The RPC returns no matches until that firm’s shadow index is ready. For local verification, run `scripts/assist-shadow-index/contract.sql` against a disposable Postgres database with pgvector and both corpus migrations. It creates two fictional firms and rolls its transaction back.
