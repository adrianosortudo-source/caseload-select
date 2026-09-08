# Firm identity and source reconciliation contract

This contract governs how future legacy prospect rows may attach to the shared CaseLoad Select firm identity. It complements the current prospect qualification statuses; it does not replace qualification, evidence review, or the existing expansion import boundary.

The implementation is in `src/lib/firm-identity-reconciliation.ts`.

## Stable identity

- A governed firm uses one stable `FIRM-` ID, one canonical name, and one canonical domain.
- Stable IDs are allocated and persisted by the governing system. The matcher never derives an ID from a firm name, website, or source-row position.
- A legacy system and record ID form a collision-safe source-record key. Every retained relationship to a governed firm is an explicit source-record mapping.

## Source-record decisions

| State | Meaning | Automatic merge |
| --- | --- | --- |
| `confirmed` | Named evidence supports one governed firm ID. | Allowed only when no supplied high-confidence identifier conflicts. |
| `unresolved` | The source row may represent one or more governed firms, but the evidence is insufficient. | Never. |
| `distinct` | The source row was reviewed and is not any of the listed governed firms. | Never. |

Each mapping carries its observation date, confidence, evidence IDs, and a human-readable reason. Contradictory mappings for the same source record are treated as unresolved even if one says `confirmed`.

## Evidence precedence

Identity-field observations are ranked deterministically by:

1. source authority: public regulator, first-party canonical source, official business profile, publisher record, directory record, then legacy dataset;
2. newer observation date within the same source class;
3. confidence within the same source and observation date;
4. evidence ID only as a stable ordering key when the preferred values agree.

Equally ranked observations with different values return a conflict. The resolver does not silently choose one.

## Matching rules

The matcher applies these gates in order:

1. an explicit source-record decision;
2. a supplied stable firm ID that exists in the governed set;
3. one exact normalized canonical-domain match;
4. diagnostic-only normalized-name similarity;
5. no match.

Only the first three paths can produce a `confirmed` result, and every confirmed result exposes `mergeAuthorized: true`. Every unresolved, ambiguous, conflicting, name-only, or explicitly distinct result exposes `mergeAuthorized: false`.

## Deliberate limitations

- No fuzzy name, address, phone, lawyer-name, redirect, or corporate-affiliation matching.
- No automatic domain-alias or rebrand merge. Store a reviewed source mapping instead.
- No stable-ID allocation, persistence, migration, or database write.
- No automatic resolution when two governed firms share a canonical domain.
- No forced merge when a legacy row supplies a stable ID and domain that disagree.

These limitations keep uncertain legacy candidates reviewable without contaminating the shared firm identity.
