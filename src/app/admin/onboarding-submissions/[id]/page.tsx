/**
 * /admin/onboarding-submissions/[id]
 *
 * Detail view of one firm-onboarding submission. Shows every field plus a
 * fresh signed URL for downloading the verification document (if uploaded).
 *
 * Signed URLs expire after 1 hour. The page is force-dynamic so each visit
 * regenerates the URL — operator can refresh if it lapses.
 *
 * Auth: getOperatorSession() in /admin/layout.tsx.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OnboardingNotificationPanel } from "@/components/admin/OnboardingNotificationPanel";
import { ClientListOpsPanel } from "@/components/admin/ClientListOpsPanel";

interface Submission {
  id: string;
  submission_token: string;
  legal_name: string | null;
  business_number: string | null;
  business_address: string | null;
  business_website: string | null;
  business_email: string | null;
  authorized_rep_name: string | null;
  authorized_rep_title: string | null;
  authorized_rep_email: string | null;
  authorized_rep_phone: string | null;
  authorized_rep_year_of_call: number | null;
  authorized_rep_province_of_call: string | null;
  previous_business_names: string | null;
  lso_member_number: string | null;
  registered_legal_name: string | null;
  additional_bar_admissions: Array<{ jurisdiction?: string; year?: number | string | null; status?: string }> | null;
  real_estate_insured: string | null;
  offers_limited_scope: string | null;
  professional_liability_insurance: string | null;
  languages: string[] | null;
  languages_other: string | null;
  domain_registrar: string | null;
  dns_control: string | null;
  dns_access_preference: string | null;
  email_platform: string | null;
  sms_vertical: string | null;
  sms_sender_phone_preference: string | null;
  whatsapp_number_decision: string | null;
  whatsapp_display_name: string | null;
  whatsapp_business_verification_doc_note: string | null;
  verification_doc_storage_path: string | null;
  verification_doc_original_name: string | null;
  verification_doc_size_bytes: number | null;
  verification_doc_mime_type: string | null;
  has_facebook_account: boolean | null;
  has_meta_business_manager: boolean | null;
  meta_business_manager_url: string | null;
  will_add_operator_as_admin: boolean | null;
  meta_admin_status: string | null;
  meta_admin_blocker_note: string | null;
  gbp_admin_status: string | null;
  gbp_admin_blocker_note: string | null;
  linkedin_admin_status: string | null;
  linkedin_admin_blocker_note: string | null;
  // v2 Phase 1: Bing Places + Apple Business Connect access tracking
  bing_places_status: string | null;
  bing_places_notes: string | null;
  apple_business_status: string | null;
  apple_business_notes: string | null;
  // v2 Phase 1: Services + Fees capture
  fees_upload_storage_path: string | null;
  fees_upload_original_name: string | null;
  fees_upload_size_bytes: number | null;
  fees_upload_mime_type: string | null;
  fees_freetext: string | null;
  fees_structured: Array<{ service?: string; fee?: string; fee_type?: string }> | null;
  m365_admin_status: string | null;
  m365_admin_blocker_note: string | null;
  intake_channels: string[] | null;
  signed_name: string | null;
  signed_email: string | null;
  consent_acknowledged: boolean;
  notes: string | null;
  booking_url: string | null;
  office_hours: string | null;
  additional_lawyers: Array<{
    name?: string;
    email?: string;
    role?: string;
    year_of_call?: number | string | null;
    province_of_call?: string | null;
  }> | null;
  practice_areas: string[] | null;
  practice_areas_other: string | null;
  service_area: string | null;
  service_area_other: string | null;
  out_of_scope_notes: string | null;
  existing_website_form_url: string | null;
  existing_phone_lines: string | null;
  practice_management_system: string | null;
  practice_management_system_other: string | null;
  pms_integration_preference: string | null;
  submitted_at: string;
  ip_address: string | null;
  user_agent: string | null;
  // Operator-notification delivery state. NULL on rows that pre-date the
  // 2026-05-20 notification-tracking migration; the panel treats those as
  // "Pending — never attempted".
  notification_sent_at: string | null;
  notification_error: string | null;
  notification_attempts: number | null;
  notification_last_attempt_at: string | null;
  // v2 form_type + Firm Profile (Form 2) fields
  form_type: string;
  office_model: string | null;
  firm_size: string | null;
  annual_revenue_band: string | null;
  second_contact: string | null;
  ooo_pattern: string | null;
  past_clients_active: number | null;
  past_clients_mid: number | null;
  past_clients_closed: number | null;
  baseline_inquiry_volume: number | null;
  fee_structure: string | null;
  payment_methods: string[] | null;
  esignature_tool: string | null;
  marketing_crm: string | null;
  brand_assets_status: string | null;
  brand_assets_notes: string | null;
  photos_status: string | null;
  social_linkedin_personal: string | null;
  social_instagram: string | null;
  social_x: string | null;
  social_facebook: string | null;
  icp_want_more: string | null;
  icp_decline: string | null;
  review_comfort: string | null;
  profile_notes: string | null;
  customer_base_storage_path: string | null;
  customer_base_original_name: string | null;
  customer_base_size_bytes: number | null;
  customer_base_mime_type: string | null;
  client_list_path: string | null;
  client_list_files: Array<{
    storage_path?: string;
    original_name?: string;
    size_bytes?: number;
    mime_type?: string | null;
  }> | null;
  client_list_attested_at: string | null;
  client_list_self_upload_confirmed: boolean | null;
  client_list_import_verified_at: string | null;
  client_list_import_verified_note: string | null;
  client_list_working_copy_deleted_at: string | null;
}

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour
const BUCKET = "firm-onboarding-docs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: row, error } = await supabase
    .from("firm_onboarding_intake")
    .select("*")
    .eq("id", id)
    .maybeSingle<Submission>();

  if (error) {
    return (
      <div className="bg-white border border-red-200 px-6 py-6">
        <p className="text-sm text-red-700">{error.message}</p>
      </div>
    );
  }
  if (!row) {
    notFound();
  }

  // Generate a fresh signed URL for the verification doc, if uploaded.
  let docSignedUrl: string | null = null;
  let docError: string | null = null;
  if (row.verification_doc_storage_path) {
    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.verification_doc_storage_path, SIGNED_URL_TTL_SECONDS, {
        download: row.verification_doc_original_name ?? true,
      });
    if (signErr) {
      docError = signErr.message;
    } else {
      docSignedUrl = signed?.signedUrl ?? null;
    }
  }

  // Fresh signed URL for the Firm Profile client-list upload, if present.
  let customerBaseSignedUrl: string | null = null;
  if (row.customer_base_storage_path) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.customer_base_storage_path, SIGNED_URL_TTL_SECONDS, {
        download: row.customer_base_original_name ?? true,
      });
    customerBaseSignedUrl = signed?.signedUrl ?? null;
  }

  // Fresh signed URLs for each client-list file, if present and the working
  // copy has not been deleted. Skipped for a deleted working copy so the
  // detail page never offers a download link to a file that no longer
  // exists in storage.
  let clientListFileUrls: Array<{ original_name: string; url: string | null }> = [];
  if (
    row.client_list_path === "share_with_us" &&
    !row.client_list_working_copy_deleted_at &&
    Array.isArray(row.client_list_files)
  ) {
    clientListFileUrls = await Promise.all(
      row.client_list_files.map(async (f) => {
        const path = typeof f?.storage_path === "string" ? f.storage_path : null;
        const name = f?.original_name ?? "(file)";
        if (!path) return { original_name: name, url: null };
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: name });
        return { original_name: name, url: signed?.signedUrl ?? null };
      }),
    );
  }

  // Fresh signed URL for the fees schedule upload, if present.
  let feesSignedUrl: string | null = null;
  if (row.fees_upload_storage_path) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.fees_upload_storage_path, SIGNED_URL_TTL_SECONDS, {
        download: row.fees_upload_original_name ?? true,
      });
    feesSignedUrl = signed?.signedUrl ?? null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
          <h1 className="text-2xl font-bold text-navy mt-1">{row.legal_name ?? "(no name)"}</h1>
          <p className="text-xs text-black/50 mt-1">
            <span
              className={`inline-block mr-2 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 border ${
                row.form_type === "profile"
                  ? "bg-gold/15 text-navy border-gold/40"
                  : "bg-navy/5 text-navy border-navy/15"
              }`}
            >
              {row.form_type === "profile" ? "Firm Profile" : "Registration"}
            </span>
            Token: <code>{row.submission_token}</code> · Submitted {formatTime(row.submitted_at)}
          </p>
        </div>
        <Link
          href="/admin/onboarding-submissions"
          className="text-xs uppercase tracking-wider font-semibold text-black/60 hover:text-navy border border-black/15 hover:border-navy px-3 py-2 transition-colors"
        >
          ← All submissions
        </Link>
      </div>

      <Section title="Notification status">
        <OnboardingNotificationPanel
          submissionId={row.id}
          notificationSentAt={row.notification_sent_at}
          notificationError={row.notification_error}
          notificationAttempts={row.notification_attempts ?? 0}
          notificationLastAttemptAt={row.notification_last_attempt_at}
        />
      </Section>

      {row.form_type !== "profile" && (
        <>
      <Section title="1. Business identity">
        <Fields>
          <Field label="Legal name" value={row.legal_name} />
          <Field label="CRA Business Number" value={row.business_number} mono />
          <Field label="Address" value={row.business_address} multiline />
          <Field label="Website" value={row.business_website} link />
          <Field label="Business email" value={row.business_email} link={row.business_email ? `mailto:${row.business_email}` : undefined} />
          <Field label="Authorized rep" value={row.authorized_rep_name} />
          <Field label="Title" value={row.authorized_rep_title} />
          <Field label="Rep email" value={row.authorized_rep_email} link={row.authorized_rep_email ? `mailto:${row.authorized_rep_email}` : undefined} />
          <Field label="Rep phone" value={row.authorized_rep_phone} />
          <Field
            label="Rep bar of call"
            value={prettifyYearProvince(
              row.authorized_rep_year_of_call,
              row.authorized_rep_province_of_call,
            )}
          />
          <Field
            label="Firms practiced under"
            value={row.previous_business_names}
            multiline
          />
          <Field label="LSO Member Number" value={row.lso_member_number} mono />
          <Field label="Registered legal name" value={row.registered_legal_name} />
          <Field label="Additional bar admissions" value={prettifyBars(row.additional_bar_admissions)} multiline />
          <Field label="Real estate insured" value={prettifyYesNoNa(row.real_estate_insured)} />
          <Field label="Limited scope retainers" value={prettifyYesNo(row.offers_limited_scope)} />
          <Field label="Professional liability insurance" value={row.professional_liability_insurance} multiline />
          <Field label="Calendar booking URL" value={row.booking_url} link />
          <Field label="Office hours" value={row.office_hours} />
          <Field
            label="Additional lawyers"
            value={prettifyAdditionalLawyers(row.additional_lawyers)}
            multiline
          />
        </Fields>
      </Section>

      <Section title="2. Practice scope">
        <Fields>
          <Field label="Primary practice areas" value={prettifyPracticeAreas(row.practice_areas)} multiline />
          <Field label="Other areas" value={row.practice_areas_other} multiline />
          <Field label="Service area" value={prettifyServiceArea(row.service_area, row.service_area_other)} />
          <Field label="Out-of-scope matters" value={row.out_of_scope_notes} multiline />
          <Field label="Languages of practice" value={prettifyLanguages(row.languages, row.languages_other)} />
        </Fields>
      </Section>

      <Section title="3. Existing systems, domain, and migration">
        <Fields>
          <Field label="Current website contact form" value={row.existing_website_form_url} link />
          <Field label="Existing phone line(s)" value={row.existing_phone_lines} multiline />
          <Field
            label="Practice management system"
            value={prettifyPMS(row.practice_management_system, row.practice_management_system_other)}
          />
          <Field label="Integration preference" value={prettifyPMSIntegration(row.pms_integration_preference)} />
          <Field label="Domain registrar" value={prettifyRegistrar(row.domain_registrar)} />
          <Field label="DNS control" value={prettifyDnsControl(row.dns_control)} />
          <Field label="DNS access preference" value={prettifyDnsAccess(row.dns_access_preference)} />
          <Field label="Email platform" value={prettifyEmailPlatform(row.email_platform)} />
        </Fields>
      </Section>

      <Section title="4. SMS · A2P 10DLC">
        <Fields>
          <Field label="Vertical" value={row.sms_vertical} />
          <Field label="Sender phone preference" value={row.sms_sender_phone_preference} multiline />
        </Fields>
      </Section>

      <Section title="5. Intake channels + WhatsApp Business">
        <Fields>
          <Field
            label="Channels selected"
            value={prettifyChannels(row.intake_channels)}
          />
          <Field
            label="Number decision"
            value={
              row.whatsapp_number_decision === "provision_new_ghl_number"
                ? "Provision new GHL number (Voice AI + SMS + WhatsApp on the same line)"
                : row.whatsapp_number_decision === "different_carrier_line"
                  ? "Different number (coordinate separately)"
                  : row.whatsapp_number_decision
            }
          />
          <Field label="Display name" value={row.whatsapp_display_name} />
          <Field label="Doc type selected" value={prettifyDocType(row.whatsapp_business_verification_doc_note)} />
        </Fields>

        <div className="mt-4 bg-parchment border border-gold/40 px-5 py-4">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-gold mb-2">
            Verification document
          </p>
          {row.verification_doc_storage_path ? (
            <div className="space-y-2">
              <p className="text-sm text-black/80">
                <span className="font-semibold">{row.verification_doc_original_name ?? "(file)"}</span>
                {row.verification_doc_size_bytes ? (
                  <span className="text-black/50 ml-2 text-xs">
                    {formatBytes(row.verification_doc_size_bytes)}
                  </span>
                ) : null}
                {row.verification_doc_mime_type ? (
                  <span className="text-black/50 ml-2 text-xs">{row.verification_doc_mime_type}</span>
                ) : null}
              </p>
              {docSignedUrl ? (
                <a
                  href={docSignedUrl}
                  className="inline-flex items-center gap-2 bg-navy text-white text-xs font-semibold uppercase tracking-wider px-4 py-2 hover:bg-navy/90 transition-colors"
                >
                  Download
                  <span aria-hidden>↓</span>
                </a>
              ) : (
                <p className="text-xs text-red-700">
                  Signed URL failed{docError ? `: ${docError}` : ""}. Refresh the page to retry.
                </p>
              )}
              <p className="text-[10px] text-black/40">
                Signed URL expires in 1 hour. Refresh this page to generate a new one.
              </p>
              <p className="text-[10px] text-black/40 font-mono">
                {row.verification_doc_storage_path}
              </p>
            </div>
          ) : (
            <p className="text-sm text-black/50">
              No document uploaded. Rep indicated they would send it later.
            </p>
          )}
        </div>
      </Section>

      <Section title="6. Meta Business Manager">
        <Fields>
          <Field label="Has Facebook account" value={yesNo(row.has_facebook_account)} />
          <Field label="Has Meta Business Manager" value={yesNo(row.has_meta_business_manager)} />
          <Field label="MBM URL / ID" value={row.meta_business_manager_url} link />
          <Field label="Will add operator as admin" value={yesNo(row.will_add_operator_as_admin)} />
        </Fields>
        <AccessStatusRow
          label="Meta admin access"
          status={row.meta_admin_status}
          blockerNote={row.meta_admin_blocker_note}
        />
      </Section>

      <Section title="7. Google Business Profile manager">
        <AccessStatusRow
          label="GBP Manager access"
          status={row.gbp_admin_status}
          blockerNote={row.gbp_admin_blocker_note}
        />
      </Section>

      <Section title="8. LinkedIn Company Page admin">
        <AccessStatusRow
          label="LinkedIn Super admin access"
          status={row.linkedin_admin_status}
          blockerNote={row.linkedin_admin_blocker_note}
        />
      </Section>

      <Section title="9. Bing Places for Business">
        <AccessStatusRow
          label="Bing Places Manager access"
          status={row.bing_places_status}
          blockerNote={row.bing_places_notes}
        />
      </Section>

      <Section title="10. Apple Business Connect">
        <AccessStatusRow
          label="Apple Business Connect access"
          status={row.apple_business_status}
          blockerNote={row.apple_business_notes}
        />
      </Section>

      <Section title="11. Services and fees">
        <Fields>
          <Field label="Fees pasted (free-text)" value={row.fees_freetext} multiline />
        </Fields>
        <FeesCheatsheetTable rows={row.fees_structured} />
        <div className="mt-4 bg-parchment border border-gold/40 px-5 py-4">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-gold mb-2">Fee schedule upload</p>
          {row.fees_upload_storage_path ? (
            <div className="space-y-2">
              <p className="text-sm text-black/80">
                <span className="font-semibold">{row.fees_upload_original_name ?? "(file)"}</span>
                {row.fees_upload_size_bytes ? (
                  <span className="text-black/50 ml-2 text-xs">{formatBytes(row.fees_upload_size_bytes)}</span>
                ) : null}
                {row.fees_upload_mime_type ? (
                  <span className="text-black/50 ml-2 text-xs">{row.fees_upload_mime_type}</span>
                ) : null}
              </p>
              {feesSignedUrl ? (
                <a
                  href={feesSignedUrl}
                  className="inline-flex items-center gap-2 bg-navy text-white text-xs font-semibold uppercase tracking-wider px-4 py-2 hover:bg-navy/90 transition-colors"
                >
                  Download <span aria-hidden>↓</span>
                </a>
              ) : (
                <p className="text-xs text-red-700">Signed URL unavailable. Refresh the page to retry.</p>
              )}
              <p className="text-[10px] text-black/40">
                Signed URL expires in 1 hour. Refresh this page to generate a new one.
              </p>
            </div>
          ) : (
            <p className="text-sm text-black/50">No fee schedule uploaded.</p>
          )}
        </div>
      </Section>

      {/* Microsoft 365 Exchange admin section removed 2026-05-14 — Resend
         handles outbound email via DNS records, no Exchange Admin role
         needed from the firm. m365_admin_status and m365_admin_blocker_note
         columns remain in firm_onboarding_intake for historical rows but
         this UI no longer renders them. Query Supabase directly if you
         need to inspect an old submission's M365 field. */}

      {row.notes ? (
        <Section title="12. Notes from the rep">
          <p className="text-sm text-black/80 whitespace-pre-wrap leading-relaxed">{row.notes}</p>
        </Section>
      ) : null}
        </>
      )}

      {row.form_type === "profile" ? (
        <ProfileSections row={row} customerBaseUrl={customerBaseSignedUrl} clientListFileUrls={clientListFileUrls} />
      ) : null}

      <Section title="Authorisation">
        <Fields>
          <Field label="Signed by" value={row.signed_name} />
          <Field label="Signature email" value={row.signed_email} link={row.signed_email ? `mailto:${row.signed_email}` : undefined} />
          <Field label="Signed at" value={formatTime(row.submitted_at)} />
          <Field label="Consent flag" value={row.consent_acknowledged ? "Yes" : "No"} />
        </Fields>
      </Section>

      <Section title="Submission metadata">
        <Fields>
          <Field label="Submitted at" value={formatTime(row.submitted_at)} />
          <Field label="IP address" value={row.ip_address} mono />
          <Field label="User agent" value={row.user_agent} mono />
        </Fields>
      </Section>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-black/10 px-5 py-5">
      <h2 className="text-sm font-bold text-navy uppercase tracking-wider mb-4">{title}</h2>
      {children}
    </section>
  );
}

