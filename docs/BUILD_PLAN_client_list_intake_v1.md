# Build Plan: Client List Intake, Two-Path Model (Firm Profile Section B) v1

**Status:** Ready for implementation. Approved model, verified current state, exact instructions.
**Executor:** Claude Sonnet, working in this repo (`05_Product/caseload-select-app`).
**Authority:** Operating model decided by Adriano 2026-07-21. Spec: `D:\00_Work\01_CaseLoad_Select\04_Playbooks\05_Operations\ACTS_Day1_ClientListIntake_v1.md`. This plan supersedes that spec's "new Section 12 in the registration form" placement; see Section 0.
**Date:** 2026-07-22.

---

## 0. Context and the placement decision

Every new firm's past-client contact list must be captured as a standard onboarding step. Two paths:

- **Default (share_with_us), recommended:** the firm uploads whatever raw files it has. The operator cleans them, builds the import sheet, loads it into the firm's GHL location, verifies the import, then deletes the working copy. The deletion is logged so the PIPEDA commitment is auditable.
- **Exception (self_upload):** only when a firm expressly declines to share. The firm downloads a template, fills it, and uploads to the CRM itself with access the operator sends. The firm confirms this choice and still attests to the CASL consent basis.

**Placement:** the earlier spec proposed a new Section 12 in the registration form (`FirmOnboardingForm.tsx`). Codebase inventory found the feature 70 percent built in the OTHER onboarding form: the Firm Profile form (Form 2), Section B "Existing client base", which already has a single-file client-list upload wired end to end (`customer_base_*` columns, upload route, admin download). The build therefore extends Form 2 Section B and leaves the registration form untouched. Production liveness check (2026-07-22): `firm_onboarding_intake` has exactly 1 row ever (form_type `registration`, 2026-05-15) and zero profile submissions, so Form 2 can change freely with no data-compat concern.

## 1. Scope

In scope:

1. Migration adding the two-path columns to `firm_onboarding_intake`.
2. New pure lib `src/lib/firm-onboarding-client-list.ts` (validation + display helpers).
3. Widen `POST /api/firm-profile/[token]/upload` (types, size, new rate-limit bucket).
4. Extend `POST /api/firm-profile/[token]/submit` (validate + persist the new fields).
5. Rework `FirmProfileForm.tsx` Section B (path selector, multi-file upload, attestation, self-upload branch). Exact copy provided below; do not rewrite it.
6. Admin: client-list panel on `/admin/onboarding-submissions/[id]` with two operator actions (mark import verified, delete working copy), plus a status badge on the list page.
7. Two new operator-gated API routes for those actions.
8. New public guide `public/firm-onboarding-guides/client-list.html`. The template asset `public/firm-onboarding-guides/client-list-template.xlsx` already exists in the tree; do not regenerate it.
9. Extend the operator notification email with the client-list facts.
10. Operator launch validator at `/onboarding`: fix its broken column select and add a required `Client list` check (Section 8.4).
11. Tests for items 2, 3, 4, 7, 10.

Out of scope, do not touch:

- `FirmOnboardingForm.tsx` (the registration form) and its routes.
- `src/lib/screen-engine/`, `src/app/(marketing)/`, `.claude/worktrees/`.
- The legacy `customer_base_*` columns (leave them; the new UI stops writing them, the admin page keeps rendering them when present).
- `/admin/firms/[firmId]/onboarding` (per-firm view stays as is in v1).
- Applying any migration to production (operator step, Section 13).
- Any GHL-side automation. The operator does the import by hand in v1.

## 2. Verified current state (do not re-derive)

