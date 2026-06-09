# Session wrap — 2026-06-03 (Meta App Review verification + WhatsApp token)

Operator: Adriano. Goal: unblock the Meta App Review submission by resubmitting Business Verification with a clean document and minting the permanent WhatsApp System User Access Token.

## Net change

| Item | Before | After |
|---|---|---|
| Meta Business Verification status | Rejected ("isn't an accepted type" on phone `+16475492106`) | **In review** since 2026-06-03 (second submit, ~3pm ET) — verdict expected by 2026-06-05 to 2026-06-08 |
| WhatsApp Cloud API token | 24h dev token | **Permanent System User token, Never expiry** — stored in DRG `intake_firms.whatsapp_cloud_api_access_token` |
| CRA Business profile | Operating name missing | `CaseLoad Select` listed (operator added between 2026-05-24 and 2026-06-03) |
| `intake_firms.whatsapp_cloud_token_expires_at` for DRG | (untracked) | `NULL` — matches "Never" expiry, no false alerts from `lib/token-expiry.ts` cron |

## What was submitted to Meta for verification

CRA Business Profile PDF, 2 pages (banking info on page 2 of the 4-page raw export was stripped before upload; final upload was pages 1 + 3 only):

- **Page 1:** Profile header `ADRIANO DOMINGUES`, Operating names `CaseLoad Select`, Phone `647-549-2106`, Address `1512 - 50 STEPHANIE ST, TORONTO ON M5T1B3` — all four required anchors on one page
- **Page 3:** Business Number `760575068` (covers Meta's typed-field cross-check on tax/registration ID)

### First submission (rejected same-day, ~2:47am email)

Form field values typed on Meta (first attempt):
- Business name (legal): `CaseLoad Select`
- Alternative business name (DBA): `Adriano Domingues`
- Street address: `50 Stephanie Street`
- Street address 2: `Apartment 1512`
- Town/City: `Toronto` · County/Region: `Ontario` · ZIP: `M5T 1B3`
- Phone: CA +1 `6475492106` · Website: `https://caseloadselect.ca/`
- Public-records match: "My business isn't listed"
- Document type: Business registration or licence document · Phone on document: Yes

**Why it failed:** form fields were inverted. Operator had typed `CaseLoad Select` as legal name, but the CRA Profile shows ADRIANO DOMINGUES as the legal entity with CaseLoad Select as an operating name. Meta does literal text-match on the legal-name field and saw mismatch on all three checks (name, address-associated-with-name, phone-associated-with-name).

Meta's rejection email at 2:47am listed three flags, all the same root cause: "document doesn't prove legal business name CaseLoad Select", "document doesn't prove address is associated with CaseLoad Select", "document doesn't prove phone is associated with CaseLoad Select."

### Second submission (resubmitted ~3pm ET, in review)

Form field values typed on Meta (corrected):
- Business name (legal): `Adriano Domingues` ← flipped
- Alternative business name (DBA): `CaseLoad Select` ← flipped
- Street address: `1512-50 Stephanie Street` ← collapsed to compact form (CRA prints with spaces around dash; operator used no spaces — Meta likely normalizes whitespace)
- Street address 2: (blank) ← apartment number is in line 1
- Everything else unchanged
- **Same `CRA_BusinessProfile_with_OperatingName.pdf` reused** — no new document needed; the CRA Profile validates cleanly once the form fields match what the document literally prints.

**If this also rejects:** fallback is Ontario Master Business Licence from ServiceOntario (~$60, issued in minutes). The MBL prints "CaseLoad Select" as the registered business name with Adriano as the owner — the only document type that genuinely positions CaseLoad Select as the legal entity. Combine with a phone bill for `+16475492106` in Adriano's name if separate phone proof is required.

## WhatsApp System User token mint

- System User: `CaseLoad Select API` (ID `61590400959519`), Admin access
- Assigned assets (Full control): App `CaseLoad Select` (ID `1007304805285554`) + WhatsApp account `Test WhatsApp Business Account` (WABA ID `1346285637647296`)
- Token scopes selected: `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`
- Expiration: **Never**
- Length: 204 chars
- Smoke test (read-only GET against the WABA endpoint): `HTTP 200`, returned `id`, `name`, `timezone_id`, `message_template_namespace` — proves both whatsapp_business_management + business_management scopes are attached

Token applied to DRG production row via supabase MCP:

```sql
UPDATE intake_firms
SET whatsapp_cloud_api_access_token = '<system user token>',
    whatsapp_cloud_token_expires_at = NULL
WHERE id = 'eec1d25e-a047-4827-8e4a-6eb96becca2b';
```

## Remaining for next session

Once Meta verification flips green (1-3 business days):

1. Record 4 screencast MP4s per [screencasts/README.md](screencasts/README.md) — test message locked to wrongful_dismissal
2. Upload MP4s into matching permission slots on App Review submission `1016624077686960`
3. Purge Sarah Patel test leads from `screened_leads` (agent-assistable via supabase MCP)
4. Click **Submit for review** on submission `1016624077686960`

All three channel tokens are live as of this session:
- Messenger / Instagram (FB Page token, permanent, no expiry — minted 2026-05-24)
- WhatsApp (System User token, permanent, no expiry — minted today 2026-06-03)

## Token security note

The System User token was pasted into the chat transcript during the smoke test. Adriano elected to keep using it rather than rotate. Single-operator-on-own-machine exposure is bounded. Rotation is a hygiene task that can be done post-launch if desired: System Users panel → Revoke tokens → Generate new token with the same scopes / Never expiry → repeat the Supabase UPDATE.
