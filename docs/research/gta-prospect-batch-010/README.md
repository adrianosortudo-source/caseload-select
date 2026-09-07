# GTA prospect research — batch 010

## Purpose and boundary

This is a bounded research batch of **100 firms**, assembled to expand the
CaseLoad Select GTA prospect dataset beyond the records already available in
the operator console. It is a review packet, not an import instruction.

Every record is based on a firm-owned, publicly available roster or office
page. The batch does not use LSO automation, contact details, intake forms,
chat, booking, advertising libraries, Google Business Profile evidence, CRM
actions, or outreach.

## Research denominator

| Lane | Researched firms | Candidate at lane review | Held at lane review |
| --- | ---: | ---: | ---: |
| Core Toronto | 34 | 10 | 24 |
| West / north GTA | 33 | 17 | 16 |
| East / outer GTA | 33 | 24 | 9 |
| **Total** | **100** | **51** | **49** |

An eight-record supplemental lane was deliberately excluded after central
reconciliation established that the three original lanes already totalled the
approved 100-firm scope.

## Independent review outcome

The 51 lane candidates were independently reviewed by a different lane agent.

| Disposition | Firms |
| --- | ---: |
| Accepted for staging | 31 |
| Held after review | 7 |
| Rejected | 13 |
| Held at initial lane review | 49 |
| **Total research denominator** | **100** |

`accepted_for_staging` means the record has public, first-party roster and
office support, an explicit count qualifier, and no exact name/domain match in
the checked prior batch baseline. It does **not** mean that it is imported,
contacted, or approved for outreach.

## Evidence and review files

- Source lanes: `lanes/core.json`, `lanes/west-north.json`, and
  `lanes/east-outer.json`
- Independent reviews:
  `../../prospecting/reviews/gta-prospect-batch-010/core-validation.json`,
  `../../prospecting/reviews/gta-prospect-batch-010/west-north-validation.json`,
  and
  `../../prospecting/reviews/gta-prospect-batch-010/east-outer-validation.json`

## Required gate before database work

Before any of the 31 accepted records can appear in the operator console, the
central reviewer must generate a canonical staging manifest, run exact
domain/name reconciliation against the current 103 imported records, and
present the resulting count, source URLs, uncertainty, and exclusions for
explicit import approval. No database write is authorized by this packet.
