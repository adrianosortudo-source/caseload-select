# Content Studio SEO/AEO Spec (design pass, no schema changes)

**Status:** Design and product spec only. No code, no migrations, no Supabase writes in this pass.

**Written:** 2026-07-02. **Author:** product-design pass, operator-directed.

**Hard constraint carried through this entire spec:** Task #12 (migration history
reconciliation on caseload-select-ca) is open. No new schema migration may be
authored or applied to the production database until that task closes and
`supabase db push --linked` is a trusted path again. Every recommendation below
is checked against that constraint and tagged with where it lives (existing
JSONB column, new application code, or a genuine schema change deferred to
Phase 4).

**Source artifacts read for this pass:**
- `src/app/api/admin/content-studio/pieces/[id]/draft/route.ts`
- `src/lib/content-validators.ts`
- `src/lib/content-studio.ts`
- `06_Clients/DRGLaw/03_Authority/Strategy/drg_strategy_v2.upload.json`
- `supabase/migrations/20260626100000_content_studio_format_taxonomy.sql`
- `supabase/migrations/20260626100100_content_studio_doctrine_p0.sql`
- `supabase/migrations/20260626100200_content_studio_compliance_formats.sql`
- `supabase/TASK_12_RECONCILIATION_PLAN.md`
- `RUNBOOK_20260626_content_studio_apply.md` (Lane 1 runbook)

---

## 1. Product goal

Content Studio is a law-firm SEO/AEO content engine, not a social distribution
tool. The product's job is to produce publish-ready pages and documents that
do two things at once: rank for the specific queries a prospective client
types into a search box, and get quoted directly by AI answer surfaces
(Google AI Overviews, ChatGPT, Perplexity, and similar) as the source of the
answer. Every generated piece traces back to three things: a query someone
actually asks, a verifiable entity (the firm and the named lawyer) answering
it, and a compliance-checked answer that survives LSO Rule 4.2-1 review.

Social repurposing (GBP cards, LinkedIn shares) stays in the product as a
downstream distribution layer. It is not the design center. The
`surface_bundle_per_format` and `weekly_edition_cadence` fields already in
`drg_strategy_v2.upload.json` describe that repurposing correctly: social
posts point back to a canonical page, they do not stand alone as the SEO
asset.

The practical test for any new Content Studio feature under this goal: does
it make a page more likely to answer a real query directly, or does it make a
page easier to schedule and share. The first is in scope for this spec. The
second is already built.

---

## 2. Supported content formats

The taxonomy already carries ten format values across three migrations
(`format_taxonomy`, `doctrine_p0`, `compliance_formats`). Widening the
`content_pieces_format_check` / `content_calendar_slots_planned_format_check`
CHECK constraints is exactly the kind of change Task #12 blocks right now, so
this section's design principle is: reuse the existing ten format values and
parameterize them with new `source_brief` fields wherever possible, instead of
proposing new enum values.

| Priority format | Taxonomy status today | SEO/AEO design decision |
|---|---|---|
| `canonical_service_page` | Exists in the CHECK constraint and in `format_specs`. Currently blocked at the API layer: `draft/route.ts` returns HTTP 422 for it (`STRUCTURED_OUTPUT_REQUIRED_FORMATS`) because the generator only emits Markdown and this format needs structured JSON output. | This is the flagship SEO/AEO format. It cannot generate at all until Phase 3 (structured output branch) ships. Everything else in this spec that touches `canonical_service_page` is written against the format spec that already exists in the strategy JSON, not against a working generator. |
| `checklist` (lead magnet) | Exists, generates today (Markdown into the PDF renderer contract). | Stays a PDF magnet. Its SEO surface is not the PDF itself; it is the `landing_page` that wraps it. Attach the SEO/AEO input model to the `landing_page` format spec, not to `checklist`. |
| FAQ block | Does not exist as a top-level format. `canonical_service_page.structure` already lists `faq_block_question_h2_direct_first_sentence` as one section, and `counsel_note.metadata_fields` already lists `faqs`. | Do not add `faq_block` as a new format value now (that is a CHECK-constraint migration). Design it as a structured sub-block: a JSON array of `{question, answer}` pairs living inside `body_structured` (an existing JSONB column on `content_piece_versions`, see Section 10) and rendered inline wherever a format's `structure` array calls for it. A standalone FAQ hub page is a legitimate Phase 4 ask if DRG wants freestanding FAQ URLs independent of a service page; that is a genuine new format value and waits for Task #12 to close. |
| Article / counsel note | Exists, generates today, the only long-form Markdown format currently live. | Because this is the one format that can generate right now, it is the first place Phase 1 and Phase 2 of this rollout land. Extend it to carry the answer-first opening rule (Section 4) even though its `default_awareness_stage` is `solution_aware`, not the earliest-funnel stage; the answer-first discipline applies at every awareness stage, only the depth of the answer changes. |
| Location / practice-area page | Does not exist as a distinct format. | Do not create a new format. Parameterize `canonical_service_page` with a `service_area` field on `source_brief` (Section 3) and a `jurisdiction_scope` note in `format_specs.canonical_service_page`. A Toronto commercial-lease page and a (hypothetical) Ottawa commercial-lease page are the same format with a different `service_area` value, not two formats. |