function AccessStatusRow({
  label,
  status,
  blockerNote,
}: {
  label: string;
  status: string | null;
  blockerNote: string | null;
}) {
  const meta =
    status === "granted"
      ? { text: "Done: access granted", className: "bg-emerald-100 text-emerald-900 border-emerald-300" }
      : status === "in_progress"
        ? { text: "In progress", className: "bg-amber-50 text-amber-900 border-amber-300" }
        : status === "blocked"
          ? { text: "Blocked", className: "bg-red-50 text-red-900 border-red-300" }
          : status === "not_started"
            ? { text: "Not started yet", className: "bg-black/5 text-black/60 border-black/15" }
            : { text: "—", className: "bg-black/5 text-black/40 border-black/10" };

  return (
    <div className="mt-4 bg-parchment border border-gold/40 px-5 py-4">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-gold mb-3">{label}</p>
      <span
        className={`inline-flex items-center font-bold text-[10px] uppercase tracking-wider px-2 py-1 border ${meta.className}`}
      >
        {meta.text}
      </span>
      {blockerNote ? (
        <div className="mt-3 text-sm text-black/80 whitespace-pre-wrap bg-white border border-red-200 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-red-700 mb-1.5">Blocker note from the rep</p>
          {blockerNote}
        </div>
      ) : null}
    </div>
  );
}

