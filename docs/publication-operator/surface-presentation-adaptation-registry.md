<!-- DOC-META v1
doc-type: policy-registry
status: active
version: v1
last-edited: 2026-07-19
supersedes: none (additive to docs/publication-operator/publication-resolution-preflight-design-2026-07-19.md and DR-105)
-->

# Surface-presentation adaptation registry

This is the controlled registry DR-105 requires. A Surface-Presentation
Adaptation is never valid unless it is an exact match to a rule defined
here. This document is the registry; nothing else authors one at publish
time, and no agent may improvise a rule that is not written down below.

Each rule is scoped to one exact `firm + locale + source_surface +
destination_surface` tuple. There is no wildcard, default, or
inheritance between rules — a rule for one firm, locale, or surface pair
says nothing about any other, even for the same firm.

**This registry is documentation only.** No code in this codebase reads
this file at runtime; nothing here is enforced automatically. It exists
so a human or agent preparing a publication has one controlled place to
look up an already-approved adaptation, and so DR-105's eligibility
conditions have something concrete to point at.

## How this registry is used

1. Before rendering an approved version on a destination surface other
   than its source surface, resolve the exact tuple against this
   document.
2. If no rule matches, the outcome is `surface_adaptation_rule_missing`
   (see `docs/publication-operator/publication-resolution-preflight-design-2026-07-19.md`
   §4.1a and §5). This is a preflight failure, not a prompt to draft one.
3. If a rule matches, apply only its `allowed_output_changes`. Any other
   difference from the approved source resolves
   `substantive_adaptation_requires_approval` and routes to the deliverable's
   normal comment/suggestion/version/approval workflow (`CLAUDE.md`,
   "Content approval (Phase 2)"; a standalone written playbook for that
   workflow is not yet published on `origin/main`) — only the firm's
   lawyer approves it.
4. Record every field under `evidence_required` against the actual
   publication attempt.

## Rule: `drg_en_website_article_to_linkedin_article_lso_notice_v1`

The only rule currently defined in this registry. Portuguese and every
other locale, firm, or surface pair require their own explicit future
rule; no agent may generalize from this one rule to any other.

```yaml
rule_id: drg_en_website_article_to_linkedin_article_lso_notice_v1
firm: DRG Law Professional Corporation
locale: en-CA
source_surface: website_article
destination_surface: linkedin_native_article
source_approval_requirement: immutable_individually_approved_version
allowed_output_changes:
  - linkedin_title_and_masthead_formatting
  - exact_destination_compliance_block
  - platform_link_formatting
forbidden_output_changes:
  - substantive_body_change
  - legal_claim_change
  - scope_or_jurisdiction_change
  - CTA_change
  - translation
  - factual_change
  - new_citation_or_source
compliance_block_exact_text: |
  Legal information, not legal advice. What you read in this article is general information about the law. It is not legal advice for your situation. Sending an intake to DRG Law does not make DRG Law your lawyer. That only happens after DRG Law checks for conflicts and both sides sign a written agreement.
evidence_required:
  - source_deliverable_id
  - source_approved_version_id
  - source_integrity_identity
  - destination_account_id
  - adaptation_rule_id
  - rendered_output_integrity_identity
  - placement_id
  - publication_receipt_id
  - actor_id
  - timestamp
```

### Provenance

`compliance_block_exact_text` substitutes only the surface self-reference
in the locked DR-082 English wrapper (`06_Clients/DRGLaw/03_Authority/Website/drg-law-website/src/components/layout/LsoDisclaimer.tsx`
+ `src/lib/firm.ts`'s `lsoDisclaimer` string): "this website" becomes
"this article," and "Sending an intake" becomes "Sending an intake to
DRG Law" so the sentence still parses as a complete thought once
detached from the website's own "DRG Law" masthead context. No other
word changes. This exact substitution, and the reasoning for treating it
as presentation rather than substantive legal content, is recorded in
DR-105.

### Scope discipline

- This is the only currently defined rule.
- Portuguese and every other surface (GBP, email, any future channel)
  require their own explicit future rule, drafted and reviewed the same
  way this one was, never inferred from this one by pattern-matching.
- No agent may generalize from this one rule to any other firm, locale,
  or destination surface.

### What this rule does not do

Matching this rule resolves one preflight fact
(`resolve_surface_presentation_adaptation`) for one specific placement.
It does not create a LinkedIn Article, does not create or modify any
`content_placements` row, does not grant LinkedIn channel access (see
`channel_auth_missing` in the design document's §5 state machine — no
LinkedIn API credential or integration exists in this codebase as of
this rule's authoring), and does not itself constitute publication
authorization. A publication is eligible only once every fact in the
design document's §4 resolves, not this one alone.
