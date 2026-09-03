# Provider account evidence, 2026-09-02

**Status:** Partial evidence only. No provider deletion, restore, upload, support request, or account-setting change was performed. This record does not clear the provider-evidence gate or authorize Meta submission.

## Production request in scope

- Deletion-request UUID: `a932fae3-479d-400c-a94a-ca510c281879`
- Reason: `legacy_anonymization_backfill`
- Current request status: `pending`
- Sole retained provider selector: `L-2026-05-14-5EQ`
- Provider requiring a disposition: GHL
- Meta sender ID, email selector, phone selector, and Storage object path: none retained for this request

These values came from the read-only production audit recorded for the privacy remediation. The request must remain pending until the GHL recovery surface is checked and the resulting disposition is recorded through the controlled workflow.

## Authenticated GHL evidence

The read-only HighLevel connector was authenticated to this account:

| Field | Observed value |
|---|---|
| Location name | DRG Law Professional Corporation |
| Location ID | `KwpSaMUehIN25dMG4WZB` |
| Company ID | `MfAMsSxFSKuPlSvURjk6` |
| Contact reference field | `Lead Id` |
| Contact field key | `contact.lead_id` |
| Contact field ID | `1PKrygPJduo7Jlb7WZDl` |

Read-only searches completed on 2026-09-02:

| Check | Result |
|---|---|
| Exact contact query for `L-2026-05-14-5EQ` | HTTP 200, zero contacts, total zero |
| Unfiltered current-contact enumeration | 11 contacts returned; exact selector absent from the complete returned payload |
| Conversation query for the selector, status `all` | HTTP 200, zero conversations |
| Opportunity query for the selector, status `all` | HTTP 200, zero opportunities |

The enumeration included each current contact's returned custom fields, so it covered the dedicated `contact.lead_id` value as well as the standard returned contact fields. No names, email addresses, phone numbers, or other contact payload values were copied into this evidence record.

### What this proves

The selector is not present in the current contacts returned by the authenticated DRG location, and it does not resolve through the authenticated conversation or opportunity search endpoints.

### What this does not prove

The contact APIs used above do not expose the Contacts > Restore list. The authenticated HighLevel page did not produce a usable DOM for the Restore screen, and the Windows-control fallback stopped before input because it could not establish the current browser URL safely. The recycle-bin check therefore remains open.

HighLevel's public [Restore Deleted Contacts](https://help.gohighlevel.com/support/solutions/articles/48001211386-restore-deleted-contacts-or-undo-bulk-deletes) guidance states that eligible deleted contacts appear on the Contacts > Restore page for up to 60 days. That public statement is not account-specific proof that this selector is absent, was deleted, or has expired. The inquiry date is not evidence of a deletion date.

## Other provider evidence status

| Provider | Account-specific evidence captured | Current conclusion |
|---|---|---|
| Meta | An authenticated App Review tab was observed for App ID `1007304805285554` under Business ID `2191422434947205`; retention/deletion settings were not captured | Open. App-review access does not establish request-specific deletion or retention behavior |
| Resend | None | Open. Public policy statements in `docs/app-review/deletion-flow-verification.md` are not account-specific evidence |
| Supabase | Account verification identifies the production organization as Free. The project backup API/CLI returned `walg_enabled: true`, `pitr_enabled: false`, `backups: []`, and `physical_backup_data: {}` | Open. There is no account-visible restore point or expiry schedule. PR #203 proves manual replay from an external request, not automatic replay or an external durable registry |
| GHL | Current-record API evidence above | Open until Contacts > Restore is checked and documented |

`provider_managed` is a location/disposition marker. It is not deletion evidence, an account-specific retention schedule, or proof that a deletion request was applied by a provider.

## Required follow-up

1. In the authenticated DRG location, open Contacts > Restore and search the exact selector `L-2026-05-14-5EQ`.
2. Capture a timestamped screenshot showing the account identity, the exact query, and either the matching recoverable record or a no-result state. Do not expose unrelated contacts.
3. If a recoverable record is found, record its HighLevel contact ID and stop before deletion. Obtain Adriano's action-time confirmation naming that exact cloud record before deleting it.
4. If no recoverable record is found, preserve the screenshot and record a narrowly worded not-found disposition. Do not characterize the result as provider-confirmed permanent deletion.
5. Capture the production account's applicable retention settings for Resend, Meta, and GHL where their authenticated dashboards expose them. Supabase account state is now recorded, but the external durable deletion registry and restore-blocking replay procedure proven necessary by PR #203 remain open.
6. Keep deletion request `a932fae3-479d-400c-a94a-ca510c281879` pending until the controlled workflow accepts the supported disposition with durable evidence.

## Evidence boundary

This document is an operator audit note, not a privacy-counsel opinion and not provider certification. It records only successful read-only checks and their limitations.
