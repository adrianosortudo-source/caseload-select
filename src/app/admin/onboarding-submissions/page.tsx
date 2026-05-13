/**
 * /admin/onboarding-submissions
 *
 * Operator-facing list of submissions from the public firm-onboarding form
 * at /firm-onboarding/[token]. Newest first. Each row links to the detail
 * page where the operator can review every field and download the
 * verification document (if uploaded).
 *
 * Auth: getOperatorSession() in /admin/layout.tsx.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import Link from "next/link";

interface SubmissionRow {
  id: string;
  submission_token: string;
  legal_name: string | null;
  authorized_rep_name: string | null;
  authorized_rep_email: string | null;
  whatsapp_number_decision: string | null;
  has_meta_business_manager: boolean | null;
  will_add_operator_as_admin: boolean | null;
  consent_acknowledged: boolean;
  verification_doc_storage_path: string | null;
  verification_doc_original_name: string | null;
  submitted_at: string;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OnboardingSubmissionsListPage() {
  const { data: rows, error } = await supabase
    .from("firm_onboarding_intake")
    .select(`
      id, submission_token, legal_name, authorized_rep_name, authorized_rep_email,
      whatsapp_number_decision, has_meta_business_manager,
      will_add_operator_as_admin, consent_acknowledged,
      verification_doc_storage_path, verification_doc_original_name,
      submitted_at
    `)
    .order("submitted_at", { ascending: false })
    .limit(100)
    .returns<SubmissionRow[]>();

  if (error) return <ErrorState message={error.message} />;

  const items = rows ?? [];

  return (
    <div className="space-y-5">
      <Header total={items.length} />

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="bg-white border border-black/10 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-parchment-2 border-b border-black/10">
              <tr className="text-left text-black/50 uppercase tracking-wider">
                <th className="px-3 py-2 font-semibold">Firm</th>
                <th className="px-3 py-2 font-semibold">Rep</th>
                <th className="px-3 py-2 font-semibold">Token</th>
                <th className="px-3 py-2 font-semibold">WhatsApp</th>
                <th className="px-3 py-2 font-semibold">Meta MBM</th>
                <th className="px-3 py-2 font-semibold">Admin?</th>
                <th className="px-3 py-2 font-semibold">Doc</th>
                <th className="px-3 py-2 font-semibold">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-black/5 last:border-0 hover:bg-parchment/50"
                >
                  <td className="px-3 py-2 align-top">
                    <Link
                      href={`/admin/onboarding-submissions/${row.id}`}
                      className="font-semibold text-navy hover:underline"
                    >
                      {row.legal_name ?? "(no name)"}
                    </Link>
                  </td>
                  <td className="px-3 py-2 align-top text-black/70">
                    <div>{row.authorized_rep_name ?? "—"}</div>
                    {row.authorized_rep_email ? (
                      <div className="text-[10px] text-black/50 mt-0.5">{row.authorized_rep_email}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <code className="text-[10px] text-black/60">{row.submission_token}</code>
                  </td>
                  <td className="px-3 py-2 align-top text-black/70">
                    {row.whatsapp_number_decision === "provision_new_ghl_number" ? (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700">
                        New GHL #
                      </span>
                    ) : row.whatsapp_number_decision === "different_carrier_line" ? (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-700">
                        Different #
                      </span>
                    ) : (
                      <span className="text-black/30">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <BoolBadge value={row.has_meta_business_manager} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <BoolBadge value={row.will_add_operator_as_admin} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    {row.verification_doc_storage_path ? (
                      <span
                        className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700"
                        title={row.verification_doc_original_name ?? "uploaded"}
                      >
                        ✓ Attached
                      </span>
                    ) : (
                      <span className="text-black/30">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-black/60 tabular-nums whitespace-nowrap">
                    {formatTime(row.submitted_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-black/40">
        Showing {items.length} most recent. Click a firm name to see every field and download the verification doc.
      </p>
    </div>
  );
}

function Header({ total }: { total: number }) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Onboarding submissions</h1>
      </div>
      <div className="text-xs text-black/50 uppercase tracking-wider">
        {total} submission{total === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function BoolBadge({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-black/30">—</span>;
  return (
    <span
      className={`inline-flex items-center justify-center font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 border ${
        value
          ? "bg-emerald-100 text-emerald-900 border-emerald-300"
          : "bg-amber-50 text-amber-900 border-amber-300"
      }`}
    >
      {value ? "Yes" : "No"}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-black/8 px-6 py-10 text-center">
      <p className="text-sm text-black/60">
        No firm onboarding submissions yet. Send a token URL to a firm rep at <code>/firm-onboarding/[token]</code>.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-white border border-red-200 px-6 py-6">
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
