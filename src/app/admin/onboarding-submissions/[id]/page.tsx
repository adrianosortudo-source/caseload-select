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
  linkedin_admin_status: string | null;
  linkedin_admin_blocker_note: string | null;
  m365_admin_status: string | null;
  m365_admin_blocker_note: string | null;
  intake_channels: string[] | null;
  signed_name: string | null;
  signed_email: string | null;
  consent_acknowledged: boolean;
  notes: string | null;
  booking_url: string | null;
  submitted_at: string;
  ip_address: string | null;
  user_agent: string | null;
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
          <h1 className="text-2xl font-bold text-navy mt-1">{row.legal_name ?? "(no name)"}</h1>
          <p className="text-xs text-black/50 mt-1">
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
          <Field label="Calendar booking URL" value={row.booking_url} link />
        </Fields>
      </Section>

      <Section title="2. SMS · A2P 10DLC">
        <Fields>
          <Field label="Vertical" value={row.sms_vertical} />
          <Field label="Sender phone preference" value={row.sms_sender_phone_preference} multiline />
        </Fields>
      </Section>

      <Section title="3. Intake channels + WhatsApp Business">
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

      <Section title="4. Meta Business Manager">
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

      <Section title="5. LinkedIn Company Page admin">
        <AccessStatusRow
          label="LinkedIn Super admin access"
          status={row.linkedin_admin_status}
          blockerNote={row.linkedin_admin_blocker_note}
        />
      </Section>

      <Section title="6. Microsoft 365 Exchange admin">
        <AccessStatusRow
          label="Exchange Admin (guest) access"
          status={row.m365_admin_status}
          blockerNote={row.m365_admin_blocker_note}
        />
      </Section>

      {row.notes ? (
        <Section title="7. Notes from the rep">
          <p className="text-sm text-black/80 whitespace-pre-wrap leading-relaxed">{row.notes}</p>
        </Section>
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
      ? { text: "Done — access granted", className: "bg-emerald-100 text-emerald-900 border-emerald-300" }
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