| Fact | Value |
|---|---|
| Form 2 page | `src/app/firm-profile/[token]/page.tsx`, token becomes the firm label via `humaniseToken` |
| Form 2 component | `src/components/firm-onboarding/FirmProfileForm.tsx` (543 lines), local `Section`/`Field`/`SubInput`/`FileUploadBlock` helpers, inline styles, `inputStyle`/`areaStyle` consts |
| Existing upload | Single file, posts `FormData{file}` to `/api/firm-profile/[token]/upload`, writes `customer_base_*` into form state |
| Upload route | `src/app/api/firm-profile/[token]/upload/route.ts`: bucket `firm-onboarding-docs`, path `{encodeURIComponent(token)}/profile/{Date.now()}-{sanitized}`, 10 MB cap, CSV/Excel/PDF via MIME set + extension fallback, rate-limit bucket `firmOnboarding` (10/hour) |
| Submit route | `src/app/api/firm-profile/[token]/submit/route.ts`: inserts one `firm_onboarding_intake` row with `form_type: 'profile'`, requires `legal_name` + `signed_name`, then `sendOperatorNotification(inserted.id)` |
| Table | `firm_onboarding_intake` (migrations `20260513_firm_onboarding_intake.sql` + v2 additions). `customer_base_storage_path/original_name/size_bytes/mime_type` added by `20260617_firm_onboarding_customer_base.sql` |
| Bucket, live | `storage.buckets` row `firm-onboarding-docs`: `file_size_limit` null, `allowed_mime_types` null (verified against prod 2026-07-22). Route-level validation is the only gate. Do not add bucket-level limits |
| Admin detail | `src/app/admin/onboarding-submissions/[id]/page.tsx` (996 lines, server component) already signs a download URL for `customer_base_storage_path` |
| Admin action pattern | `OnboardingNotificationPanel.tsx` (client component with a POST button) + `src/app/api/admin/onboarding-submissions/[id]/retry-notification/route.ts`. Copy the auth pattern of that route exactly for the two new routes |
| Notification | `src/lib/firm-onboarding-notification.ts` (471 lines), `sendOperatorNotification(rowId)`, does not branch on `form_type` |
| Rate limits | `src/lib/rate-limit.ts`, bucket union + config map, `firmOnboarding: { limit: 10, windowSeconds: 3600 }` |
| Tests | Lib tests in `src/lib/__tests__/*.test.ts`; route tests in `src/app/api/.../__tests__/route.test.ts` |

## 3. Migration

Create `supabase/migrations/20260722000000_firm_onboarding_client_list.sql` with exactly:

```sql
-- firm_onboarding_intake: client-list intake, two-path model (Firm Profile, Form 2, Section B).
-- Default path (share_with_us): the firm shares raw files; the operator cleans, imports to GHL,
-- verifies the import, then deletes the working copy and logs the deletion.
-- Exception path (self_upload): the firm declines to share and uploads to the CRM itself.
-- The legacy single-file customer_base_* columns stay for old rows; new submissions use these.

alter table public.firm_onboarding_intake
  add column if not exists client_list_path text
    check (client_list_path in ('share_with_us', 'self_upload')),
  add column if not exists client_list_files jsonb not null default '[]'::jsonb,
  add column if not exists client_list_attested_at timestamptz,
  add column if not exists client_list_self_upload_confirmed boolean not null default false,
  add column if not exists client_list_import_verified_at timestamptz,
  add column if not exists client_list_import_verified_note text,
  add column if not exists client_list_working_copy_deleted_at timestamptz;

comment on column public.firm_onboarding_intake.client_list_files is
  'Array of {storage_path, original_name, size_bytes, mime_type} in the firm-onboarding-docs bucket. Metadata survives working-copy deletion as the audit trail.';
comment on column public.firm_onboarding_intake.client_list_attested_at is
  'Set at submit time when the rep ticks the CASL consent-basis attestation. Required on both paths.';
comment on column public.firm_onboarding_intake.client_list_working_copy_deleted_at is
  'Set by the operator after the storage objects are removed following a verified import. The auditable PIPEDA delete-after-import record.';
```

Author the file only. Do NOT apply it to production and do NOT run `supabase db push` (Section 13).

## 4. Pure lib: `src/lib/firm-onboarding-client-list.ts`

New file, no `server-only` import (it must be loadable from vitest). Exports:

