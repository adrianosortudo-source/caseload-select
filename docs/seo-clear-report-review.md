# Clear website report review

## Scope

The current methodology-v5 report uses the approved report format: a plain-language overview, five visible check results, named AI search crawler observations, an ordered next-step plan and expandable supporting evidence. The report distinguishes a 25-page sample limit from a retrieval failure. Empty priority sections and the empty Copy findings action are omitted.

Passing statements require the recorded check and supporting page observation. Missing evidence is not a pass. Soni retains its six named Google-excluded pages and recommended decisions; Sakuraba explains which basic checks passed. Published crawler rules remain separate from actual AI answers, mentions and citations, which were not tested.

The crawler, scoring rules, API, scan limits and lead collection are unchanged. Historical reports retain their original interpretation. No production change or new firm scan is part of this review.

## Saved-result browser regression

Run the existing app locally or use its protected preview, then run:

```text
node scripts/seo-report-rendered-check.mjs --url APP_URL/tools/seo-check?embed=1 --soni SAVED_SONI_JSON --sakuraba SAVED_SAKURABA_JSON --output ARTIFACT_DIRECTORY
```

The test requires the saved 25-page Soni and Sakuraba results. It fulfills the scan response locally, skips the email step, blocks other POST requests and all requests to the firms, and checks both reports at 1440, 1024, 768, 640, 375, 320 and 294 CSS pixels. It checks the default and expanded AEO states, real clipboard readback, page and methodology disclosures, horizontal overflow and rendered copy widths/line breaks. Screenshots and the measurement record are written to the specified output directory, outside the repository.

For an authenticated preview, supply VERCEL_OIDC_TOKEN through the linked project's development environment. The script sends it only to the exact app origin and never writes it to its artifacts.

The header's `report-heading` marker identifies its own full-width content box. The AI table is a functional two-column comparison; page URLs may break inside a long path. There are no narrow paragraph-width exceptions.

## Acceptance

- Both saved-result flows pass, with no new scan or email.
- All 28 rendered states pass, plus page/methodology disclosure overflow checks.
- Soni shows six linked excluded pages and 19 of 25 passing the exclusion check.
- Sakuraba shows five passing check counts, no empty priority finding, and no overall grade.
- Focused model, component and presentation tests cover historical reports, partial results, missing evidence and search-versus-training crawler scope.
- Review both final reports before merging; merge approval is separate.