---

## 3. SEO/AEO input model

Every field below is designed to live on `content_pieces.source_brief`
(JSONB, already exists, already the home of `decision_question`,
`legal_distinction`, `consequence`, `practice_area`, `matter_type`,
`jurisdiction`, `audience`, and more per `buildUserPrompt`'s `fieldLabels`
dictionary). No new column is proposed for Phase 1 or 2.

| Field | Type | Status | Notes |
|---|---|---|---|
| `primary_query` | string | New | The single query this piece is built to answer. One per piece. Drives the answer-first paragraph and the title/H1 validator. |
| `secondary_queries` | string[] | New | Related queries this piece should also cover in subheads or body, without forcing a section per query. |
| `client_question_variants` | string[] | New | The way a real client phrases the question, in their own words (not SEO-tool phrasing). Feeds the FAQ block and the H2-as-question validator. Distinct from `secondary_queries`: these are conversational, not keyword-shaped. |
| `jurisdiction` | string | Already exists | Already read by `buildUserPrompt`. No change needed beyond making it a required field for the two SEO-facing formats. |
| `practice_area` | string | Already exists | Same as above. |
| `service_area` | string \| string[] | New | City or region names for local relevance. Not present anywhere in `canonical_nap` today (see Section 11, missing data). |
| `target_audience` | string | Already exists (as `audience`) | No rename needed; document the existing key as the canonical field. |
| `search_intent` | enum: `informational` \| `commercial_investigation` \| `transactional` \| `navigational` | New | Shapes tone and CTA placement. A `commercial_investigation` piece (e.g., "how much does a lease review cost") can name a fee range if `verified_facts = true`; an `informational` piece should not lead with cost at all. |
| `answer_summary` | string, one to three sentences | New | The plain-language answer this piece exists to give. This is the seed text for the answer-first opening (Section 4) and the closest thing to an AI-Overview-citable sentence the piece will produce. Written by the operator before generation, not by the model. |
| `entity_facts` | object | New | Matter-type-specific facts the piece is allowed to state as fact (a statute name, a filing deadline shape, a process step count). Same discipline as the existing `verified_facts` flag: anything not in `entity_facts` and not in the strategy JSON's `authority_assets` gets flagged by `validateFactualClaim` as unverified. |
| `author_facts` | object | New, but should default from strategy | The named lawyer's credentials. `canonical_nap` and `authority_assets` in the strategy JSON already carry this at the firm level (legal name, LSO member number, degrees, bar calls). Per-piece `author_facts` should be optional and only used to override the default author for a firm with more than one lawyer; for DRG today it should stay empty and inherit from strategy. |
| `internal_link_targets` | array of `{url, anchor_text_hint, relation}` | New | `relation` is one of `supports`, `next_step`, `related_matter`. URLs must resolve to the firm's own domain (validated server-side, not trusted from operator input verbatim, see Section 8). |
| `compliance_constraints` | object | Already exists (distributed) | `verified_facts`, `legitimate_policy_violation`, and the format-level `voice_rules.lso_rules` already do this job today. No new field; document the existing surface as the canonical compliance-constraints input. |

---

## 4. Answer-first drafting rules

`drg_strategy_v2.upload.json` already states the doctrine for
`canonical_service_page`: *"The first paragraph (within the first 150-200
words / top 30% of the page) must contain the direct answer to the page's
target query,"* citing a CXL study that 55% of AI Overview citations come
from the first 30% of a page. This section generalizes that rule and makes it
enforceable across every SEO/AEO format, not just `canonical_service_page`.

Rules for the first 150-200 words of any AEO-designated piece:

1. **Direct answer first.** Sentence one states the actual answer to
   `primary_query` in plain language. Not a definition of the topic, not a
   restatement of the question, the answer itself.
2. **Jurisdiction visible.** The jurisdiction (`Ontario`, or the specific
   jurisdiction on the piece) appears in the H1 or the first paragraph. Not
   buried in a footer disclaimer.
3. **Matter type visible.** The named matter or practice area appears by the
   second sentence.
4. **No vague intro.** Generic topic-scoping openers are banned in this
   position: "Understanding X can be complex," "When it comes to X,"
   "Navigating X" (note: "navigate/navigating" is already in
   `voice_rules.banned_vocabulary`; this rule extends the same discipline to
   the opening specifically, since a banned-vocabulary hit anywhere in the
   piece is already caught, but a vague-but-clean-vocabulary opener is not).
5. **No legal-essay opening.** No history of the doctrine, no "since the
   common law first recognized," before the answer. Context, if needed,
   comes after the answer, not before it.
