# Firm Assist retrieval evaluation

The fixture contains 12 public-style pages for two fictional firms and 30 questions. Six subjects occur at both firms with conflicting facts. The runner batches documents and questions separately using the named provider's 768-dimensional embeddings. It evaluates cosine retrieval using the current application floor of 0.55 and a second floor selected on calibration questions. Each report includes the held-out expected and returned page IDs. Empty results count as correct for out-of-corpus questions.

Run the evaluator contract test locally with `node --test scripts/assist-search-evaluation/score.test.mjs`. It uses synthetic vectors with known answers. To evaluate model quality, run one of the following in the approved staff environment with the corresponding server-side project credential already present.

```sh
node scripts/assist-search-evaluation/run.mjs openai openai-search-results.json
node scripts/assist-search-evaluation/run.mjs gemini gemini-search-results.json
```

Inputs are fixed in `fixtures.mjs`. The output contains only synthetic questions, expected page IDs, rankings and counts. Run the same fixture revision for each provider. The held-out questions measure whether the expected pages survive the cutoff. Database isolation, actual website coverage and the answer model's final citations require separate checks before changing a firm's live index.

[OpenAI embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create) · [Supabase semantic search](https://supabase.com/docs/guides/ai/semantic-search)
