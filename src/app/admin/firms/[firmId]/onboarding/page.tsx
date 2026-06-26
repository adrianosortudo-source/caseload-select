/**
 * /admin/firms/[firmId]/onboarding
 *
 * Firm-scoped onboarding view. Shows THIS firm's onboarding submissions
 * (registration + firm profile) matched by legal_name, with notification
 * delivery state and a link to the full global detail page. The global
 * intake desk (link generation + cross-firm list) stays at
 * /admin/onboarding-submissions.
 *
 * firm_onboarding_intake has no firm_id FK, so the match is on
 * legal_name ilike the firm's name. Auth enforced by /admin/layout.tsx.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

interface SubmissionRow {
  id: string;
  submission_token: string;
  form_type: string;
  legal_name: string | null;
  authorized_rep_name: string | null;
  authorized_rep_email: string | null;
  whatsapp_number_decision: string | null;
  has_meta_business_manager: boolean | null;
  will_add_operator_as_admin: boolean | null;
  verification_doc_storage_path: string | null;
  verification_doc_original_name: string | null;
  submitted_at: string;
  notification_sent_at: string | null;
  notification_error: string | null;
  notification_attempts: number | null;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FirmOnboardingPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const session = await getOperatorSession();
  if (!session) redirect("/portal/login?error=missing");

  const { firmId } = await params;

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("id, name")
    .eq("id", firmId)
    .maybeSingle();

  const firmName = (firm?.name as string | null) ?? "(unknown firm)";

  const { data: rows, error } = await supabase
    .from("firm_onboarding_intake")
    .select(`
      id, submission_token, form_type, legal_name, authorized_rep_name, authorized_rep_email,
      whatsapp_number_decision, has_meta_business_manager,
      will_add_operator_as_admin,
      verification_doc_storage_path, verification_doc_original_name,
      submitted_at,
      notification_sent_at, notification_error, notification_attempts
    `)
    .ilike("legal_name", firmName)
    .order("submitted_at", { ascending: false })
    .returns<SubmissionRow[]>();

  const items = rows ?? [];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Onboarding</h1>
        <p className="mt-1 text-sm text-black/60">
          {firmName}: registration and firm-profile submissions for this firm.
        </p>
      </div>

      <div className="bg-white border border-border-brand p-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-black/55">
          Need to send a new onboarding link, or review every firm? Use the global intake desk.
        </p>
        <Link
          href="/admin/onboarding-submissions"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold px-3 py-1.5 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors"
        >
          Onboarding desk <span aria-hidden>&#8599;</span>
        </Link>
      </div>

      {error ? (
        <div className="bg-white border border-red-fail/40 px-6 py-6">
          <p className="text-sm text-red-fail">{error.message}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-border-brand px-6 py-10 text-center">
          <p className="text-sm text-black/60">
            No onboarding submission on file for {firmName} yet. Send the registration link from the
            onboarding desk; submissions matched to this firm name will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((row) => (
            <Link
              key={row.id}
              href={`/admin/onboarding-submissions/${row.id}`}
              className="block bg-white border border-border-brand p-4 hover:border-navy transition-colors"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-navy">
                      {row.form_type === "profile" ? "Firm profile" : "Registration and integrations"}
                    </span>
                    <NotificationBadge
                      sentAt={row.notification_sent_at}
                      error={row.notification_error}
                      attempts={row.notification_attempts ?? 0}
                    />
                  </div>
                  <div className="mt-1 text-xs text-black/60">
                    {row.authorized_rep_name ?? "Rep not provided"}
                    {row.authorized_rep_email ? (
                      <span className="text-black/40"> · {row.authorized_rep_email}</span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <Tag label={`Token ${row.submission_token}`} />
                    {row.whatsapp_number_decision === "provision_new_ghl_number" ? (
                      <Tag label="New GHL number" tone="pass" />
                    ) : row.whatsapp_number_decision === "different_carrier_line" ? (
                      <Tag label="Different number" tone="warn" />
                    ) : null}
                    <BoolTag label="Meta MBM" value={row.has_meta_business_manager} />
                    <BoolTag label="Operator admin" value={row.will_add_operator_as_admin} />
                    {row.verification_doc_storage_path ? (
                      <Tag
                        label="Verification doc attached"
                        tone="pass"
                        title={row.verification_doc_original_name ?? "uploaded"}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-black/40">Submitted</div>
                  <div className="text-xs text-black/70 tabular-nums whitespace-nowrap mt-0.5">
                    {formatTime(row.submitted_at)}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="text-xs text-black/40">
        Submissions are matched to this firm by legal name. Open a card for every field and the verification doc.
      </p>
    </div>
  );
}

function Tag({ label, tone, title }: { label: string; tone?: "pass" | "warn"; title?: string }) {
  const classes =
    tone === "pass"
      ? "bg-green-pass/10 text-green-pass border-green-pass/30"
      : tone === "warn"
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : "bg-parchment-2 text-black/70 border-border-brand";
  return (
    <span
      title={title}
      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border ${classes}`}
    >
      {label}
    </span>
  );
}

function BoolTag({ label, value }: { label: string; value: boolean | null }) {
  if (value === null) return null;
  return <Tag label={`${label}: ${value ? "Yes" : "No"}`} tone={value ? "pass" : "warn"} />;
}

function NotificationBadge({
  sentAt,
  error,
  attempts,
}: {
  sentAt: string | null;
  error: string | null;
  attempts: number;
}) {
  if (sentAt) {
    return (
      <span
        className="inline-flex items-center font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 border bg-green-pass/10 text-green-pass border-green-pass/30"
        title={`Sent ${sentAt}${attempts > 0 ? ` · ${attempts} attempt${attempts === 1 ? "" : "s"}` : ""}`}
      >
        Notified
      </span>
    );
  }
  if (error) {
    return (
      <span
        className="inline-flex items-center font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 border bg-red-fail/10 text-red-fail border-red-fail/30"
        title={`Last error: ${error} · ${attempts} attempt${attempts === 1 ? "" : "s"}`}
      >
        Notify failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 border bg-parchment-2 text-muted border-border-brand">
      Notify pending
    </span>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "Not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not recorded";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