```ts
export interface ClientListFile {
  storage_path: string;
  original_name: string;
  size_bytes: number;
  mime_type: string | null;
}

export type ClientListPath = "share_with_us" | "self_upload";

export const MAX_CLIENT_LIST_FILES = 10;
export const MAX_CLIENT_LIST_FILE_BYTES = 50 * 1024 * 1024;

export function validateClientListSubmission(
  body: {
    client_list_path?: unknown;
    client_list_files?: unknown;
    client_list_attested?: unknown;
    client_list_self_upload_confirmed?: unknown;
  },
  token: string
):
  | { ok: true; value: { path: ClientListPath; files: ClientListFile[]; selfUploadConfirmed: boolean } }
  | { ok: false; error: string };

export function clientListStatusLabel(row: {
  client_list_path: string | null;
  client_list_files: unknown;
  client_list_import_verified_at: string | null;
  client_list_working_copy_deleted_at: string | null;
}): string;

export interface ClientListCheckSubmission {
  legal_name: string | null;
  submitted_at: string;
  client_list_path: string | null;
  client_list_files: unknown;
  client_list_attested_at: string | null;
  client_list_import_verified_at: string | null;
  client_list_working_copy_deleted_at: string | null;
}

export function deriveClientListCheck(
  submissions: ClientListCheckSubmission[],
  firmName: string
): { status: "pass" | "fail" | "warn"; detail: string };
```

`validateClientListSubmission` rules, in this order, first failure wins:

1. `client_list_path` must be exactly `"share_with_us"` or `"self_upload"`. Otherwise `{ ok: false, error: "client_list_path is required (share_with_us or self_upload)" }`.
2. `client_list_attested` must be strictly `true`. Otherwise error `"the consent attestation is required"`.
3. If path is `share_with_us`:
   - `client_list_files` must be an array with 1 to `MAX_CLIENT_LIST_FILES` entries. Empty or missing: error `"at least one uploaded file is required on the share_with_us path"`. Over the cap: error `"too many files; max 10"`.
   - Every entry must satisfy: `storage_path` is a string that starts with `` `${encodeURIComponent(token)}/` `` (rejects cross-token references), `original_name` is a non-empty string of 200 chars or fewer, `size_bytes` is an integer from 1 to `MAX_CLIENT_LIST_FILE_BYTES`, `mime_type` is a string or null. Any violation: error `"invalid file entry"`.
   - `selfUploadConfirmed` normalises to `false`.
4. If path is `self_upload`:
   - `client_list_self_upload_confirmed` must be strictly `true`. Otherwise error `"self-upload confirmation is required"`.
   - `client_list_files` must be missing or an empty array. Otherwise error `"files cannot be attached on the self_upload path"`.
   - `files` normalises to `[]`.

`clientListStatusLabel` returns, checked in this order: `"deleted"` when `client_list_working_copy_deleted_at` is set; `"verified"` when `client_list_import_verified_at` is set; `"self-upload"` when path is `self_upload`; `"files (n)"` (n from the parsed array length, tolerate non-array as 0) when path is `share_with_us`; `"none"` otherwise.

`deriveClientListCheck` powers the `/onboarding` validator (Section 8.4). Logic, exactly:

1. Select the candidate submission: from `submissions`, keep rows where `legal_name` is non-null and `legal_name.trim().toLowerCase() === firmName.trim().toLowerCase()` (this mirrors the name-based match convention already used by `/admin/firms/[firmId]/onboarding`, which documents that `firm_onboarding_intake` has no firm_id FK). Among matches, take the one with the greatest `submitted_at` that has a non-null `client_list_path`.
2. No candidate: `{ status: "fail", detail: "No firm-profile submission with a client list" }`.
3. Candidate with null `client_list_attested_at`: `{ status: "fail", detail: "Client list present but consent attestation missing" }`.
4. Path `self_upload`: `{ status: "pass", detail: "Self-upload confirmed by the firm" }`.
5. Path `share_with_us`, `client_list_import_verified_at` null: `{ status: "warn", detail: "Files received (n): import not yet verified" }` where n is the parsed files count.
6. Path `share_with_us`, verified, not deleted: `{ status: "pass", detail: "Imported and verified: working copy pending deletion" }`.
7. Path `share_with_us`, verified and deleted: `{ status: "pass", detail: "Imported, verified, working copy deleted" }`.

