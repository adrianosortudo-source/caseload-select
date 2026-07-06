// Coverage report (WP-5, Ses.16 next-20% build plan). Read-only: no
// external APIs, no rank tracking. One table over content_pieces joined to
// their current EN version, linked deliverable, and latest validation run;
// a second block lists calendar slots with no piece yet. Follows this
// directory's existing convention (server component, supabaseAdmin,
// firm chosen via the sidebar switcher's ?firm_id= param, no redundant
// in-page firm picker per the 2026-06-26 audit fix already applied to the
// sibling list page).
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Firm = { id: string; name: string | null };

type Piece = {
  id: string;
  title_working: string;
  format: string;
  workflow_gate: string;
  status: string;
  source_brief: Record<string, unknown> | null;
  deliverable_id: string | null;
  calendar_slot_id: string | null;
  language_mode: string;
};

type Version = {
  piece_id: string;
  seo_metadata: Record<string, unknown> | null;
};

type PtVersion = { piece_id: string };

type Deliverable = { id: string; status: string };

type ValidationRun = {
  piece_id: string;
  created_at: string;
  result: { validators?: Array<{ key: string; status: string }> } | null;
};

type Slot = {
  id: string;
  publish_date: string;
  theme: string;
  planned_format: string;
  status: string;
};

const statusTone: Record<string, string> = {
  draft: "bg-black/5 text-black/70",
  in_review: "bg-sky-50 text-sky-700",
  changes_requested: "bg-rose-50 text-rose-700",
  approved: "bg-emerald-50 text-emerald-700",
  archived: "bg-black/5 text-black/50",
};

const gateLabels: Record<string, string> = {
  discovery: "Discovery",
  position: "Position",
  draft: "Draft",
  legal_gate: "Legal gate",
  authoring: "EN/PT authoring",
  production: "Production",
};

