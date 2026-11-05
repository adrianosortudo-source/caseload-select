# SEO and AEO report review

The current-method report presents evidence-based priorities, page-specific findings, meaningful observed examples, AI search crawler rules and next steps. Metadata and heading observations are review prompts; they are not validated ranking tests. Findings remain tied to saved page fields and do not measure traffic, enquiries, search ranking or AI citations.

The existing crawler, 25-page public limit, core checks, scoring, storage and email flow are unchanged. Historical results retain their existing interpretation. Missing observations must not be presented as passes or website defects.

## Saved-result browser review

Run the app or use an authorized protected preview, then run:

```text
node scripts/seo-report-rendered-check.mjs --url APP_URL/tools/seo-check?embed=1 --soni SAVED_SONI_JSON --sakuraba SAVED_SAKURABA_JSON --output ARTIFACT_DIRECTORY
```

The script replays the saved results inside the browser, skips email, blocks other POST requests and firm-domain requests, and checks eight viewport widths with both normal and expanded disclosures. It verifies page links and clipboard readback and records rendered copy failures and screenshots outside the repository. For protected previews, provide an origin-scoped Vercel OIDC token using the linked project's development environment; never write it to artifacts.

Use the original scan dates and fixture hashes in the review receipt. The 25-page cap is a sample limit, not a retrieval failure; a discovered-candidate count is not the size of the whole website. Soni's sitemap mismatch is part of its six excluded pages. Its saved data includes the FAQ heading on four service pages. Sakuraba's saved result supports four description reviews, one contextual heading review and a decision about two English immigration pages.

Check the actual public-page embed separately, including its mobile frame. Review each final rendered report with the user before seeking approval to merge the specific PR. Do not perform a new website audit or submit email during saved-result review.