## 5. Upload route: widen `src/app/api/firm-profile/[token]/upload/route.ts`

Keep the structure (token check, rate limit, FormData parse, size and type checks, sanitize, storage upload, JSON response). Change only:

1. `MAX_BYTES` becomes `50 * 1024 * 1024`. Update the error string accordingly.
2. Replace `ALLOWED_MIME` with:

```ts
const ALLOWED_MIME = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.apple.numbers",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "text/plain",
  "text/vcard",
  "text/x-vcard",
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/heif",
  "image/webp",
]);
```

3. Replace `ALLOWED_EXT` with:

```ts
const ALLOWED_EXT = new Set([
  "csv", "xlsx", "xls", "ods", "numbers",
  "pdf", "doc", "docx", "rtf", "txt", "vcf",
  "png", "jpg", "jpeg", "heic", "heif", "webp",
]);
```

4. The rejection message becomes: `"unsupported file type. Send a spreadsheet, PDF, document, contact export, or photo of the list."`
5. Rate limit: switch this route's bucket from `"firmOnboarding"` to a new `"firmOnboardingUpload"` bucket (Section 10). The registration-form upload route (`/api/firm-onboarding/[token]/upload`) stays on its current bucket; do not touch it.
6. Update the route's doc comment to describe the client-list purpose and the widened set. No em dashes in comments.

## 6. Submit route: extend `src/app/api/firm-profile/[token]/submit/route.ts`

1. Extend `ProfileBody` with `client_list_path?: unknown; client_list_files?: unknown; client_list_attested?: unknown; client_list_self_upload_confirmed?: unknown;` and drop nothing (legacy `customer_base_*` fields stay accepted).
2. After the existing `signed_name` check, call `validateClientListSubmission(body, token)`. On failure return `NextResponse.json({ ok: false, error }, { status: 400 })`.
3. In the insert payload add:

```ts
client_list_path: value.path,
client_list_files: value.files,
client_list_attested_at: new Date().toISOString(),
client_list_self_upload_confirmed: value.selfUploadConfirmed,
```

The legacy `customer_base_*` insert lines stay as they are (they will be null from the new form).

## 7. Form UI: rework Section B of `FirmProfileForm.tsx`

### 7.1 State

Remove the four `customer_base_*` fields from `ProfileState`, `INITIAL`, `handleFileUpload`, `clearUpload`, and the submit body. Add:

```ts
client_list_path: "" | "share_with_us" | "self_upload";
client_list_files: ClientListFile[];        // import the type from the pure lib
client_list_attested: boolean;
client_list_self_upload_confirmed: boolean;
```

Defaults: `""`, `[]`, `false`, `false`. No preselected path; the rep must choose.

`handleFileUpload` now appends `{storage_path, original_name, size_bytes, mime_type}` from the upload response to `client_list_files` (keep the single in-flight `upload: UploadState`; uploads are sequential). Add `removeFile(index)` that drops one entry from the array (orphaned storage objects are acceptable; the operator delete step clears them).

### 7.2 Client-side validation in `onSubmit`

Before the fetch, in this order, set `error` and return on first failure:

- No path chosen: `"Please choose how you want to hand over the client list."`
- Path share, zero files: `"Please upload at least one client file, or switch to the self-upload option."`
- Path self, confirmation unchecked: `"Please confirm the firm will upload the list itself."`
- Attestation unchecked: `"Please confirm the consent statement for the client list."`

Also extend the submit button `disabled` condition with `upload.status === "uploading"` (already present) and nothing else. Include the four new fields in the POST body, with `client_list_attested: form.client_list_attested`.