6. **No unsupported claims.** The opening paragraph is held to the same
   `validateFactualClaim` standard as the rest of the piece. Nothing in this
   rule creates an exception for the first paragraph; if anything, the
   opening is the highest-risk sentence for an unverified statistic because
   it is the sentence most likely to be quoted verbatim by an AI answer
   engine.
7. **No timing or outcome promises.** Reuses `validateTimingPromise` and
   `validateLsoCompliance` exactly as they exist today. An answer-first
   opening is not an exception to LSO Rule 4.2-1; it is the paragraph under
   the most scrutiny.

Design note: rules 6 and 7 are not new validators. They are the existing
compliance battery applied with no carve-out to the new highest-value
paragraph in the piece. Section 9 makes this explicit with a fixture that
proves an SEO-optimized opening can still fail compliance.

---

## 5. AEO readiness validator

Every check below is designed as a deterministic function following the
existing pattern in `content-validators.ts` (`(text, ...) => ValidatorResult`,
`Finding[]` with `rule`/`severity`/`message`). Several of these are already
named as intended checks inside `drg_strategy_v2.upload.json`'s
`canonical_service_page.structural_validators` array
(`named_author_present`, `faq_block_present`, `answer_in_top_30_percent`,
`last_updated_date_visible`) but none of the four exist yet in
`content-validators.ts`. This spec closes that gap.

| Check | New function | Status | Design |
|---|---|---|---|
| Direct answer appears near the top | `validateAnswerInTop30Percent` | Promised in strategy JSON, not implemented | Take the first 30% of the piece by word count. Confirm it contains substantive overlap (stemmed keyword match, not exact string) with `primary_query` and, ideally, near-verbatim overlap with `answer_summary` from `source_brief`. Warn if overlap is present but thin; fail if the first 30% contains none of the primary query's content words. |
| H1/H2s map to real questions | `validateHeadingQueryAlignment` | New | Extract all H1/H2 lines. For each, check against `client_question_variants` and `secondary_queries`. A heading with no match to either list is not an automatic fail (some structural headings, like "How the process works," are legitimate); warn only when the piece's heading set as a whole shows low coverage of the supplied question variants. |
| Jurisdiction appears early | `validateJurisdictionEarly` | New | Confirm `source_brief.jurisdiction` appears within the first 150 words. Fail if absent from the whole piece; warn if present but only after the first 150 words. |
| Firm/lawyer entity is present | `validateEntityPresent` | New | Confirm the legal entity name or the lawyer's public-facing name (both already defined once in `strategy_json.canonical_nap`, no per-piece re-entry needed) appears at least once in the piece. |
| Author/entity block exists | `validateNamedAuthorPresent` | Promised in strategy JSON, not implemented | Confirm a byline pattern near the top or bottom of the piece (matches the existing `byline_format` convention: `{byline} · {topic_short} · {publish_date}`) plus at least one credential marker (LSO member reference, degree, or bar call, sourced from `authority_assets`). |
| Last-updated date exists | `validateLastUpdatedDateVisible` | Promised in strategy JSON, not implemented | Confirm a date-pattern appears adjacent to a "last updated" or "reviewed" marker string. Phase 1-3 note: there is no dedicated `last_updated_at` column on `content_pieces` today; the validator checks for the literal marker text in the body, and the true source-of-record date lives in `seo_metadata` (existing JSONB, see Section 10) until Phase 4 considers a real column. |
| FAQ block exists where format requires | `validateFaqBlockPresent` | Promised in strategy JSON, not implemented | For formats whose `structure` array includes an FAQ section marker, confirm at least N question/answer pairs exist (H3-or-bold question followed by an answer paragraph, or a structured `body_structured` FAQ array). Cross-reference `schema_directives.faqpage_status` from the format spec: this check is a page-comprehension and AI-citation signal, not a Google rich-result requirement (Google removed FAQ rich results 2026-05-07, a fact already recorded in the strategy JSON; the validator message should say so, so an operator does not chase a SERP feature that no longer exists). |
| No banned marketing claims | reuse existing battery | Already built | The AEO validator does not duplicate `validateLsoCompliance`, `validateTimingPromise`, `validateSpecialistSelfDesignation`, `validateFakeScarcity`, `validateWeaselWords`, `validateLsoSuperlatives`, `validateNoUsTrustBadges`, `validateNoLsaQualityClaim`. It runs alongside them in the same `runDeterministicValidators` pass. |
| Schema directives present | `validateSchemaDirectivesPresent` | New | Not a text-regex check. Confirms the piece version's structured output (Section 7) includes every schema type listed in `format_specs.<format>.schema_directives`. This is an object-presence check against `body_structured` / `seo_metadata`, not against `body_markdown`. |

---

## 6. SEO readiness validator

