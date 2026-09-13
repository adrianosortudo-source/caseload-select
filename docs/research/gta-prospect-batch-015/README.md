# GTA prospect batch 015 — held queue and new discovery

## Purpose

This is a bounded, review-only cohort. It retains Batch 014's four unresolved candidates and documents three additional GTA firms with current, public first-party roster evidence. It is not an import, CRM, contact, form, or outreach action.

## Method and limits

- **Sources:** current public, first-party firm pages only.
- **Roster gate:** count only people the firm identifies as lawyers, partners, or associate lawyers; exclude staff and students.
- **Identity gate:** the authenticated unified-list search on 2026-09-13 was a read-only signal only. It is not an identity bridge, and a protected identity snapshot is still required before an import is even considered.
- **Contact boundary:** names and public email addresses are cited evidence, not permission to contact anyone.

## Outcome

| Outcome | Records | Meaning |
| --- | ---: | --- |
| New discovery, pending identity review | 3 | Current first-party GTA roster, office, and leadership evidence are clear; neither a static reconciliation nor the protected preflight has been completed. |
| Continued hold | 4 | Batch 014's unresolved identity, roster, or geographic-scope issue remains unresolved. |

## New discovery

- **Sun & Kang Law Group** — Markham office; three currently labelled lawyers: Xin Sun, Jian Kang, and Ziyi Tang. Xin Sun and Jian Kang are founding partners.
- **Workly Law Professional Corporation** — Toronto office; five lawyers: Sunira Chaudhri plus four associate lawyers. Sunira Chaudhri is the founding partner and the firm publishes `info@worklylaw.com`.
- **Michael Coristine Law Professional Corporation** — North York office; three lawyers: Michael Coristine plus two associate lawyers. Michael Coristine is the founding partner and the firm publishes his direct email plus a firm inbox.

## Continued holds

- **Bogoroch & Associates LLP:** nine-lawyer current roster, but a related legacy signal still has no source-supported identity bridge.
- **Goldmans LLP:** the accessible landing page still does not prove a complete active-lawyer roster.
- **Walker Law Professional Corporation:** seven-lawyer Toronto roster, but a similarly named legacy row remains an identity-review issue.
- **Aitken Robertson Criminal & DUI Defence:** firm-wide eleven-versus-thirteen roster conflict and no established GTA-only roster.

## Next gate

Run the static identity reconciliation and protected server-side snapshot for the three new records. Any collision, ambiguity, or changed roster keeps that record on hold. A separate explicit authorization would still be required for any production import.