### 7.3 Section B markup and copy (exact)

Replace the current "Upload your client list (optional)" Field with the following, keeping the two existing fields above it (past-client counts, baseline inquiry volume) unchanged. Reuse the existing `Section`, `Field`, `FileUploadBlock` styling idiom (inline styles, same tokens: `#1E2F58`, `#C4B49A`, `#FBFAF6`, `#E4E2DB`, radius 4px). Build the radio cards with the same visual pattern as the payment-method checkboxes (bordered label cards).

Section B subtitle changes to: `"Rough numbers are fine. Your client list is how the reactivation and review systems start, so this part is required."`

**Field 1: path selector** (radio, required)

- Label: `How do you want to hand over the client list?`
- Option `share_with_us`, first, with a small gold `Recommended` tag: label `Share the list with CaseLoad Select`, description `Send whatever you already have. We clean it, format it, load it into your CRM, then delete our working copy. Nothing for you to prepare.`
- Option `self_upload`: label `We will upload it ourselves`, description `You fill our template and upload the list to the CRM with access we send you. Choose this only if the firm prefers not to hand the file over.`

**Branch A, shown when `share_with_us`:**

- Field label: `Upload your client files`
- Hint: `Any format you already have works: a spreadsheet, a PDF, an export from Outlook or your practice software, even photos of a printed list. Up to 10 files, 50 MB each. We need each client's name, email or phone, the practice area, and roughly when the matter closed. No case details, no documents from the file.`
- The multi-file uploader: the existing `FileUploadBlock` visual, button text `Add a file`, `accept` attribute listing the Section 5 extensions, plus a chip row above it listing each uploaded file name with a `Remove` button per chip. Hide the `Add a file` control when 10 files are present.
- Static note under the uploader (plain paragraph, `0.82rem`, `#6B665E`): `How your data is handled: CaseLoad Select processes the list solely on the firm's behalf under PIPEDA, stores it on Canadian servers, and deletes its working copy once the import into your CRM is verified.`

**Branch B, shown when `self_upload`:**

- Paragraph: `Download the template, fill the Client List tab (one row per client), and follow the guide. We will send CRM access for the upload.`
- Two links (regular anchors, navy, underlined, `target="_blank"`): `Download the template (Excel)` pointing to `/firm-onboarding-guides/client-list-template.xlsx`, and `How to fill it in, including the consent rules` pointing to `/firm-onboarding-guides/client-list.html`.
- Checkbox bound to `client_list_self_upload_confirmed`: `We will upload the completed list to the CRM ourselves.`

**Field 2: attestation** (checkbox, shown for either path once chosen, required)

Rendered in a bordered card like the Authorisation block (background `#FBFAF6`, border `1px solid #C4B49A`). Checkbox label, verbatim:

`I confirm the firm has a lawful basis under Canada's Anti-Spam Legislation (CASL) to email the clients on this list, or has recorded each client's consent basis (Express, Implied, or Unknown) so anyone without a valid basis is left out of every send. The firm remains the owner of this data.`

Do not rewrite any of the copy above. No em dashes, no italics.

## 8. Admin surfaces

### 8.1 Detail page `src/app/admin/onboarding-submissions/[id]/page.tsx`

Add the seven new columns to the row type and query. In the profile rendering path, add a `Client list` block that shows:

- Path: `Share with CaseLoad Select` / `Firm uploads it themselves` / `Not provided` (null).
- Attested at (timestamp or `Missing`).
- Files: for each `client_list_files` entry, a signed download link (same `createSignedUrl` pattern and TTL already used for `customer_base_storage_path`, `download:` set to the original name). After working-copy deletion, render the names without links and the note `Working copy deleted`.
- Lifecycle: import verified at + note, working copy deleted at.
- The legacy `customer_base_*` single-file link stays rendered when present.

Mount a new client component `ClientListOpsPanel` (colocate next to `OnboardingNotificationPanel.tsx`, copy its structure) with two buttons:

