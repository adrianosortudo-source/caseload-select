# GTA prospect validation reports

This directory contains independent, read-only validation reports for staged GTA prospect research artifacts. These reviews are staging-only: they are not outreach lists, CRM-import approval, contact authorization, send authorization, deployment, or publication approval.

Each JSON report preserves the source batch record IDs and records public-evidence checks such as first-party roster access, firm identity, source/domain/city consistency, lawyer-count qualification, fixture and legacy comparisons, and explicit unresolved items. The reports do not alter their source research rows.

Current reports include:

- `gta-prospect-batch-001-validation.json`: batch 001 review. Future promotion requires a fresh review of the live roster, firm identity, office scope, lawyer-only count, and legacy crosswalk.
- `gta-prospect-batch-002-validation.json`: batch 002 review of commit `79baba8c67e3c1f99a6a51cad447583691f915ca`, observed 2026-09-07. It records the B002-08 Jordan Honickman duplicate correction, 9 same-domain legacy firms / 11 legacy rows, plus roster-count, city, URL, and other evidence-specific findings.

No LSO page, form, chat, scheduling control, contact-data workflow, import, automation, CRM activity, contact, outreach, or send is authorized by these artifacts.
