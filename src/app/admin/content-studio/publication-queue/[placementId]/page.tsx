/**
 * Publication Operator, Workstream 5: placement detail / dry preflight.
 *
 * Runs the full read-only pipeline for one placement: the immutable
 * PublicationExecutionManifest (publication-execution-manifest.ts), the
 * 7-way preflight status (publication-preflight-status.ts), the
 * destination's configuration check and redacted dry-run action
 * (publication-adapter.ts), and the placement's claim/receipt history
 * (publication-placement-claims.ts / publication-receipts.ts) for
 * reconciliation visibility. Nothing on this page writes anything --
 * "Run dry preflight" IS this page load; there is no further action to
 * take here. Auth is enforced by /admin/layout.tsx.
 */
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { loadPublicationExecutionManifest } from "@/lib/publication-execution-manifest-loader";
import { getPublicationAdapter } from "@/lib/publication-adapter";
import { getLatestClaimForPlacement } from "@/lib/publication-placement-claims";
import { listReceiptsForPlacement } from "@/lib/publication-receipts";
import type { PreflightStatusCategory } from "@/lib/publication-preflight-status";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<PreflightStatusCategory, string> = {
  ready: "Ready",
  blocked_content: "Blocked — content",
  blocked_missing_configuration: "Blocked — missing configuration",
  blocked_authorization: "Blocked — authorization",
  blocked_destination_validation: "Blocked — destination format",
  already_published: "Already published",
  ambiguous_external_state: "Needs reconciliation",
};
const CATEGORY_TONE: Record<PreflightStatusCategory, string> = {
  ready: "bg-emerald-50 text-emerald-700",
  blocked_content: "bg-rose-50 text-rose-700",
  blocked_missing_configuration: "bg-amber-50 text-amber-700",
  blocked_authorization: "bg-amber-50 text-amber-700",
  blocked_destination_validation: "bg-rose-50 text-rose-700",
  already_published: "bg-sky-50 text-sky-700",
  ambiguous_external_state: "bg-amber-50 text-amber-700",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-black/8 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-black/10 text-sm font-medium">{title}</div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-black/40">{label}</div>
      <div className="mt-1 text-sm text-black/80 break-words">{value}</div>
    </div>
  );
}