- `Mark import verified`: prompts for an optional note (plain `<input>`, max 2000 chars), POSTs to route 8.2a, then refreshes.
- `Delete working copy`: disabled until import is verified; POSTs to route 8.2b; requires a `confirm()` dialog with the text `Delete the uploaded client files from storage? The metadata stays as the audit record.`; then refreshes.

Both buttons render only for `form_type='profile'` rows with `client_list_path='share_with_us'`.

### 8.2 New operator routes

Copy the auth pattern of `src/app/api/admin/onboarding-submissions/[id]/retry-notification/route.ts` exactly (same session/secret checks, same 401/404 handling).

a) `POST /api/admin/onboarding-submissions/[id]/client-list/verify` (`route.ts` in that folder). Body `{ note?: string }` (trim, max 2000 chars, over-limit returns 400). Loads the row; 404 if missing; 400 if `client_list_path !== 'share_with_us'`. Updates `client_list_import_verified_at = now`, `client_list_import_verified_note = note ?? null`. Idempotent: calling again overwrites both. Returns `{ ok: true, verified_at }`.

b) `POST /api/admin/onboarding-submissions/[id]/client-list/delete-working-copy`. Loads the row; 404 if missing; 400 if path is not `share_with_us`; 409 with error `"import not verified yet"` when `client_list_import_verified_at` is null; 409 with error `"already deleted"` when `client_list_working_copy_deleted_at` is set. Collects every `storage_path` from `client_list_files` plus `customer_base_storage_path` when set, calls `supabase.storage.from("firm-onboarding-docs").remove(paths)`; on storage error return 500 with the message and do NOT stamp. On success set `client_list_working_copy_deleted_at = now` and return `{ ok: true, deleted_at, removed: paths.length }`. The `client_list_files` metadata is intentionally kept.

### 8.3 List page `src/app/admin/onboarding-submissions/page.tsx`

For `form_type='profile'` rows add a small status badge using `clientListStatusLabel` (values: none / files (n) / self-upload / verified / deleted). Match the page's existing badge styling.

### 8.4 Launch validator `src/app/onboarding/page.tsx`

Two changes.

**a) Fix the broken firm query (pre-existing bug, verified 2026-07-22).** The page selects `firm_name` from `intake_firms`, but the live table has no such column (the column is `name`; confirmed against production `information_schema`). PostgREST rejects the whole select, `firmsRes.data` is null, and the page renders "No intake firms configured yet" regardless of data. Fix: in `getFirmChecklists()`, change the select to `"id, name, practice_areas, geo_config, branding, ghl_webhook_url, clio_config, scoring_weights, custom_domain"` and change `firm_name: firm.firm_name ?? "Unnamed Firm"` to read `firm.name`. Change nothing else about the existing checks.

**b) Add the required `Client list` check.** In the same `Promise.all`, add:

```ts
supabase
  .from("firm_onboarding_intake")
  .select("legal_name, submitted_at, client_list_path, client_list_files, client_list_attested_at, client_list_import_verified_at, client_list_working_copy_deleted_at")
  .eq("form_type", "profile"),
```

Guard the result (`?? []`) so a missing column pre-migration cannot blank the page; if that query errors, pass an empty array (deploy-safety: the page must render even before the migration is applied). Then append one item to the `checklist` array, after `ghl_webhook`:

```ts
{
  key: "client_list",
  label: "Client list",
  ...deriveClientListCheck(profileSubs, firm.name ?? ""),
  required: true,
},
```

with `status` and `detail` spread from the pure helper (Section 4). This raises `required_total` to 5 and means a firm cannot show `Launch-ready` until its client list is either imported-and-verified (share path) or confirmed self-uploaded, with attestation, matching the two-path doctrine. Existing firms (DRG included) will show `fail` on this row until backfilled; that is intended honesty, not a defect.

## 9. Operator notification

In `src/lib/firm-onboarding-notification.ts`, extend the email body with three lines rendered with the file's existing field-row helper, in the block where profile fields appear (or appended to the generic field list if there is no profile-specific block):

