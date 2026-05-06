/**
 * /portal/[firmId]/files
 *
 * Operator <-> firm file exchange. Server-renders the list; the upload
 * widget and per-row actions are client components.
 *
 * Filters:
 *   ?category=contract|report|onboarding|diagnostic|correspondence|other
 *   ?archived=1   include archived rows (mostly an operator concern)
 *
 * Auth verified by parent layout (operator OR matching firm session).
 */

import Link from "next/link";
import { listFirmFiles } from "@/lib/firm-files";
import {
  CATEGORY_LABELS,
  FILE_CATEGORIES,
  categoryLabel,
  formatBytes,
  isValidCategory,
  type FileCategory,
} from "@/lib/firm-files-pure";
import FileUploader from "@/components/portal/FileUploader";
import FileRowActions from "@/components/portal/FileRowActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CategoryFilter = "all" | FileCategory;

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ category?: string; archived?: string }>;
}) {
  const { firmId } = await params;
  const { category: categoryRaw, archived } = await searchParams;
  const includeArchived = archived === "1";
  const categoryFilter: CategoryFilter =
    categoryRaw && isValidCategory(categoryRaw) ? (categoryRaw as FileCategory) : "all";

  const files = await listFirmFiles(firmId, {
    includeArchived,
    category: categoryFilter === "all" ? undefined : categoryFilter,
  });

  return (
    <div className="space-y-5">
      <Header count={files.length} includeArchived={includeArchived} />

      <FilterRow
        firmId={firmId}
        active={categoryFilter}
        includeArchived={includeArchived}
      />

      <FileUploader firmId={firmId} />

      {files.length === 0 ? (
        <EmptyState filtered={categoryFilter !== "all" || includeArchived} />
      ) : (
        <div className="bg-white border border-black/10 overflow-hidden">
          <ul>
            {files.map((f) => (
              <li
                key={f.id}
                className={`px-4 sm:px-5 py-3 border-b border-black/5 last:border-0 ${
                  f.archived ? "opacity-60" : ""
                }`}
              >
                <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                  <CategoryBadge category={f.category as FileCategory} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-navy break-all">
                        {f.display_name}
                      </span>
                      <UploaderTag role={f.uploaded_by_role} />
                    </div>
                    {f.description && (
                      <p className="mt-1 text-xs text-black/60 break-words">
                        {f.description}
                      </p>
                    )}
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-black/40 uppercase tracking-wider">
                      <span>{formatBytes(f.size_bytes)}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDate(f.created_at)}</span>
                      {f.archived && f.archived_at && (
                        <>
                          <span aria-hidden>·</span>
                          <span>archived {formatDate(f.archived_at)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <FileRowActions firmId={firmId} fileId={f.id} archived={f.archived} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-black/40">
        Files are stored privately on Supabase, served via 60-second signed
        URLs, and audit-logged on every upload, download, and archive.
      </p>
    </div>
  );
}

function Header({ count, includeArchived }: { count: number; includeArchived: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">File exchange</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Files</h1>
      </div>
      <div className="text-xs text-black/50 uppercase tracking-wider">
        {count === 0
          ? includeArchived
            ? "No files in scope"
            : "No active files"
          : `${count} file${count === 1 ? "" : "s"} ${includeArchived ? "in scope" : "active"}`}
      </div>
    </div>
  );
}

function FilterRow({
  firmId,
  active,
  includeArchived,
}: {
  firmId: string;
  active: CategoryFilter;
  includeArchived: boolean;
}) {
  function href(c: CategoryFilter, archivedFlag: boolean): string {
    const params = new URLSearchParams();
    if (c !== "all") params.set("category", c);
    if (archivedFlag) params.set("archived", "1");
    const qs = params.toString();
    return qs ? `/portal/${firmId}/files?${qs}` : `/portal/${firmId}/files`;
  }

  const tabs: Array<{ key: CategoryFilter; label: string }> = [
    { key: "all", label: "All" },
    ...FILE_CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c] })),
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 flex-wrap">
        {tabs.map((t) => {
          const isActive = active === t.key;
          return (
            <Link
              key={t.key}
              href={href(t.key, includeArchived)}
              className={`
                inline-flex items-center px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors
                ${isActive
                  ? "border-navy bg-navy text-white"
                  : "border-black/15 bg-white text-black/70 hover:border-navy hover:text-navy"
                }
              `}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <Link
        href={href(active, !includeArchived)}
        className={`
          inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors
          ${includeArchived
            ? "border-navy bg-navy text-white"
            : "border-black/15 bg-white text-black/70 hover:border-navy hover:text-navy"
          }
        `}
      >
        <span>Show archived</span>
      </Link>
    </div>
  );
}

function CategoryBadge({ category }: { category: FileCategory }) {
  // Subtle colour cue per category. Contracts get the warmer treatment because
  // signing windows tend to be the most time-sensitive.
  const colour =
    category === "contract" ? "bg-amber-50 text-amber-900 border-amber-300"
    : category === "report" ? "bg-emerald-50 text-emerald-900 border-emerald-300"
    : category === "onboarding" ? "bg-sky-50 text-sky-900 border-sky-300"
    : category === "diagnostic" ? "bg-violet-50 text-violet-900 border-violet-300"
    : category === "correspondence" ? "bg-stone-100 text-stone-700 border-stone-300"
                                    : "bg-stone-50 text-stone-500 border-stone-200";
  return (
    <span
      className={`inline-flex items-center justify-center font-mono font-bold text-[10px] uppercase tracking-wider px-2 py-1 border w-fit ${colour}`}
    >
      {categoryLabel(category)}
    </span>
  );
}

function UploaderTag({ role }: { role: "operator" | "lawyer" }) {
  const label = role === "operator" ? "From operator" : "From firm";
  const colour = role === "operator"
    ? "bg-navy/5 text-navy border-navy/15"
    : "bg-gold/15 text-navy border-gold/40";
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border ${colour}`}>
      {label}
    </span>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="bg-white border border-black/8 px-6 py-10 text-center">
      <p className="text-sm text-black/60">
        {filtered
          ? "No files match these filters."
          : "No files yet. Upload contracts, reports, or onboarding documents above."}
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