function Fields({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">{children}</dl>;
}

function FeesCheatsheetTable({
  rows,
}: {
  rows: Array<{ service?: string; fee?: string; fee_type?: string }> | null;
}) {
  if (!rows || rows.length === 0) {
    return (
      <div className="mt-2">
        <p className="text-[10px] uppercase tracking-wider text-black/40 font-semibold mb-0.5">Cheatsheet</p>
        <p className="text-black/30 text-sm">Not filled in</p>
      </div>
    );
  }
  const feeTypeLabels: Record<string, string> = {
    flat: "Flat",
    hourly: "Hourly",
    starting_at: "Starting at",
    by_quote: "By quote",
    not_offered: "Not offered",
  };
  return (
    <div className="mt-2">
      <p className="text-[10px] uppercase tracking-wider text-black/40 font-semibold mb-1.5">Cheatsheet</p>
      <div className="border border-black/10">
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-[1.6fr_0.8fr_1fr] gap-2 px-3 py-2 text-sm border-b border-black/5 last:border-b-0"
          >
            <span className="text-black/80 break-words">{r.service || "(unnamed)"}</span>
            <span className="text-black/60 tabular-nums">{r.fee ? `$${r.fee}` : ""}</span>
            <span className="text-black/60">{r.fee_type ? (feeTypeLabels[r.fee_type] ?? r.fee_type) : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  multiline,
  link,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  multiline?: boolean;
  link?: boolean | string;
}) {
  if (value === undefined || value === null || value === "") {
    return (
      <div>
        <dt className="text-[10px] uppercase tracking-wider text-black/40 font-semibold mb-0.5">{label}</dt>
        <dd className="text-black/30">—</dd>
      </div>
    );
  }
  const className = [
    mono ? "font-mono text-xs" : "",
    multiline ? "whitespace-pre-wrap" : "",
  ]
    .filter(Boolean)
    .join(" ");
  let body: React.ReactNode = value;
  if (link === true) {
    body = (
      <a href={value} target="_blank" rel="noopener noreferrer" className={`${className} text-navy hover:underline break-words`}>
        {value}
      </a>
    );
  } else if (typeof link === "string") {
    body = (
      <a href={link} className={`${className} text-navy hover:underline break-words`}>
        {value}
      </a>
    );
  } else {
    body = <span className={`${className} text-black/80 break-words`}>{value}</span>;
  }
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-black/40 font-semibold mb-0.5">{label}</dt>
      <dd>{body}</dd>
    </div>
  );
}

function yesNo(v: boolean | null): string | null {
  if (v === null) return null;
  return v ? "Yes" : "No";
}

// ── v2 Form 1 prettifiers ──────────────────────────────────────────────────

function prettifyYesNo(v: string | null): string | null {
  if (!v) return null;
  if (v === "yes") return "Yes";
  if (v === "no") return "No";
  return v;
}

function prettifyYesNoNa(v: string | null): string | null {
  if (!v) return null;
  if (v === "yes") return "Yes";
  if (v === "no") return "No";
  if (v === "na") return "Not applicable";
  return v;
}

function prettifyLanguages(v: string[] | null, other: string | null): string | null {
  const labels: Record<string, string> = {
    english: "English",
    french: "French",
    portuguese: "Portuguese",
    spanish: "Spanish",
    mandarin: "Mandarin",
    cantonese: "Cantonese",
    punjabi: "Punjabi",
    arabic: "Arabic",
    hindi: "Hindi",
    tagalog: "Tagalog",
  };
  const parts = (v ?? []).map((k) => labels[k] ?? k);
  if (other && other.trim()) parts.push(other.trim());
  return parts.length > 0 ? parts.join(", ") : null;
}

function prettifyBars(
  v: Array<{ jurisdiction?: string; year?: number | string | null; status?: string }> | null,
): string | null {
  if (!v || v.length === 0) return null;
  const statusLabels: Record<string, string> = {
    active: "active",
    non_practising: "non-practising",
  };
  const lines = v
    .filter((b) => (b.jurisdiction && b.jurisdiction.trim()) || (b.year != null && String(b.year).trim() !== ""))
    .map((b) => {
      const parts = [b.jurisdiction?.trim() || "(bar)"];
      if (b.year != null && String(b.year).trim() !== "") parts.push(String(b.year));
      if (b.status && b.status.trim()) parts.push(statusLabels[b.status] ?? b.status);
      return parts.join(", ");
    });
  return lines.length > 0 ? lines.join("\n") : null;
}

function prettifyRegistrar(v: string | null): string | null {
  if (!v) return null;
  const m: Record<string, string> = {
    godaddy: "GoDaddy",
    namecheap: "Namecheap",
    google_squarespace: "Google Domains or Squarespace",
    cloudflare: "Cloudflare",
    other: "Other",
    not_sure: "Not sure",
  };
  return m[v] ?? v;
}

function prettifyDnsControl(v: string | null): string | null {
  if (!v) return null;
  const m: Record<string, string> = {
    self: "Firm can log in",
    third_party: "Web developer or third party",
    not_sure: "Not sure",
  };
  return m[v] ?? v;
}

function prettifyDnsAccess(v: string | null): string | null {
  if (!v) return null;
  const m: Record<string, string> = {
    grant_access: "Will grant access",
    send_records: "Send records to apply",
    screenshare: "Screenshare together",
  };
  return m[v] ?? v;
}

function prettifyEmailPlatform(v: string | null): string | null {
  if (!v) return null;
  const m: Record<string, string> = {
    microsoft_365: "Microsoft 365",
    google_workspace: "Google Workspace",
    other: "Other",
    none: "None yet",
  };
  return m[v] ?? v;
}

// ── v2 Firm Profile (Form 2) rendering ──────────────────────────────────────

function pmap(v: string | null, map: Record<string, string>): string | null {
  if (!v) return null;
  return map[v] ?? v;
}

function numOrNull(v: number | null): string | null {
  return v === null || v === undefined ? null : String(v);
}

function prettifyPayments(v: string[] | null): string | null {
  if (!v || v.length === 0) return null;
  const m: Record<string, string> = {
    stripe: "Stripe or card",
    interac: "Interac e-transfer",
    cheque: "Cheque",
    other: "Other",
  };
  return v.map((k) => m[k] ?? k).join(", ");
}

function ProfileSections({
  row,
  customerBaseUrl,
  clientListFileUrls,
}: {
  row: Submission;
  customerBaseUrl: string | null;
  clientListFileUrls: Array<{ original_name: string; url: string | null }>;
}) {
  return (
    <>
      <Section title="A. Firm shape">
        <Fields>
          <Field label="Office model" value={pmap(row.office_model, { remote: "Remote only", hybrid: "Hybrid", in_office: "In-office" })} />
          <Field label="Firm size" value={pmap(row.firm_size, { solo: "Solo", two: "Two lawyers", three_plus: "Three or more" })} />
          <Field label="Annual revenue band" value={pmap(row.annual_revenue_band, { under_250k: "Under 250k", "250k_500k": "250k to 500k", "500k_1m": "500k to 1M", over_1m: "Over 1M" })} />
          <Field label="Second contact" value={row.second_contact} />
          <Field label="Out-of-office pattern" value={row.ooo_pattern} multiline />
        </Fields>
      </Section>

      <Section title="B. Existing client base">
        <Fields>
          <Field label="Active matters" value={numOrNull(row.past_clients_active)} />
          <Field label="Mid-engagement" value={numOrNull(row.past_clients_mid)} />
          <Field label="Closed or past" value={numOrNull(row.past_clients_closed)} />
          <Field label="Baseline inquiries / month" value={numOrNull(row.baseline_inquiry_volume)} />
        </Fields>
        <div className="mt-4 bg-parchment border border-gold/40 px-5 py-4">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-gold mb-2">Client list</p>

          <p className="text-sm text-black/80 mb-1">
            Path:{" "}
            {row.client_list_path === "share_with_us"
              ? "Share with CaseLoad Select"
              : row.client_list_path === "self_upload"
                ? "Firm uploads it themselves"
                : "Not provided"}
          </p>
          <p className="text-sm text-black/80 mb-3">
            Attested at: {row.client_list_attested_at ? formatTime(row.client_list_attested_at) : "Missing"}
          </p>

          {row.client_list_path === "share_with_us" ? (
            <>
              {row.client_list_working_copy_deleted_at ? (
                <div className="space-y-1 mb-3">
                  <p className="text-xs text-black/50">Working copy deleted.</p>
                  {(Array.isArray(row.client_list_files) ? row.client_list_files : []).map((f, i) => (
                    <p key={i} className="text-sm text-black/50">
                      {f?.original_name ?? "(file)"}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="space-y-2 mb-3">
                  {clientListFileUrls.length === 0 ? (
                    <p className="text-sm text-black/50">No files uploaded.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {clientListFileUrls.map((f, i) =>
                        f.url ? (
                          <a
                            key={i}
                            href={f.url}
                            className="inline-flex items-center gap-2 bg-navy text-white text-xs font-semibold uppercase tracking-wider px-4 py-2 hover:bg-navy/90 transition-colors"
                          >
                            {f.original_name} <span aria-hidden>↓</span>
                          </a>
                        ) : (
                          <p key={i} className="text-xs text-red-700">
                            {f.original_name}: signed URL unavailable
                          </p>
                        ),
                      )}
                    </div>
                  )}
                  <p className="text-[10px] text-black/40">
                    Signed URLs expire in 1 hour. Refresh this page to generate new ones.
                  </p>
                </div>
              )}

              <p className="text-sm text-black/80">
                Import verified:{" "}
                {row.client_list_import_verified_at ? formatTime(row.client_list_import_verified_at) : "Not yet"}
                {row.client_list_import_verified_note ? (
                  <span className="text-black/50 ml-2">({row.client_list_import_verified_note})</span>
                ) : null}
              </p>
              <p className="text-sm text-black/80">
                Working copy deleted:{" "}
                {row.client_list_working_copy_deleted_at
                  ? formatTime(row.client_list_working_copy_deleted_at)
                  : "Not yet"}
              </p>

              <ClientListOpsPanel
                submissionId={row.id}
                importVerifiedAt={row.client_list_import_verified_at}
                workingCopyDeletedAt={row.client_list_working_copy_deleted_at}
              />
            </>
          ) : null}

          {row.customer_base_storage_path ? (
            <div className="mt-3 pt-3 border-t border-gold/20">
              <p className="text-[10px] uppercase tracking-wider text-black/40 font-semibold mb-1">
                Legacy single-file upload
              </p>
              <p className="text-sm text-black/80">
                <span className="font-semibold">{row.customer_base_original_name ?? "(file)"}</span>
                {row.customer_base_size_bytes ? (
                  <span className="text-black/50 ml-2 text-xs">{formatBytes(row.customer_base_size_bytes)}</span>
                ) : null}
              </p>
              {customerBaseUrl ? (
                <a
                  href={customerBaseUrl}
                  className="inline-flex items-center gap-2 bg-navy text-white text-xs font-semibold uppercase tracking-wider px-4 py-2 hover:bg-navy/90 transition-colors mt-2"
                >
                  Download <span aria-hidden>↓</span>
                </a>
              ) : (
                <p className="text-xs text-red-700">Signed URL unavailable. Refresh the page to retry.</p>
              )}
            </div>
          ) : null}

          {!row.client_list_path && !row.customer_base_storage_path ? (
            <p className="text-sm text-black/50">No client list uploaded.</p>
          ) : null}
        </div>
      </Section>

      <Section title="C. Fees and engagement">
        <Fields>
          <Field label="Fee structure" value={row.fee_structure} multiline />
          <Field label="Payment methods" value={prettifyPayments(row.payment_methods)} />
          <Field label="E-signature tool" value={pmap(row.esignature_tool, { docusign: "DocuSign or similar", pms_native: "Native in PMS", none: "None yet" })} />
          <Field label="Marketing CRM" value={pmap(row.marketing_crm, { none: "None", mailchimp: "Mailchimp", klaviyo: "Klaviyo", ghl: "GoHighLevel already", other: "Other" })} />
        </Fields>
      </Section>

      <Section title="D. Brand and presence">
        <Fields>
          <Field label="Brand assets" value={pmap(row.brand_assets_status, { all: "Have all of it", some: "Have some of it", none: "None, build from scratch" })} />
          <Field label="Photos" value={pmap(row.photos_status, { have: "Have current photos", need_shoot: "Need a shoot", ai_ok: "Open to AI-generated" })} />
          <Field label="Brand notes" value={row.brand_assets_notes} multiline />
          <Field label="Personal LinkedIn" value={row.social_linkedin_personal} link />
          <Field label="Instagram" value={row.social_instagram} />
          <Field label="X / Twitter" value={row.social_x} />
          <Field label="Facebook" value={row.social_facebook} link />
        </Fields>
      </Section>

      <Section title="E. Growth and screening">
        <Fields>
          <Field label="Who they want more of" value={row.icp_want_more} multiline />
          <Field label="What they decline" value={row.icp_decline} multiline />
          <Field label="Review-collection comfort" value={row.review_comfort} multiline />
        </Fields>
      </Section>

      {row.profile_notes ? (
        <Section title="F. Notes from the rep">
          <p className="text-sm text-black/80 whitespace-pre-wrap leading-relaxed">{row.profile_notes}</p>
        </Section>
      ) : null}
    </>
  );
}

function prettifyDocType(v: string | null): string | null {
  if (!v) return null;
  if (v === "articles_of_incorporation") return "Articles of Incorporation";
  if (v === "utility_bill") return "Recent utility bill";
  if (v === "tax_document") return "Recent tax document";
  if (v === "not_sure") return "Not sure — discuss";
  return v;
}

function prettifyChannels(v: string[] | null): string | null {
  if (!v || v.length === 0) return null;
  const labels: Record<string, string> = {
    whatsapp: "WhatsApp",
    sms: "SMS",
    voice: "Voice",
    instagram_dm: "Instagram DM",
    facebook_messenger: "Facebook Messenger",
    gbp_chat: "Google Business Profile chat",
    discuss: "Discuss together",
  };
  return v.map((k) => labels[k] ?? k).join(", ");
}

function prettifyAdditionalLawyers(
  v: Array<{
    name?: string;
    email?: string;
    role?: string;
    year_of_call?: number | string | null;
    province_of_call?: string | null;
  }> | null,
): string | null {
  if (!v || v.length === 0) return null;
  const lines = v
    .filter((l) => (l.name && l.name.trim()) || (l.email && l.email.trim()))
    .map((l) => {
      const head = `${l.name?.trim() ?? "(no name)"} — ${l.email?.trim() ?? "(no email)"}`;
      const tail: string[] = [];
      if (l.role && l.role.trim()) tail.push(l.role.trim());
      if (l.year_of_call !== undefined && l.year_of_call !== null && String(l.year_of_call).trim() !== "") {
        tail.push(`called ${l.year_of_call}`);
      }
      if (l.province_of_call && l.province_of_call.trim()) {
        tail.push(l.province_of_call.trim());
      }
      return tail.length > 0 ? `${head} (${tail.join(", ")})` : head;
    });
  return lines.length > 0 ? lines.join("\n") : null;
}

function prettifyYearProvince(
  year: number | string | null,
  province: string | null,
): string | null {
  const parts: string[] = [];
  if (year !== null && year !== undefined && String(year).trim() !== "") {
    parts.push(`Called ${year}`);
  }
  if (province && province.trim()) parts.push(province.trim());
  return parts.length > 0 ? parts.join(", ") : null;
}

function prettifyPracticeAreas(v: string[] | null): string | null {
  if (!v || v.length === 0) return null;
  const labels: Record<string, string> = {
    family: "Family Law",
    civil_litigation: "Civil Litigation",
    real_estate: "Real Estate Law",
    corporate: "Corporate & Commercial",
    wills_estates: "Wills & Estates",
    employment: "Employment Law",
    immigration: "Immigration & Refugee",
    personal_injury: "Personal Injury",
    criminal: "Criminal Defence",
    landlord_tenant: "Landlord & Tenant",
    tax: "Tax Law",
    insurance: "Insurance Law",
    construction: "Construction Law",
    intellectual_property: "Intellectual Property",
    administrative: "Administrative & Regulatory",
  };
  return v.map((k) => labels[k] ?? k).join(", ");
}

function prettifyServiceArea(v: string | null, other: string | null): string | null {
  if (!v) return null;
  const labels: Record<string, string> = {
    toronto_core: "Toronto core (downtown + 416)",
    gta: "Greater Toronto Area",
    ontario_wide: "Ontario-wide",
    cross_border: "Cross-border (Ontario + other jurisdictions)",
    other: other?.trim() || "Other / multi-province",
  };
  return labels[v] ?? v;
}

function prettifyPMS(v: string | null, other: string | null): string | null {
  if (!v) return null;
  const labels: Record<string, string> = {
    clio: "Clio (fully integrated)",
    practice_panther: "PracticePanther",
    mycase: "MyCase",
    cosmolex: "CosmoLex",
    leap: "LEAP",
    pclaw: "PCLaw",
    soluno: "Soluno",
    other: other?.trim() || "Other",
    none: "None / spreadsheets / file folders",
  };
  return labels[v] ?? v;
}

function prettifyPMSIntegration(v: string | null): string | null {
  if (!v) return null;
  if (v === "yes") return "Yes, integrate at go-live";
  if (v === "not_now") return "Not now — run side-by-side and revisit";
  if (v === "discuss") return "Discuss scope together";
  return v;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}
