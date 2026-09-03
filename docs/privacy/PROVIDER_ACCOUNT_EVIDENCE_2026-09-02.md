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

The authenticated Contacts > Bulk Actions page was also inspected read-only:

| Delete job | Observed state | Available controls | Identity evidence |
|---|---|---|---|
| 2026-08-20 | Completed | `View details`, `Restore` | `View details` showed the action ID, action type, and label only; it did not expose the deleted-contact identities |
| 2026-08-10 | Completed | `View details`, `Restore` | Not opened because the visible row already did not identify a contact and no restore action was authorized |

No Restore control was invoked.

### What this proves

The selector is not present in the current contacts returned by the authenticated DRG location, and it does not resolve through the authenticated conversation or opportunity search endpoints. The account also contains two completed bulk Delete jobs with a Restore option.

### What this does not prove

Neither the current-record APIs nor the visible Bulk Actions rows connect `L-2026-05-14-5EQ` to either completed Delete job. The Aug 20 View details surface did not expose row-level contact identities. Exact identity therefore remains unproven without invoking Restore or obtaining equivalent provider evidence.

Restore would change cloud state and was not authorized. It must not be invoked without Adriano's action-time confirmation naming the exact HighLevel job or record and the intended recovery scope.

HighLevel's public [Restore Deleted Contacts](https://help.gohighlevel.com/support/solutions/articles/48001211386-restore-deleted-contacts-or-undo-bulk-deletes) guidance states that eligible deleted contacts appear on the Contacts > Restore page for up to 60 days. That public statement is not account-specific proof that this selector is absent, was deleted, or has expired. The inquiry date is not evidence of a deletion date.

## Other provider evidence status

### Authenticated Meta configuration

Read-only inspection of App Settings > Basic for App ID `1007304805285554` under Business ID `2191422434947205` showed these configured public endpoints:

- Privacy policy URL: `https://app.caseloadselect.ca/privacy`
- Terms of service URL: `https://app.caseloadselect.ca/terms`
- Data deletion instructions URL: `https://app.caseloadselect.ca/data-deletion`

This proves that the three public endpoints are configured on the identified app. It does not prove that Meta applied a request-specific deletion, establish a Meta retention schedule, or clear the provider-evidence gate.

| Provider | Account-specific evidence captured | Current conclusion |
|---|---|---|
| Meta | Authenticated App Settings > Basic confirms the privacy, terms, and data-deletion URLs listed above | Open. Configured endpoints do not establish request-specific deletion or retention behavior |
| Resend | None | Open. Public policy statements in `docs/app-review/deletion-flow-verification.md` are not account-specific evidence |
| Supabase | Account verification identifies the production organization as Free. The project backup API/CLI returned `walg_enabled: true`, `pitr_enabled: false`, `backups: []`, and `physical_backup_data: {}` | Open. There is no account-visible restore point or expiry schedule. PR #203 proves manual replay from an external request, not automatic replay or an external durable registry |
| GHL | Current-record API evidence plus two completed Bulk Actions Delete jobs dated 2026-08-20 and 2026-08-10 | Open. View details did not expose deleted-contact identities, and Restore was not authorized |

`provider_managed` is a location/disposition marker. It is not deletion evidence, an account-specific retention schedule, or proof that a deletion request was applied by a provider.

## Required follow-up

1. Preserve a timestamped screenshot of the two Bulk Actions Delete jobs and the Aug 20 View details limitation without exposing unrelated contacts.
2. Do not invoke either Restore control unless Adriano gives action-time confirmation naming the exact HighLevel job and intended recovery scope.
3. If an authorized restore later identifies a matching contact, record its HighLevel contact ID and stop before any subsequent deletion. Obtain separate action-time confirmation naming that exact cloud record before deleting it again.
4. If equivalent provider evidence establishes that neither job contains the selector, preserve that evidence and record a narrowly worded not-found disposition. Do not characterize the result as provider-confirmed permanent deletion.
5. Capture the production account's applicable retention settings for Resend, Meta, and GHL where their authenticated dashboards expose them. Supabase account state is now recorded, but the external durable deletion registry and restore-blocking replay procedure proven necessary by PR #203 remain open.
6. Keep deletion request `a932fae3-479d-400c-a94a-ca510c281879` pending until the controlled workflow accepts the supported disposition with durable evidence.
7. If provider support is needed, use the exact drafts in `PROVIDER_SUPPORT_REQUEST_DRAFTS.md` only after Adriano approves the named provider, destination, and final text at action time.

## Evidence boundary

This document is an operator audit note, not a privacy-counsel opinion and not provider certification. It records only successful read-only checks and their limitations.