- `Client list` : `Shared with CaseLoad Select (N files)` or `Firm uploads it themselves` or `Not provided`.
- `Client list files` : comma-separated original names (omit the line when empty).
- `Consent attestation` : the timestamp, or `Missing`.

Follow DR-046: do not wrap `sendOperatorNotification` in any new try/catch that hides errors.

## 10. Rate limit

In `src/lib/rate-limit.ts`: add `"firmOnboardingUpload"` to the bucket union, add `firmOnboardingUpload: { limit: 30, windowSeconds: 3600 }` to the config map, and add a doc-comment line `firmOnboardingUpload  30 per hour` next to the existing list. Only the firm-profile upload route uses it (Section 5).

## 11. Guide page `public/firm-onboarding-guides/client-list.html`

New static page, same visual family as the sibling guides (`gbp.html`, `apple.html`; read one first and match its head/styles/structure). Title: `Your client list: what to send and how consent works`. Content, in order:

1. Intro paragraph: `One list starts three systems: conflict protection on new inquiries, the Google review engine, and the reactivation cadence for clients who already trust you. This page covers what to include and how Canada's anti-spam law applies.`
2. `What to include` table, one row per field: First Name (Mandatory), Last Name (Mandatory), Email (Mandatory), Phone (Helpful), Practice Area (Mandatory), Year Matter Closed (Mandatory), Year Matter Opened (Helpful), City (Helpful), Language (Helpful), How They Found Us (Helpful), Marketing Consent (Mandatory: Express, Implied, or Unknown). Add the note: `Sharing the raw files with us instead? Send whatever you have and skip the formatting; we build this sheet for you.`
3. `Leave out` paragraph: `No matter details, no documents, no privileged content. Contact details and relationship facts only; the work product stays at the firm.`
4. `About consent (CASL)` section, verbatim paragraphs:
   - `Canada's anti-spam law (CASL) sets who a firm may email. For each client, the Marketing Consent column records the basis for emailing them.`
   - `Express consent means the client clearly agreed to receive marketing or newsletters from the firm. A checkbox, a signed line in the retainer, or a clear verbal yes all count. Express consent does not expire.`
   - `Implied consent means the client never said yes to marketing, but there is a business relationship because the firm did work for them. Implied consent expires two years after the matter closed.`
   - `Unknown means you are not sure. Mark it Unknown and the client stays out of every send until the basis is confirmed.`
   - `The safe first send is everyone marked Express, plus Implied clients whose matter closed within the last two years. Anyone past that window with no express consent does not receive marketing email.`
5. Template link block: `Download the template (Excel)` pointing to `client-list-template.xlsx`.

Writing rules apply to every sentence: no em dashes, no italics, no banned vocabulary.

## 12. Tests

All in vitest, following the repo's existing mocking patterns (look at a sibling route test before writing).

`src/lib/__tests__/firm-onboarding-client-list.test.ts`:

1. rejects missing path; 2. rejects unknown path value; 3. rejects attested false/missing on both paths; 4. share: rejects empty files; 5. share: rejects 11 files; 6. share: rejects storage_path with a different token prefix; 7. share: rejects size_bytes 0, negative, over 50 MB, non-integer; 8. share: rejects original_name empty or over 200 chars; 9. share: accepts a valid 1-file and a valid 10-file submission, normalises selfUploadConfirmed to false; 10. self: rejects unconfirmed; 11. self: rejects attached files; 12. self: accepts confirmed with no files, files normalise to []; 13. clientListStatusLabel returns each of the five labels with the documented precedence (deleted beats verified beats path); 14. deriveClientListCheck: each of the seven outcomes from Section 4, plus: name match is case-insensitive and trims whitespace, a non-matching firm name yields the fail state, the latest submission wins when two match, and a submission with null client_list_path is ignored in candidate selection.

`src/app/api/firm-profile/[token]/upload/__tests__/route.test.ts` (create the folder if absent): accepts an xlsx with empty MIME via extension fallback; accepts image/heic; accepts text/vcard; rejects a 60 MB file; rejects `.exe`; keeps the empty-file rejection.

