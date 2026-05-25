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
