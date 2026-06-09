# Meta Business Verification — resubmit card

Single-page execution card for the chosen path: CRA profile PDF with operating name added. Use this once the CRA PDF (`CRA_BusinessProfile_with_OperatingName.pdf`) is saved to disk.

For the why and the rejected-document analysis, see `Business_Verification_Requirements.md`. This card is for the click-by-click resubmit.

---

## Part 1 — CRA (operator only, ~3 min)

Operator runs this. Cannot be agent-assisted (CRA 2FA + SIN).

**State as of 2026-06-03:** operating name `CaseLoad Select` is already on the CRA profile. Only the PDF print is needed.

1. Open `https://www.canada.ca/en/revenue-agency/services/e-services/cra-login-services.html` → click **Sign in to a CRA account** → choose **My Business Account** → authenticate (CRA user ID + 2FA, or bank Sign-in Partner).
2. From Overview, go to the **Profile for ADRIANO DOMINGUES** page (BN `760575068`).
3. Confirm the page shows all four anchors:
   - Header: `Profile for ADRIANO DOMINGUES`
   - Operating names: `CaseLoad Select`
   - Phone numbers: `647-549-2106`
   - Address: `1512 - 50 STEPHANIE ST, TORONTO ON M5T1B3`
4. Click **Print/Save** (top-right of the page).
5. Print dialog → Destination: **Save as PDF** → Pages: **Custom** → `1,3` → Save. Name the file **`CRA_BusinessProfile_with_OperatingName.pdf`**.

**Why pages 1 and 3 only:** Page 1 carries the four Meta-required anchors (legal name + operating name + phone + address). Page 3 carries the Business Number `760575068`, which Meta's verification form asks for as a separate typed field — the reviewer cross-checks the typed value against the uploaded document. Pages 2 (direct deposit / RBC account number) and 4 (security settings) are unnecessary exposure and add nothing to the verification.

**Stop and verify before Part 2:** open the saved PDF. Confirm:
- Page 1 shows legal name `ADRIANO DOMINGUES`, operating name `CaseLoad Select`, phone `647-549-2106`, and address `1512 - 50 STEPHANIE ST` together.
- Page 3 shows Business numbers `760575068`.
- The bank account section is NOT in the PDF.

If anchors split across pages on page 1, re-print with browser zoom at 90% or in landscape so they fit.

**If the operating name is missing from the CRA profile** (regression / different account state): Profile page → Operating names panel → **Manage operating names** link → **Add operating name** → `CaseLoad Select` → Save → refresh → re-print.

---

## Part 2 — Meta Business verification resubmit (operator clicks, agent can prep field values)

### Open the verification form

```
https://business.facebook.com/latest/settings/security_center/?business_id=2191422434947205
```

Section "Verification for CaseLoad Select" → **Learn more** → **Continue**.

### Field values to enter

Paste these exactly. Character-for-character match to the CRA PDF is what got the last attempt rejected.

| Meta field label | Value to enter |
|---|---|
| Business legal name | `ADRIANO DOMINGUES` (match the CRA PDF exactly — CRA stores the short form, not the full registrant name `ADRIANO DA SILVA DOMINGUES`; Meta's reviewer compares form field to document literally) |
| DBA / operating name (if surfaced as a separate field) | `CaseLoad Select` (match the case on the CRA PDF) |
| Business phone | `+1 647 549 2106` |
| Business address | `1512 - 50 Stephanie St, Toronto, ON M5T 1B3, Canada` |
| Country | `Canada` |
| Business type | `Sole proprietorship` |
| Website | `https://app.caseloadselect.ca` |
| Business email | `adriano@caseloadselect.ca` |

If Meta does NOT surface a separate DBA / operating name field, enter the legal name field as `ADRIANO DA SILVA DOMINGUES` only — do NOT combine into "Adriano Domingues operating as CaseLoad Select" in one field. Meta's string-match is literal and the CRA PDF carries the registrant name as the primary string.

### Upload

Upload slot → select `CRA_BusinessProfile_with_OperatingName.pdf` from disk.

### Submit

Click **Submit**. Status flips to "In review". Meta typically responds in 1-3 business days.

---

## Part 3 — Post-submit (operator monitors, agent can verify when status flips)

**Submitted: 2026-06-03**. Meta says ~2 working days; expected verdict by Friday 2026-06-05 or Monday 2026-06-08.

### What to do while Meta reviews

- ✓ **DONE 2026-06-03:** Mint permanent WhatsApp System User access token (Task #89). System User `CaseLoad Select API` (ID `61590400959519`) with three scopes (`whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`), Never expiry. Token stored in `intake_firms.whatsapp_cloud_api_access_token` for DRG; `whatsapp_cloud_token_expires_at = NULL`. Smoke test against WABA `1346285637647296` returned 200 with `message_template_namespace` set.
- **PENDING:** Record the 4 screencasts (`screencasts/README.md` shot list). Test message is already locked to wrongful_dismissal. All three channel tokens are live (FB Page permanent, IG inherited from FB Page, WhatsApp System User just minted).
- **PENDING:** Upload the 4 MP4s into the matching App Review permission slots on submission `1016624077686960`.
- **PENDING:** Purge the Sarah Patel test leads from `screened_leads` after recording is done. Can be agent-assisted via supabase MCP.
- Do NOT click **Submit for review** on the App Review submission page; the verification gate handles activation. Wait until the Verification section turns green.

### Watch for the verification status

```
https://business.facebook.com/latest/settings/security_center/?business_id=2191422434947205
```

When status flips to **Verified**, return to:

```
https://developers.facebook.com/apps/1007304805285554/app-review/submissions/?submission_id=1016624077686960
```

All 5 sections should show green. The **Submit for review** button activates.

### If Meta rejects again

Fallback: phone bill in Adriano's name for `+16475492106` is an explicitly-listed accepted document type. Pull a recent Rogers / Bell / Telus / Fido / Koodo invoice that shows both the account-holder name and the phone number, upload that instead. The same Part 2 field values apply.

---

## Reference: where the IDs and account hooks live

| Thing | Value |
|---|---|
| CRA Business Number | `760575068` |
| Ontario MBL business name | `CaseLoad Select` |
| Phone (Meta business + CRA) | `+1 647 549 2106` |
| Address | `110 - 50 Stephanie St, Toronto, ON M5T 1B3` |
| Meta Business Portfolio ID | `2191422434947205` |
| Meta App ID | `1007304805285554` |
| Meta App Review submission ID | `1016624077686960` |
| Operator email | `adriano@caseloadselect.ca` |
