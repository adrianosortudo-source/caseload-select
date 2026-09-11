# GTA prospect operator import acceptance

This document governs the reusable operator importer. It is a review-and-apply workflow for sourced public research records, not an outreach, CRM, or consent workflow.

## Required planning outcomes

Every parsed source row must have exactly one displayed planning outcome before any database write:

| Outcome | Required condition | Apply rule |
| --- | --- | --- |
| `new` | Stable source key is absent and no deterministic identity review signal exists. | May be selected for confirmation. |
| `unchanged` | Same stable source key and same canonical source record already exist. | Do not create observations, audit `created`, or a new history item. |
| `update` | Same stable source key exists and the canonical source record has changed. | Append only the new sourced observations. Missing optional fields preserve earlier observations; they are not deletions. |
| `review_required` | Another record shares a normalized name, domain, or complete suite-preserving address; or source identity conflicts. | Never apply until an operator makes a recorded identity decision. |
| `invalid` | Shape, evidence URL/date, count qualifier, or public-contact provenance fails validation. | Never stage or apply. |

The UI must separately display `new`, `unchanged`, `update`, `review_required`, and `invalid` totals. It must not collapse an update into new or treat a review signal as an automatic merge.

## Stable-key and audit invariants

- The stable source key is the only automatic identity bridge across batches.
- A re-upload of an identical source record is idempotent across batches, not only within a batch.
- `created` is valid only when a new firm identity was actually created. Existing source keys must result in `unchanged` or `updated` audit state.
- Source batches retain their source hash and their individual record hashes.
- A failed or invalid batch cannot create a contact observation, firm, identity adjudication, roster observation, or audit entry marked applied.

## Address and identity guard

Address normalization is a review signal only. It must normalize spelling variants such as `342 Queen St W` and `342 Queen Street West`, while preserving unit identity. `200-342 Queen St W` and `100-342 Queen Street West` must not match. Shared name, domain, host, street, or city never selects a survivor or triggers an automatic merge.

## Owner/email evidence boundary

Owner, founder, principal, named-lawyer, and firm-inbox fields require a first-party public source URL and observation date. Store their relationship, email kind, source URL, and observation date. Their presence does not create an outreach permission, CRM contact, consent record, or delivery task.

## Regression fixture

`src/lib/__fixtures__/gta-prospect-import-acceptance.ts` supplies the synthetic cases that every import-planning and apply implementation must cover. The cases deliberately include a re-upload, a changed roster, blank optional fields, a same-domain review signal, a suite guard, public owner/email provenance, and an invalid record.