function humanize(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function Badge({ value, tone }: { value: string; tone?: string }) {
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded text-xs font-medium ${tone ?? "bg-black/5 text-black/60"}`}
    >
      {humanize(value)}
    </span>
  );
}

function verdictTone(verdict: string | null): string {
  if (verdict === "pass") return "bg-emerald-50 text-emerald-700";
  if (verdict === "warn") return "bg-amber-50 text-amber-700";
  if (verdict === "fail") return "bg-rose-50 text-rose-700";
  return "bg-black/5 text-black/50";
}

export default async function ContentStudioCoveragePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const firmId = typeof sp.firm_id === "string" ? sp.firm_id : null;

  const { data: firmsData } = await supabase.from("intake_firms").select("id,name").order("name");
  const firms = (firmsData ?? []) as Firm[];
  const selected = firmId
    ? (firms.find((f) => f.id === firmId) ?? null)
    : firms.length === 1
      ? firms[0]
      : null;

  if (!selected) {
    return (
      <div>
        <PageHeader
          title="Content Studio Coverage"
          subtitle="Select a firm to see published-page coverage against its editorial calendar."
        />
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {firms.map((firm) => (
            <Link
              key={firm.id}
              href={`/admin/content-studio/coverage?firm_id=${firm.id}`}
              className="rounded border border-black/8 bg-white p-6 hover:border-sky-300 hover:bg-sky-50/30 transition-colors"
            >
              <div className="font-medium text-sm text-black/80">{firm.name ?? "Unnamed firm"}</div>
            </Link>
          ))}
          {firms.length === 0 && (
            <div className="col-span-full p-8 text-center text-sm text-black/40">
              No firms configured.
            </div>
          )}
        </div>
      </div>
    );
  }

  const [piecesRes, slotsRes] = await Promise.all([
    supabase
      .from("content_pieces")
      .select(
        "id,title_working,format,workflow_gate,status,source_brief,deliverable_id,calendar_slot_id,language_mode"
      )
      .eq("firm_id", selected.id)
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
    supabase
      .from("content_calendar_slots")
      .select("id,publish_date,theme,planned_format,status")
      .eq("firm_id", selected.id)
      .order("publish_date", { ascending: true }),
  ]);

  const pieces = (piecesRes.data ?? []) as Piece[];
  const slots = (slotsRes.data ?? []) as Slot[];
  const pieceIds = pieces.map((p) => p.id);
  const deliverableIds = pieces.map((p) => p.deliverable_id).filter((id): id is string => !!id);

  const bilingualPieceIds = pieces.filter((p) => p.language_mode === "bilingual").map((p) => p.id);

  const [versionsRes, ptVersionsRes, deliverablesRes, validationRunsRes] = await Promise.all([
    pieceIds.length > 0
      ? supabase
          .from("content_piece_versions")
          .select("piece_id,seo_metadata")
          .in("piece_id", pieceIds)
          .eq("language", "en")
          .eq("is_current", true)
      : Promise.resolve({ data: [] }),
    bilingualPieceIds.length > 0
      ? supabase
          .from("content_piece_versions")
          .select("piece_id")
          .in("piece_id", bilingualPieceIds)
          .eq("language", "pt")
          .eq("is_current", true)
      : Promise.resolve({ data: [] }),
    deliverableIds.length > 0
      ? supabase.from("content_deliverables").select("id,status").in("id", deliverableIds)
      : Promise.resolve({ data: [] }),
    pieceIds.length > 0
      ? supabase
          .from("content_ai_runs")
          .select("piece_id,created_at,result")
          .in("piece_id", pieceIds)
          .eq("run_type", "validate_deterministic")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const versionByPiece = new Map((versionsRes.data as Version[]).map((v) => [v.piece_id, v]));
  const piecesWithCurrentPt = new Set((ptVersionsRes.data as PtVersion[]).map((v) => v.piece_id));
  const deliverableById = new Map((deliverablesRes.data as Deliverable[]).map((d) => [d.id, d]));
  // Latest run per piece: rows are ordered created_at desc, first occurrence wins.
  const latestRunByPiece = new Map<string, ValidationRun>();
  for (const run of (validationRunsRes.data as ValidationRun[]) ?? []) {
    if (!latestRunByPiece.has(run.piece_id)) latestRunByPiece.set(run.piece_id, run);
  }

  const briefedSlotIds = new Set(pieces.map((p) => p.calendar_slot_id).filter(Boolean));
  const unbriefed = slots.filter((s) => !briefedSlotIds.has(s.id));

  const publishedCount = pieces.filter((p) => p.status === "published").length;

  return (
    <div>
      <PageHeader title="Content Studio Coverage" subtitle={selected.name ?? "Unknown firm"} />

      <div className="mt-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">Pieces</div>
            <div className="mt-2 text-2xl font-semibold">{pieces.length}</div>
          </div>
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">Published</div>
            <div className="mt-2 text-2xl font-semibold">{publishedCount}</div>
          </div>
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">Calendar slots</div>
            <div className="mt-2 text-2xl font-semibold">{slots.length}</div>
          </div>
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">Unbriefed slots</div>
            <div className="mt-2 text-2xl font-semibold">{unbriefed.length}</div>
          </div>
        </div>

        <div className="rounded border border-black/8 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-black/10">
            <div className="text-sm font-medium">Piece Coverage</div>
            <div className="text-xs text-black/50 mt-1">
              What exists, what query it answers, and how far it has moved.
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-black/50 border-b border-black/10 bg-black/[0.02]">
                <tr>
                  <th className="text-left px-4 py-3">Title</th>
                  <th className="text-left">Format</th>
                  <th className="text-left">Primary query</th>
                  <th className="text-left">Gate</th>
                  <th className="text-left">Deliverable</th>
                  <th className="text-left">PT</th>
                  <th className="text-left">Cannibalization</th>
                  <th className="text-left">Published URL</th>
                  <th className="text-right px-4">Last validation</th>
                </tr>
              </thead>
              <tbody>
                {pieces.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-black/40">
                      No content pieces yet for {selected.name}.
                    </td>
                  </tr>
                )}
                {pieces.map((piece) => {
                  const version = versionByPiece.get(piece.id);
                  const seo = version?.seo_metadata ?? null;
                  const brief = piece.source_brief ?? {};
                  const primaryQuery =
                    (seo?.primary_query as string | undefined) ??
                    (brief.primary_query as string | undefined) ??
                    null;
                  const publishRecord = seo?.publish_record as
                    | { url?: string; at?: string }
                    | undefined;
                  const deliverable = piece.deliverable_id
                    ? deliverableById.get(piece.deliverable_id)
                    : null;
                  const run = latestRunByPiece.get(piece.id);
                  const validators = run?.result?.validators ?? [];
                  const verdict =
                    validators.length === 0
                      ? null
                      : validators.some((v) => v.status === "fail")
                        ? "fail"
                        : validators.some((v) => v.status === "warn")
                          ? "warn"
                          : "pass";
                  const isBilingual = piece.language_mode === "bilingual";
                  const hasCurrentPt = piecesWithCurrentPt.has(piece.id);
                  const cannibalization = validators.find((v) => v.key === "no_cannibalization");

                  return (
                    <tr key={piece.id} className="border-b border-black/5">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/content-studio/${piece.id}`}
                          className="text-sky-600 hover:underline font-medium"
                        >
                          {piece.title_working}
                        </Link>
                      </td>
                      <td className="text-black/60 whitespace-nowrap">{humanize(piece.format)}</td>
                      <td className="text-black/60 max-w-xs">
                        {primaryQuery ?? <span className="text-black/30">Not set</span>}
                      </td>
                      <td className="text-black/60 whitespace-nowrap">
                        {gateLabels[piece.workflow_gate] ?? humanize(piece.workflow_gate)}
                      </td>
                      <td>
                        {deliverable ? (
                          <Badge value={deliverable.status} tone={statusTone[deliverable.status]} />
                        ) : (
                          <span className="text-black/30 text-xs">None</span>
                        )}
                      </td>
                      <td>
                        {!isBilingual ? (
                          <span className="text-black/30 text-xs">EN only</span>
                        ) : hasCurrentPt ? (
                          <span className="inline-block px-2.5 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                            Exists
                          </span>
                        ) : (
                          <span className="inline-block px-2.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                            Missing
                          </span>
                        )}
                      </td>
                      <td>
                        {!cannibalization ? (
                          <span className="text-black/30 text-xs">Not checked</span>
                        ) : cannibalization.status === "warn" ? (
                          <span className="inline-block px-2.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                            Overlap flagged
                          </span>
                        ) : (
                          <span className="inline-block px-2.5 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                            Clear
                          </span>
                        )}
                      </td>
                      <td>
                        {publishRecord?.url ? (
                          <a
                            href={publishRecord.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-600 hover:underline text-xs"
                          >
                            {formatDate(publishRecord.at?.slice(0, 10) ?? null)} →
                          </a>
                        ) : (
                          <span className="text-black/30 text-xs">Not published</span>
                        )}
                      </td>
                      <td className="px-4 text-right">
                        {verdict ? (
                          <Badge value={verdict} tone={verdictTone(verdict)} />
                        ) : (
                          <span className="text-black/30 text-xs">Never run</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded border border-black/8 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-black/10">
            <div className="text-sm font-medium">Unbriefed Calendar Slots</div>
            <div className="text-xs text-black/50 mt-1">
              Planned slots with no content piece created yet.
            </div>
          </div>
          <div className="divide-y divide-black/5">
            {unbriefed.length === 0 && (
              <div className="p-6 text-sm text-black/40">
                Every calendar slot for {selected.name} has a piece.
              </div>
            )}
            {unbriefed.map((slot) => (
              <div key={slot.id} className="p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-sm">{slot.theme}</div>
                  <div className="text-xs text-black/50 mt-1">
                    {humanize(slot.planned_format)} · {formatDate(slot.publish_date)}
                  </div>
                </div>
                <Badge value={slot.status} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