| Check | New function | Design |
|---|---|---|
| Primary query present naturally in title/H1/intro | `validatePrimaryQueryPresence` | Stemmed, fuzzy match of `primary_query`'s content words against the title, H1, and first paragraph. Fail if absent from all three; warn if present in only one. |
| Secondary queries represented in subheads/body | `validateSecondaryQueryCoverage` | Ratio-based, following the same pattern already used by `validateApprovedVocabulary` (count matches / total supplied terms, warn under a threshold). Warn, not fail: forcing every secondary query into the body risks keyword stuffing, which the doctrine already forbids elsewhere (weasel words, rule of three). |
| Internal links present with natural anchor text | `validateInternalLinks` | Confirm at least a floor count (recommend 2) of markdown links exist, resolving to `internal_link_targets`. Reuse the anchor-text-context extraction already built for `validateRejectedCtas` (the `[label](url)` regex) and check anchor text is not a generic phrase already on the `rejected_ctas` list ("click here" fails both the CTA-clarity doctrine and the SEO anchor-text doctrine for the same underlying reason). |
| Local/service-area language included | `validateServiceAreaPresence` | Only runs when `source_brief.service_area` is set. Confirms the service area name(s) appear at least once, ideally near the jurisdiction mention. |
| Duplicate/cannibalization warning | `validateNoCannibalization` | Not a pure text validator. Requires a query against the firm's existing `content_pieces` corpus (same `firm_id`, same `format`, same or overlapping `practice_area`) comparing `primary_query` similarity. This has to run at generation or publish time inside the API route, not inside `runDeterministicValidators`'s pure-text pass. Flagged for Phase 3 because it needs the structured-output pipeline's piece metadata to be populated consistently first. |
| Word range and section completeness | reuse existing | `validateWordCount`, `validateRequiredSections`, and `validatePageStructure` already do this generically for any format with a `word_range`, `structure`, or `page_structure` entry in its format spec. `canonical_service_page`'s `structure` array already exists; these validators apply to it with no code change once the format actually generates (Phase 3). |

---

## 7. Schema output design

Design principle taken directly from the strategy JSON's own
`schema_directives` note on `canonical_service_page`: `Attorney` is
deprecated (2024), use `LegalService` for the entity and `Person` with
`worksFor` for the named lawyer; keep `FAQPage` markup as a page-comprehension
and off-Google-AI signal, not a rich-result bid. Every JSON-LD block below is
populated from fields that already exist in
`strategy_json.canonical_nap` / `authority_assets`, so no new per-piece data
entry is required for the entity-level facts.

**LegalService**

```json
{
  "@context": "https://schema.org",
  "@type": "LegalService",
  "name": "DRG Law Professional Corporation",
  "alternateName": "DRG Law",
  "url": "https://drglaw.ca",
  "telephone": "647-584-0998",
  "email": "info@drglaw.ca",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "PO Box 26033 RPO Broadway",
    "addressLocality": "Toronto",
    "addressRegion": "ON",
    "postalCode": "M4P 0A8",
    "addressCountry": "CA"
  },
  "areaServed": ["Ontario"],
  "availableLanguage": ["English", "Portuguese"],
  "priceRange": null
}
```

`priceRange` stays null unless a factual figure is on file and cleared by
`verified_facts`; do not populate it with a marketing-shaped range.
`areaServed` should read from `source_brief.service_area` where set, falling
back to `["Ontario"]`.

**LocalBusiness (fallback)**

Same shape as `LegalService` with `@type: "LocalBusiness"`, used only where a
consuming surface does not recognize `LegalService` (per the strategy JSON's
own `fallback_entity_type` note). Not the default; `LegalService` is.

**Person / author**

```json
{
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "Damaris Regina Guimaraes",
  "worksFor": { "@type": "LegalService", "name": "DRG Law Professional Corporation" },
  "knowsLanguage": ["English", "Portuguese"],
  "hasCredential": [
    {
      "@type": "EducationalOccupationalCredential",
      "credentialCategory": "license",
      "recognizedBy": { "@type": "Organization", "name": "Law Society of Ontario" },
      "url": "https://lso.ca/public-resources/finding-a-lawyer-or-paralegal/directory-search/member?MemberNumber=91022I"
    },
    {
      "@type": "EducationalOccupationalCredential",
      "credentialCategory": "degree",
      "about": "Global Professional Master of Laws (GPLLM), University of Toronto, 2023"
    }
  ]
}
```

Populate `hasCredential` from `authority_assets.four_as.accreditations` where
`publishable: true`. Never populate this block from `lso_record_fields`
framed as a competitive claim; those are factual register entries, citeable,
but not accreditations earned by evaluation, per the strategy JSON's own
distinction.

**FAQPage**

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Do I need a lawyer to review a commercial lease in Ontario?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "A commercial lease is negotiable before signature and difficult to renegotiate after. A lawyer reviews the clauses that carry the most risk (relocation, assignment, and repair obligations) before you sign, not after a dispute starts."
      }
    }
  ]
}
```

Every `Question`/`Answer` pair must independently pass the same compliance
battery as body text (Section 9 fixture proves this explicitly). This schema
block is not exempt from `validateLsoCompliance` just because it is JSON, not
prose.

**BreadcrumbList**

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://drglaw.ca" },
    { "@type": "ListItem", "position": 2, "name": "Corporate/Commercial", "item": "https://drglaw.ca/corporate-commercial" },
    { "@type": "ListItem", "position": 3, "name": "Commercial Lease Review", "item": "https://drglaw.ca/corporate-commercial/commercial-lease-review" }
  ]
}
```