export default async function PublicationPlacementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ placementId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { placementId } = await params;
  const sp = await searchParams;
  const firmId = typeof sp.firm_id === "string" ? sp.firm_id : null;

  if (!firmId) {
    return (
      <div className="p-8 text-sm text-black/50">
        Missing firm_id. Return to the{" "}
        <Link className="text-sky-600 hover:underline" href="/admin/content-studio/publication-queue">
          Publication Queue
        </Link>
        .
      </div>
    );
  }

  // Firm-scoping check first, in isolation: getLatestClaimForPlacement and
  // listReceiptsForPlacement are keyed only by placementId (no firm filter
  // of their own), so they must never be called until the manifest load
  // above has confirmed this placement actually belongs to firmId. Fetching
  // another firm's claim/receipt rows before that check -- even if the
  // result were then discarded and never rendered -- is exactly the kind of
  // defense-in-depth gap a later refactor could turn into a real leak.
  const result = await loadPublicationExecutionManifest(firmId, placementId, {
    role: "operator",
    id: null,
    name: "Operator",
  });

  if (!result.ok) {
    return (
      <div>
        <PageHeader title="Publication Placement" subtitle="Dry preflight" />
        <div className="mt-6 rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {result.error}
        </div>
      </div>
    );
  }

  const { manifest } = result;
  const [latestClaim, receipts] = await Promise.all([
    getLatestClaimForPlacement(placementId),
    listReceiptsForPlacement(placementId),
  ]);
  const adapter = getPublicationAdapter(manifest.destination);
  const preflightStatus = adapter.preflight(manifest);
  const configuration = adapter.validateConfiguration(manifest);
  const dryRun = adapter.renderDryRun(manifest);

  return (
    <div>
      <PageHeader title={manifest.title ?? "Untitled deliverable"} subtitle={`${manifest.destination} · ${manifest.locale ?? "no locale"}`} />
      <div className="mt-2 flex items-center gap-4">
        <Link
          href={`/admin/content-studio/publication-queue?firm_id=${firmId}&period_id=${manifest.contentPeriodId ?? ""}`}
          className="text-xs text-sky-600 hover:underline"
        >
          ← Back to queue
        </Link>
        <span
          className={`inline-block px-2.5 py-0.5 rounded text-xs font-medium ${CATEGORY_TONE[preflightStatus.category]}`}
        >
          {CATEGORY_LABEL[preflightStatus.category]}
        </span>
      </div>

      <div className="mt-6 space-y-6">
        {preflightStatus.reasons.length > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 p-4">
            <div className="text-xs font-medium text-amber-800 mb-2">Blocked reasons</div>
            <ul className="text-sm text-amber-800 list-disc list-inside space-y-1">
              {preflightStatus.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {preflightStatus.destinationIssues.length > 0 && (
          <div className="rounded border border-black/8 bg-white p-4">
            <div className="text-xs font-medium text-black/60 mb-2">Destination format checks</div>
            <ul className="text-sm space-y-1">
              {preflightStatus.destinationIssues.map((issue, i) => (
                <li key={i} className={issue.severity === "block" ? "text-rose-700" : "text-amber-700"}>
                  [{issue.severity}] {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Section title="Approved-version preview">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Title" value={manifest.title ?? "—"} />
            <Field label="Excerpt" value={manifest.excerpt ?? "—"} />
            <Field label="Approved version" value={manifest.approvedVersionId ?? "—"} />
            <Field label="Version body hash (sha256)" value={<code className="text-xs">{manifest.versionBodyHash ?? "—"}</code>} />
          </div>
          {manifest.body && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-black/40 mb-2">Body (as approved, verbatim)</div>
              <div
                className="prose prose-sm max-w-none border border-black/8 rounded p-4 max-h-80 overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: manifest.body }}
              />
            </div>
          )}
        </Section>

        <Section title="Destination and authorization">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Destination" value={manifest.destination} />
            <Field
              label="Account / location / site"
              value={configuration.configured ? manifest.destinationAccount.identifier : `Not configured — ${manifest.destinationAccount.note}`}
            />
            <Field label="Locale" value={manifest.locale ?? "—"} />
            <Field
              label="Release authorization path"
              value={
                manifest.releaseAuthorizationPath === "individual_approval"
                  ? "Individually approved"
                  : manifest.releaseAuthorizationPath === "standing_authorization"
                    ? "Standing publishing authorization"
                    : "None available"
              }
            />
            <Field label="Canonical URL" value={manifest.canonicalUrl ?? "Not resolved"} />
            <Field
              label="Tracked URL"
              value={
                manifest.trackedUrl ? (
                  <a href={manifest.trackedUrl} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline break-all">
                    {manifest.trackedUrl}
                  </a>
                ) : (
                  "Not resolved"
                )
              }
            />
          </div>
        </Section>

        <Section title="Assets (ordered, hashed)">
          {manifest.assets.length === 0 ? (
            <div className="text-sm text-black/40">No assets registered for this version.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-black/50 border-b border-black/10">
                <tr>
                  <th className="text-left py-2">Type</th>
                  <th className="text-left">Storage path</th>
                  <th className="text-left">MIME</th>
                  <th className="text-left">Size</th>
                  <th className="text-left">SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {manifest.assets.map((a) => (
                  <tr key={a.artifactId} className="border-b border-black/5">
                    <td className="py-2">{a.artifactType}</td>
                    <td className="text-black/60 max-w-xs truncate" title={a.storagePath ?? undefined}>{a.storagePath ?? "—"}</td>
                    <td className="text-black/60">{a.mimeType ?? "—"}</td>
                    <td className="text-black/60">{a.sizeBytes ? `${(a.sizeBytes / 1024).toFixed(0)} KB` : "—"}</td>
                    <td className="text-black/60"><code className="text-xs">{a.sha256 ? `${a.sha256.slice(0, 12)}…` : "—"}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Dry-run destination preview">
          <div className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 mb-3">
            Illustrative only. No network call is made by this page or by generating this preview. Live execution is
            structurally disabled in this release.
          </div>
          <Field label="Method / endpoint" value={<code className="text-xs break-all">{dryRun.method} {dryRun.endpoint}</code>} />
          <div className="mt-3">
            <Field label="Summary" value={dryRun.summary} />
          </div>
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wider text-black/40 mb-2">Payload preview (redacted)</div>
            <pre className="text-xs bg-black/[0.03] rounded p-3 overflow-x-auto">
              {JSON.stringify(dryRun.payloadPreview, null, 2)}
            </pre>
          </div>
          <div className="mt-3 text-xs text-black/50">
            Requires manual action: {dryRun.requiresManualAction ? "Yes" : "No"}
          </div>
        </Section>

        <Section title="Claim and receipt history">
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wider text-black/40 mb-2">Latest claim</div>
            {latestClaim ? (
              <div className="text-sm">
                <span className="font-medium">{latestClaim.status}</span>{" "}
                <span className="text-black/50">
                  via {latestClaim.release_path}, claimed by {latestClaim.claimed_by_name ?? latestClaim.claimed_by_role} at{" "}
                  {latestClaim.claimed_at}
                </span>
              </div>
            ) : (
              <div className="text-sm text-black/40">No claim has ever been made for this placement.</div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-black/40 mb-2">Receipts ({receipts.length})</div>
            {receipts.length === 0 ? (
              <div className="text-sm text-black/40">No publication receipts recorded for this placement.</div>
            ) : (
              <ul className="space-y-2">
                {receipts.map((r) => (
                  <li key={r.id} className="text-sm border border-black/8 rounded p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.verification_state}</span>
                      <span className="text-xs text-black/40">{r.published_at}</span>
                    </div>
                    <div className="text-xs text-black/50 mt-1">
                      {r.public_url ?? r.external_post_id ?? "no URL/post id recorded"}
                      {r.reconciles_receipt_id && <span> · reconciles {r.reconciles_receipt_id.slice(0, 8)}…</span>}
                    </div>
                    {r.failure_reason && <div className="text-xs text-rose-600 mt-1">{r.failure_reason}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <Section title="Execution manifest (raw)">
          <div className="text-xs text-black/50 mb-2">
            Idempotency key: <code>{manifest.idempotencyKey}</code> · Generated {manifest.generatedAt}
          </div>
          <pre className="text-xs bg-black/[0.03] rounded p-3 overflow-x-auto max-h-96 overflow-y-auto">
            {JSON.stringify(manifest, null, 2)}
          </pre>
        </Section>
      </div>
    </div>
  );
}
