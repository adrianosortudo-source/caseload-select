# GTA batch 010 — central reconciliation

Date: 2026-09-07  
Scope: 100 public, first-party research records; staging review only

## Decision log

| Record(s) | Decision | Reason |
| --- | --- | --- |
| `B010-WN-14`, `B010-EAST-20` | Retain `B010-WN-14`; exclude `B010-EAST-20` from staging | Same firm and `separation.ca` canonical domain. The retained record has a direct firm roster plus a Vaughan office source. |
| `B010-WN-15`, `B010-EAST-09` | Retain `B010-WN-15`; keep `B010-EAST-09` held | Same firm and `jamalfamilylaw.com` canonical domain. The west/north independent review records the current six-lawyer roster and a usable access review. |
| `B010-C-29` | Use `whittenlublin.com` as the canonical domain; retain `toronto-employmentlawyer.com` as an alias | The original source URL redirects to the firm's canonical site. The independent review observed 19 lawyer roles there. |
| `B010-C-20`, `B010-WN-H16` | Both remain non-staging | Oatley Vigmond is duplicated across source-held records; neither has an accepted QA disposition. |
| `B010-C-33`, `B010-EAST-33` | Both remain non-staging | Gelman & Associates is duplicated across source-held records; neither has an accepted QA disposition. |

## Result

The independent reviews initially produced 31 `accepted_for_staging`
dispositions. After collapsing the accepted Feldstein duplicate, the central
staging pool contains **30 unique firms**. The Jamal resolution changes no
staging count because only the retained record was independently accepted.

This reconciliation is a research-data decision log. It does not approve a
database import, contact, outreach, advertising, GBP collection, or any use of
contact information.
