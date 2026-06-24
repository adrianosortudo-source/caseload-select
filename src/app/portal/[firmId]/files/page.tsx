/**
 * /portal/[firmId]/files
 *
 * Operator and firm deliverables hub. Server-renders the cards grouped by
 * workstream section (Brand / Strategy / Reports / Assets / Admin). The
 * uploader and per-card actions are client components.
 *
 *   ?archived=1   include archived items (mostly an operator concern)
 *
 * Auth verified by parent layout (operator OR matching firm session). Client
 * sessions are excluded at page level.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { listFirmFiles, type FirmFileRow } from "@/lib/firm-files";
import {
  FILE_SECTIONS,
  SECTION_LABELS,
  type FileSection,
} from "@/lib/firm-files-pure";
import FileUploader from "@/components/portal/FileUploader";
import DeliverableCard from "@/components/portal/DeliverableCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { firmId } = await params;
  const { archived } = await searchParams;

  // The layout admits client sessions (for the /m/[matterId] subtree);
  // this firm surface excludes them at page level.
  const session = await getPortalSession();
  if (session?.role === "client") {
    redirect("/portal/login");
  }

  const includeArchived = archived === "1";
  const files = await listFirmFiles(firmId, { includeArchived });

  const bySection = new Map<FileSection, FirmFileRow[]>();
  for (const s of FILE_SECTIONS) bySection.set(s, []);
  for (const f of files) {
    const s = (FILE_SECTIONS as ReadonlyArray<string>).includes(f.section)
      ? (f.section as FileSection)
      : "admin";
    bySection.get(s)!.push(f);
  }
  const populated = FILE_SECTIONS.filter((s) => (bySection.get(s)?.length ?? 0) > 0);

  return (
    <div className="space-y-6">
      <Header count={files.length} includeArchived={includeArchived} firmId={firmId} />

      <FileUploader firmId={firmId} />

      {files.length === 0 ? (
        <EmptyState includeArchived={includeArchived} />
      ) : (
        <div className="space-y-7">
          {populated.map((s) => {
            const items = bySection.get(s)!;
            return (
              <section key={s}>
                <div className="flex items-baseline gap-2 mb-3">
                  <h2 className="text-base font-bold text-navy">{SECTION_LABELS[s]}</h2>
                  <span className="text-xs text-black/40">{items.length}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {items.map((f) => (
                    <DeliverableCard
                      key={f.id}
                      firmId={firmId}
                      id={f.id}
                      kind={f.kind}
                      displayName={f.display_name}
                      description={f.description}
                      sizeBytes={f.size_bytes}
                      mimeType={f.mime_type}
                      externalUrl={f.external_url}
                      uploadedByRole={f.uploaded_by_role}
                      createdAt={f.created_at}
                      archived={f.archived}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-black/40">
        Files are stored privately on Supabase and served via 60-second signed
        URLs. Links open in a new tab. Every add, open, download, and archive is
        audit-logged.
      </p>
    </div>
  );
}

function Header({
  count,
  includeArchived,
  firmId,
}: {
  count: number;
  includeArchived: boolean;
  firmId: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-[color:var(--portal-accent)]">File exchange</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Files</h1>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-black/50 uppercase tracking-wider">
          {count === 0
            ? includeArchived
              ? "Nothing in scope"
              : "Nothing yet"
            : `${count} item${count === 1 ? "" : "s"} ${includeArchived ? "in scope" : "active"}`}
        </span>
        <Link
          href={includeArchived ? `/portal/${firmId}/files` : `/portal/${firmId}/files?archived=1`}
          className={`inline-flex items-center px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors ${
            includeArchived
              ? "border-navy bg-navy text-white"
              : "border-border-brand bg-white text-black/70 hover:border-navy hover:text-navy"
          }`}
        >
          Show archived
        </Link>
      </div>
    </div>
  );
}

function EmptyState({ includeArchived }: { includeArchived: boolean }) {
  return (
    <div className="bg-white border border-border-brand px-6 py-10 text-center">
      <p className="text-sm text-black/60">
        {includeArchived
          ? "No items match these filters."
          : "No files yet. Add a file or a link above to share it with the firm."}
      </p>
    </div>
  );
}
