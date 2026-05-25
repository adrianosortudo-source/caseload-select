# Business verification — exact requirements (Meta error today)

The Verification step on the App Review submission (id `1016624077686960`) is the only remaining blocker before Submit for review. The Business Portfolio "CaseLoad Select" status shows **Needs more information** because a prior verification attempt failed.

## The exact error Meta returned

> **The document submitted to verify the business phone number `+16475492106` isn't an accepted type.**

So the previous attempt uploaded a document, but the document did not satisfy Meta's two requirements simultaneously:

1. **The business' legal name** (the entity "CaseLoad Select" or whatever name is on the Business Portfolio)
2. **The phone number `+16475492106`** (this is the phone number Adriano registered against the Business Portfolio)

## To correct

Per Meta's own instructions in the rejection dialog:

> 1. Choose an accepted type of document that proves the business and phone number are associated. Any of the following documents is acceptable:
>    - Certificates / articles of incorporation
>    - Business licences / permits
>    - Bank statements
>    - Bank summaries
>    - Bank letters
>    - Utility bills: water, gas, electric, **phone bill**
>
>    Make sure that the document shows both the business' legal name AND the phone number `+16475492106`.
>
> 2. Return to business verification and enter the information exactly as it appears on the document.
>
> 3. Upload the new supporting document.

## What we have on hand (2026-05-24)

Four documents reviewed against Meta's two requirements (legal name AND phone `+16475492106` on the same doc):

| Document | CASELOAD SELECT | Phone +16475492106 | Notes |
|---|---|---|---|
| Ontario MBL Certificate (`Certificate_of_Business_Name_for_a_Sole_Proprietorship_Registration.pdf`) | ✓ | ✗ | Business licence, accepted type |
| Ontario MBL Registration Info (`Registration_Information_of_a_Sole_Proprietorship_EN.pdf`) | ✓ | ✗ | Companion to the certificate, has address |
| CRA HST profile (`HST Address Phone.pdf`) | ✗ (shows "Adriano Domingues") | ✓ | CRA My Business Account export; profile page says "There are no operating names on file for this business" — that's what to fix |
| Sole Proprietor DRAFT (`SoleProprietor.pdf`) | ✓ | ✗ | Pre-filing review draft; not an official document for submission |

**Critical observation:** the CRA HST profile shows "There are no operating names on file for this business" under business number 760575068. That's why the document shows "ADRIANO DOMINGUES" alone instead of "ADRIANO DOMINGUES o/a CASELOAD SELECT". Linking the operating name to the CRA business number fixes that — the next pull of the profile PDF will show both the operating name AND the phone on a single document.

## Chosen path (2026-05-24): add operating name in CRA, re-pull profile

1. Log into [CRA My Business Account](https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/business-account.html) as Adriano (business number 760575068).
2. From the profile page, click **Manage operating names**.
3. Add operating name: **CASELOAD SELECT** (uppercase exactly as it appears on the Ontario MBL).
4. Save. CRA usually applies operating-name changes immediately.
5. Return to the profile page (refresh). Verify it now shows:
   - Profile for ADRIANO DOMINGUES
   - Operating names: **CASELOAD SELECT** (effective today)
   - Phone numbers: ADRIANO DOMINGUES — **647-549-2106**
   - Address: 110 - 50 STEPHANIE ST, TORONTO ON M5T1B3
6. Print the profile to PDF (browser print → save as PDF). Save as `CRA_BusinessProfile_with_OperatingName.pdf`.
7. Open the Meta Business Portfolio settings → Security Centre → Business verification.
8. The verification form will ask for the business' legal name. Enter exactly as it appears on the CRA PDF: `ADRIANO DA SILVA DOMINGUES` (the registrant name; the operating name "CASELOAD SELECT" gets entered in a separate "DBA" or "operating name" field if Meta surfaces one).
9. Enter phone `+1 647 549 2106`.
10. Upload the CRA profile PDF.
11. Submit. Meta typically responds within 1-3 business days.

If Meta rejects with the same "isn't an accepted type" error, fall back to the phone-bill approach: download a recent Rogers/Bell/Telus invoice for `+16475492106`, which is explicitly on Meta's accepted list, and re-upload that instead.

## Path for CaseLoad Select (sole proprietorship)

Adriano operates CaseLoad Select as a sole proprietorship (no incorporation, no separate legal entity). The cleanest documents that satisfy "business legal name AND `+16475492106`":

### Option A — Ontario Master Business Licence (recommended)

Register the business name "CaseLoad Select" in Ontario via [ServiceOntario](https://www.appmybizaccount.gov.on.ca/) for ~CAD 60. The resulting Master Business Licence shows:
- Legal owner: Adriano Domingues
- Business name: CaseLoad Select
- Operating address (which Adriano can verify)

Then on the Meta Business Portfolio settings, ensure the Business Portfolio legal name reads exactly "Adriano Domingues operating as CaseLoad Select" OR "CaseLoad Select" matching the MBL document. The phone field needs to carry `+16475492106`.

Upload the MBL PDF to the verification flow. Confirm the legal-name and phone fields in the form match the document character-for-character.

This is the fastest path: ServiceOntario typically issues the licence within minutes electronically.

### Option B — Phone bill in Adriano's name + business name added to Business Portfolio

Find a recent phone bill for `+16475492106` (the same number registered against the Business Portfolio) that shows "Adriano Domingues" as the account holder. Then change the Business Portfolio legal name to "Adriano Domingues" so the document matches the field exactly.

This works but tells Meta the entity is "Adriano Domingues" personally rather than "CaseLoad Select". Acceptable for a sole proprietor but loses the brand-name signal.

### Option C — Bank statement for a business bank account

If Adriano has a business bank account in the name of "CaseLoad Select" or "Adriano Domingues" with `+16475492106` listed as the contact phone on the statement, that document satisfies both requirements.

## Where to upload (when ready)

1. Open Meta Business Suite → Settings → Security Centre → Business verification.
2. Section "Verification for CaseLoad Select" → click "Learn more" → click "Continue" on the next-steps dialog.
3. The verification wizard will ask for the business' legal name (must match the document), phone (`+16475492106`), and to upload the document.
4. After Meta processes (usually 1-3 business days), the App Review submission's Verification section will turn green and the Submit for review button becomes active.

## Tab where the verification flow opens

`https://business.facebook.com/latest/settings/security_center/?business_id=2191422434947205`

Same Business Portfolio (id `2191422434947205`) that hosts the Meta App (id `1007304805285554`).

## After verification clears

Return to:
`https://developers.facebook.com/apps/1007304805285554/app-review/submissions/?submission_id=1016624077686960`

Verification will show green; all 5 sections green; Submit for review button becomes blue and live.

Note: Allowed usage shows the descriptions + compliance as the green qualifier. Per the Meta dashboard's behaviour observed today, the screencast uploads inside Allowed usage are tracked as "Required Items" under each permission's detail panel but DO NOT block the top-level Allowed usage from turning green when descriptions + compliance + API test calls are satisfied. The Meta reviewer will still expect screencasts at review time, however, so recording the 4 clips per `screencasts/README.md` and uploading them before clicking Submit remains the right move.