**Article / BlogPosting (for `counsel_note`)**

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Three terms in the relocation clause carry the whole risk",
  "author": { "@type": "Person", "name": "Damaris Regina Guimaraes" },
  "publisher": { "@type": "LegalService", "name": "DRG Law Professional Corporation" },
  "datePublished": "2026-07-02",
  "dateModified": "2026-07-02",
  "inLanguage": "en"
}
```

---

## 8. Prompt-builder changes

`buildSystemPrompt` in `draft/route.ts` already follows a deliberate layered
order (Origin, Personality, Artifact+Format, Lexicon, LSO compliance,
Opening+paragraph discipline, Strategic messages, Reference, Factual-claim
guard rail last for maximum recency). The recommendations below fit inside
that structure rather than replacing it, to avoid prompt contamination.

**New SEO/AEO layer, inserted between the Artifact+Format layer and the
Lexicon layer.** This position was chosen deliberately: `primary_query`,
`secondary_queries`, `search_intent`, and `answer_summary` are task-shaping
(what this piece is for), the same category as the format and word-count
directives that already sit in that position, not identity-shaping (Lexicon
and later layers). Example addition to `buildSystemPrompt`:

```
if (sourceBrief.primary_query) {
  parts.push(
    `SEO/AEO target: this piece answers "${sourceBrief.primary_query}". ` +
    `Secondary queries to cover naturally where they match a real reader ` +
    `question: ${(sourceBrief.secondary_queries ?? []).join("; ")}.`
  );
}
```

**Extend the existing Opening discipline block, do not add a new one.** The
answer-first rule (Section 4) is a stricter version of a rule the prompt
already states ("Opening discipline: lead with consequence to the reader, not
firm performance"). Extending that sentence keeps the answer-first directive
in the highest-primacy position it can occupy without becoming a new,
separately-weighted instruction the model might trade off against the rest of
the prompt:

```
"Opening discipline: the first paragraph states the direct answer to the
target query in plain language before anything else. Lead with the answer,
not with a definition of the topic, not with firm performance..."
```

**Schema-awareness instruction, gated to structured-output formats only.**
Do not add this for Phase 1/2 formats (`counsel_note`, `checklist`,
`landing_page`); those are Markdown-only today and adding schema instructions
to a Markdown generation prompt produces schema-shaped prose fragments with
nowhere to go. Add this only inside the Phase 3 structured-output branch,
telling the model exactly which schema blocks it must also emit for the
active format (read from `format_specs.<format>.schema_directives`).

**`buildUserPrompt` changes.** Extend the existing `fieldLabels` dictionary
(the same "label: value" line-by-line pattern already used for
`decision_question`, `legal_distinction`, and so on) with:
`primary_query`, `secondary_queries` (joined), `client_question_variants`
(joined), `service_area`, `search_intent`, `answer_summary`. This keeps the
existing discipline that every prompt input is a labeled, human-readable
line, never a raw JSON blob injected wholesale.

**`internal_link_targets` gets special handling, not a plain fieldLabel
entry.** Render it as an explicit, bounded instruction rather than a data
dump: *"Internal link options (use only where the anchor text reads
naturally in context; do not force a link into every paragraph): [list]."*
Before this reaches the prompt, the API route validates every URL in
`internal_link_targets` resolves to the firm's own domain. An
operator-entered off-domain URL should be rejected at the input layer, not
trusted into a prompt where the model might present it as a recommended next
step.

**Contamination guardrails, stated explicitly for this feature:**
1. SEO/AEO fields enter the prompt only as labeled lines from `source_brief`,
   the same discipline the prompt already enforces for every other field.
   No raw strategy JSON or SEO tool export gets pasted into a prompt string.
2. The SEO/AEO layer is additive. It does not introduce new banned or
   approved vocabulary; those stay owned by `voice_rules` at the strategy
   level.
3. The compliance layers (LSO, factual-claim, timing-promise) are never
   made conditional on the SEO/AEO layer. An SEO-optimized answer that fails
   LSO Rule 4.2-1 is still a failed piece; the SEO layer does not get a
   "compliance can be looser here because this is the money paragraph"
   exception. Section 9's fixtures test this directly.

---

## 9. Validator changes

New `ValidatorKey` entries to add to the union in `content-validators.ts`:
`answer_top_30`, `heading_query_alignment`, `jurisdiction_early`,
`entity_present`, `named_author_present`, `last_updated_visible`,
`faq_block_present`, `schema_directives_present`, `primary_query_presence`,
`secondary_query_coverage`, `internal_links`, `service_area_presence`,
`no_cannibalization`. Each new function follows the existing signature
convention: `(text, ...args) => ValidatorResult`, returns `pass` when no
issues, and defaults to fail-secure (checks run unless explicitly disabled
via a new `formatting_rules` flag) matching the pattern already used for
`no_timing_promises`, `no_specialist_language`, and `no_factual_hallucination`.

### Fixture: `validateAnswerInTop30Percent`

**Positive (should pass).** First paragraph of a 900-word piece:

> Ontario commercial leases put the relocation risk on the tenant unless the
> lease says otherwise. A lawyer reviews the relocation clause, the
> assignment clause, and the repair obligations before you sign, because
> those three terms carry the risk a standard-form lease does not disclose
> in plain language.

This directly answers a plausible `primary_query` ("does a commercial lease
put relocation risk on the tenant") within the first 60 words. Passes.

**Negative (should fail).** Same target query, opening paragraph:

> Commercial leases in Ontario can be complex documents with many moving
> parts. Understanding the full picture requires looking at several factors
> that vary by landlord, building type, and negotiation history.

No answer, no jurisdiction-specific content word overlap with the query,
generic topic-scoping language. `validateOpeningDiscipline`'s vague-intro
extension (Section 4, rule 4) would also flag this independently.

### Fixture: `validateNamedAuthorPresent`

**Positive.** Body contains: `Damaris Regina Guimaraes · Commercial Lease
Review · 2026-07-02` matching the existing `byline_format` convention, plus a
credential line referencing LSO membership. Passes.

**Negative.** Body has no byline anywhere, only a generic closing "Contact us
to learn more." Fails.

### Fixture: `validateFaqBlockPresent`

**Positive.** Piece format is `canonical_service_page` (whose `structure`
array includes the FAQ section). Body contains three H3 questions each
followed by a one-to-three-sentence answer. Passes.

**Negative.** Same format, body ends after the CTA with no FAQ section.
Fails.

**Edge case (compliance composition, the important one).** A technically
well-formed FAQ block:

> **Will I win my case if I hire DRG Law?**
> Yes, DRG Law has a strong track record of winning cases for clients in
> similar situations.

This passes `validateFaqBlockPresent` (a question, followed by an answer,
correctly structured) and must still fail the piece overall, because
`validateLsoCompliance` (outcome promise: "will win") and
`validateFactualClaim` (unverified "strong track record" claim) fire on the
same text. This fixture is the one that proves the SEO/AEO validators and
the compliance validators are independent passes that both have to clear;
an SEO-shaped answer is not a compliance-exempt answer. Recommend this exact
fixture (or one structurally identical to it) ship in the test suite as
`faq-block-outcome-promise.test.ts`, specifically because it is the failure
mode most likely to slip through if a future contributor treats "the FAQ
validator passed" as sufficient.

### Fixture: `validateJurisdictionEarly`

**Positive.** "Ontario" appears in the H1: `Commercial Lease Review /
Ontario Tenants`. Passes immediately regardless of body content.

**Negative.** Piece never states a jurisdiction anywhere, relying on the
reader to infer it from the firm's location. Fails; the strategy-level
`jurisdiction: "Ontario"` field on the firm record is not a substitute for
the piece stating it, because an AI answer engine quoting the piece in
isolation would not carry that context.

### Fixture: `validateInternalLinks`

**Positive.** Body contains `[the relocation-clause checklist](https://drglaw.ca/resources/commercial-lease-relocation-checklist)` with anchor text naming the destination. Passes both the internal-links floor and, incidentally, the existing rejected-CTA doctrine (this anchor text would also pass `validateRejectedCtas`, since it names the destination instead of reading "click here").

**Negative.** Body contains a single link with anchor text "here": `see [here](https://drglaw.ca/resources/...)`. Fails the natural-anchor-text check even though the link target itself is valid and on-domain.

---

## 10. Rollout plan without migrations

**Operator-confirmed build order (2026-07-02).** This sequence supersedes the
Phase 1/2/3 grouping below for scheduling purposes; the phase descriptions
still hold for what belongs in each bucket and why, but work proceeds in this
order, not strictly phase-by-phase:

1. **Structured-output branch first.** Unblocks `canonical_service_page` and
   the other `STRUCTURED_OUTPUT_REQUIRED_FORMATS` (`paid_traffic_landing`,
   `review_request`, `review_response`). Without this, the flagship SEO
   format cannot generate at all, so it leads rather than waiting behind the
   validator and prompt work in Phase 2's default ordering below.
2. **Validators next.** The four already-promised AEO checks first
   (`named_author_present`, `faq_block_present`, `answer_in_top_30_percent`,
   `last_updated_date_visible`), then the broader SEO validator set, wired
   into `runDeterministicValidators`.
3. **Prompt layer.** SEO/AEO labeled inputs into `buildSystemPrompt` /
   `buildUserPrompt`, keeping the existing no-raw-JSON-dump discipline from
   Section 8.
4. **DRG data gaps.** `service_area`, the still-unnamed
   commercial-lease-review signature method, an internal-link source of
   truth. See Section 11 for the full list.
5. **Fixture suite.** Especially the FAQ-block-passes-SEO-but-fails-compliance
   case (Section 9), which proves an SEO pass is not a compliance pass.

**Confirmed do-not-touch list, holds until Task #12 / Lane 1 closes:** CHECK
constraints, new DB columns, `faq_block` as a standalone format enum value,
GIN indexes, link-graph tables, a `last_updated_at` schema column. All of
this is Phase 4 material as described below, none of it is scheduled.

**Phase 1: strategy JSON and prompt changes only.**
- Extend `format_specs.counsel_note` and (once unblocked) `format_specs.canonical_service_page` in `drg_strategy_v2.upload.json` to document the new `source_brief` field conventions from Section 3. This is a JSON edit to an existing JSONB row, not a migration.
- Ship the `buildSystemPrompt` / `buildUserPrompt` changes from Section 8.
- Populate `content_piece_versions.seo_metadata`, an existing JSONB column that is defined but currently unused by the draft route, with `primary_query`, `secondary_queries`, and the draft JSON-LD blocks once a piece generates. No migration; the column already exists.
- Sequencing note: `counsel_note` is the only format that can generate today. Phase 1's real-world test of the answer-first rule and the SEO/AEO prompt layer has to run on `counsel_note` pieces, because `canonical_service_page` is still gated by `STRUCTURED_OUTPUT_REQUIRED_FORMATS` until Phase 3.

**Phase 2: validators and fixtures.**
- Add the thirteen new validator functions from Section 9 to `content-validators.ts`, following the existing function and `Finding` conventions exactly.
- Extend the `ValidatorKey` union and `ValidatorConfig.formatting_rules` with the new flags, defaulting every new check to enabled (fail-secure), mirroring how `no_timing_promises`, `no_specialist_language`, and the P0 compliance batch defaulted.
- Wire the new checks into `runDeterministicValidators`.
- Build the fixture test suite from Section 9, including the compliance-composition edge case, before treating any new validator as production-ready.
- This phase is application code, not database schema. It does not require Task #12 to close.

**Phase 3: structured output branch.**
- Build the JSON-schema generator branch that `draft/route.ts` already anticipates in its own comment (`STRUCTURED_OUTPUT_REQUIRED_FORMATS`). This unblocks `canonical_service_page`, `paid_traffic_landing`, `review_request`, and `review_response` for actual generation.
- Wire the Section 7 schema JSON-LD emission into this branch's output. Store it in `content_piece_versions.body_structured` (existing, currently used for structured formats per the `createPieceVersion` signature) and mirror the flat summary fields into `seo_metadata`.
- Add `validateNoCannibalization`, which needs a corpus query against `content_pieces` for the firm; this is the one check in this spec that queries the database rather than validating text in isolation, so it waits until pieces are reliably carrying `primary_query` in a structured, queryable location (Phase 1/2 output).
- Add the internal-link domain allowlist check described in Section 8.

**Phase 4: schema and storage changes, after migration history is healthy.**
Nothing in this phase starts until Task #12 closes and `supabase db push --linked` is trusted again. Candidates for this phase, none of them urgent enough to justify forcing the migration question early:
- A real `last_updated_at` / `date_reviewed` column on `content_pieces`, replacing the body-text marker approach from Section 5.
- A dedicated `faq_block` format value in the CHECK constraints, if DRG wants freestanding FAQ hub pages independent of a parent service page.
- A `content_piece_seo` structured column (or a GIN index on the existing `seo_metadata` JSONB) if the corpus grows large enough that JSONB scans for `validateNoCannibalization` become slow. Not needed at DRG's current or near-term volume.
- A first-class internal-link graph table, if the manual `internal_link_targets` list per piece becomes a maintenance burden across a large corpus.

---

## 11. DRG-specific application

### Example: canonical_service_page

**Format:** `canonical_service_page` (not yet generatable, Phase 3 dependency; this shows the intended input/output shape).

**source_brief:**
```json
{
  "primary_query": "do I need a lawyer to review a commercial lease in Ontario",
  "secondary_queries": [
    "commercial lease review lawyer Toronto",
    "what does a lawyer check in a commercial lease"
  ],
  "client_question_variants": [
    "Do I actually need a lawyer for this or can I just read it myself?",
    "What's the worst clause that gets missed?",
    "How much does a lease review cost?"
  ],
  "jurisdiction": "Ontario",
  "practice_area": "Corporate/Commercial Law",
  "matter_type": "commercial_lease_review",
  "service_area": ["Toronto"],
  "audience": "Ontario SMB owners signing or renewing a commercial lease",
  "search_intent": "commercial_investigation",
  "answer_summary": "A commercial lease is negotiable before signature and difficult to renegotiate after. A lawyer reviews the relocation, assignment, and repair clauses, the three terms that carry the most risk, before you sign.",
  "internal_link_targets": [
    { "url": "https://drglaw.ca/resources/commercial-lease-relocation-checklist", "anchor_text_hint": "the relocation-clause checklist", "relation": "next_step" }
  ]
}
```

**First 150 words (answer-first opening):**

> Ontario commercial leases put more of the relocation risk on the tenant
> than most owners expect, and the standard-form draft rarely flags it. A
> lawyer reviews the lease before you sign, focused on the relocation
> clause, the assignment clause, and the repair obligations, the three
> terms that carry the most risk in a typical Ontario commercial lease. You
> do not need a lawyer to read a lease. You need one to tell you which three
> clauses are negotiable before you sign, because they stop being
> negotiable the day after.

**FAQ block (structured, three pairs):**

```json
[
  {
    "question": "Do I need a lawyer to review a commercial lease in Ontario?",
    "answer": "A commercial lease is negotiable before signature and difficult to renegotiate after. A lawyer reviews the clauses that carry the most risk before you sign, not after a dispute starts."
  },
  {
    "question": "What does a lawyer actually check in the lease?",
    "answer": "The relocation clause, the assignment clause, and the repair obligations. These three terms decide who bears the cost when the landlord wants the space back, when you want to sell the business, or when something breaks."
  },
  {
    "question": "How much does a commercial lease review cost?",
    "answer": "A lawyer reviews the lease and gives a written cost estimate before starting work. The fee depends on the lease length and the number of negotiable terms."
  }
]
```

Note the third answer names no dollar figure and makes no timing promise; it
describes the process (estimate before work starts), consistent with
`voice_rules.lso_rules` and the existing `validateFactualClaim` /
`validateTimingPromise` gates.

**Schema stub:** `LegalService` + `Person` (Damaris) + `FAQPage` (the three
pairs above) + `BreadcrumbList` (Home / Corporate-Commercial / Commercial
Lease Review), each populated exactly as shown in Section 7.

### Example: checklist (lead magnet)

Reuses the commercial-lease relocation magnet already referenced in the
strategy JSON's own reference samples (`"Relocation magnet, bad-clause page
intro"`). The SEO/AEO fields attach to the `landing_page` format spec that
wraps this checklist, not to the `checklist` format spec itself, per the
Section 2 design decision:

```json
{
  "format": "landing_page",
  "primary_query": "commercial lease relocation clause checklist",
  "service_area": ["Toronto"],
  "internal_link_targets": [
    { "url": "https://drglaw.ca/corporate-commercial/commercial-lease-review", "anchor_text_hint": "the full lease review service", "relation": "related_matter" }
  ]
}
```

### Example: FAQ block

Shown inline above as part of the canonical service page. A standalone FAQ
block for the `counsel_note` on shareholder agreements (reusing the existing
reference excerpt's subject matter) would follow the same
`{question, answer}` array shape and attach to that piece's `body_structured`
once the format's `metadata_fields.faqs` entry is populated.

### What data is missing before generation

1. **`service_area` has no home today.** `canonical_nap` states an address
   and implies Toronto, but there is no explicit `service_area` array
   anywhere in the strategy JSON. Needs one entry before
   `validateServiceAreaPresence` or the `areaServed` schema field can be
   populated with anything other than a guess.
2. **`signature_method_per_matter_type.commercial_lease_review.name` is
   `null`, status `pending_definition`.** The candidate steps exist; the
   named method (an E-E-A-T-relevant, ownable asset per the strategy JSON's
   own `four_as` doctrine) does not yet have a name. Worth closing before
   the canonical service page ships, since a named method is a real
   differentiation signal and this page is exactly where it belongs.
3. **No last-reviewed/last-updated policy.** Nothing in the strategy JSON
   defines how often a service page should be reviewed or who signs off on
   the review. `validateLastUpdatedDateVisible` (Section 5) can check that a
   date marker exists; it cannot check that the date is honest without an
   operator process behind it.
4. **No internal-link graph or sitemap reference exists yet.** The
   `validateInternalLinks` domain-allowlist check (Section 8) needs a source
   of truth for "URLs that exist on drglaw.ca." Today that would have to be
   maintained by hand per piece; a lightweight sitemap fetch or a manually
   maintained URL list is a Phase 2 or 3 prerequisite, not a schema change.
5. **No query-research artifact.** `primary_query` and `secondary_queries`
   have to be authored by the operator per piece; nothing in the current
   stack does keyword research. Out of scope for this spec, flagged here so
   it is not assumed to exist.
6. **FAQ content for the canonical service page does not exist as source
   material anywhere.** The three-pair example above was drafted for this
   spec; it needs review and, if approved, entry into the piece's
   `source_brief` or `body_structured` before generation.
7. **Google's 2026-05-07 removal of FAQ rich results is already recorded in
   the strategy JSON's `schema_directives` note, but needs to be
   communicated to DRG/the operator explicitly** so the FAQ block is
   understood as an AI-citation and page-comprehension signal, not a SERP
   rich-result feature. Setting that expectation correctly now avoids a
   confused conversation later about why the FAQ markup did not produce a
   rich snippet.