`src/app/api/firm-profile/[token]/submit/__tests__/route.test.ts`: the four 400 cases (no path, share without files, self unconfirmed, attestation missing) with the exact error strings from Section 4; a share happy path asserting the insert payload contains `client_list_path`, the files array, a non-null `client_list_attested_at`, `client_list_self_upload_confirmed: false`; a self happy path asserting files `[]` and confirmed `true`.

`src/app/api/admin/onboarding-submissions/[id]/client-list/__tests__/route.test.ts` (one file covering both routes): unauthenticated 401; verify stamps timestamp and note; delete before verify 409; delete after verify calls `storage.remove` with exactly the union of file paths plus the legacy path and stamps `client_list_working_copy_deleted_at`; second delete 409; storage error propagates 500 without stamping.

## 13. Hard constraints

1. No em dashes anywhere, including code comments and test names. No banned vocabulary (see repo CLAUDE.md "Do Not"). No italics in user-facing copy.
2. No new npm dependencies. Never run `npm install` on this drive; if `node_modules` is missing or broken, stop and report instead of installing.
3. Do not apply migrations to production, do not run `supabase db push`, do not call Supabase MCP write tools. Author the SQL file only.
4. Do not touch `src/lib/screen-engine/`, `src/app/(marketing)/`, `.claude/worktrees/`, or `FirmOnboardingForm.tsx`.
5. Run `npm run lint`, `npx tsc --noEmit`, and the full vitest suite; all three must be green before the work is called done. Report exact counts.
6. Commit locally with a conventional message (`feat: client-list intake two-path model on firm profile [BUILD_PLAN_client_list_intake_v1]`). Do not push, do not open a PR.
7. If any verified fact in Section 2 turns out not to match the tree, stop and report the mismatch instead of improvising around it.

## 14. Acceptance checklist

- [ ] Migration file exists with the exact columns and comments from Section 3.
- [ ] Pure lib implements the exact validation order and error strings from Section 4.
- [ ] Upload route accepts the Section 5 matrix at 50 MB and uses the new rate bucket.
- [ ] Submit route rejects and persists per Section 6.
- [ ] Section B renders the path selector, both branches, and the attestation with the exact copy from Section 7.
- [ ] Admin detail page shows the client-list block; verify and delete actions behave per Section 8 (delete blocked before verify, metadata kept after delete).
- [ ] List page badge renders the five states.
- [ ] `/onboarding` validator: firm query fixed (`name`, not `firm_name`), firms render again, and the required `Client list` check appears with 5 required checks total; page still renders pre-migration (guarded query).
- [ ] Notification email carries the three new lines.
- [ ] Guide page live at `/firm-onboarding-guides/client-list.html` with the Section 11 copy; template downloads at `/firm-onboarding-guides/client-list-template.xlsx`.
- [ ] All tests from Section 12 written and green; lint + typecheck + full suite green.
- [ ] Local commit made; nothing pushed.

## 15. Rollout (operator steps, NOT the executor's)

1. Adriano or Claude Opus applies `20260722000000_firm_onboarding_client_list.sql` to prod (deploy-safety order: migration first, then deploy, because the submit route inserts the new columns).
2. @devops pushes and deploys.
3. Live smoke test with a fresh token: one share_with_us submission with two files (a csv and a phone photo), one self_upload submission; verify admin panel, download links, verify + delete flow, notification email content. Then open `/onboarding` and confirm firms render again (the firm_name bug is gone) and the Client list row tracks the smoke submissions through warn to pass.
4. Register the decision as a DR in `00_System/01_Doctrine/DECISION_RECORDS.md` (registry first, then references), and flip the spec doc `ACTS_Day1_ClientListIntake_v1.md` from draft-spec to canonical with the Form 2 placement.
5. Add the client-list step to the Day 1 onboarding checklist set in `04_Playbooks/05_Operations/`.
