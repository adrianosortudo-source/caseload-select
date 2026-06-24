import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Firm = {
  id: string;
  name: string | null;
};

type Strategy = {
  id: string;
  firm_id: string;
  name: string;
  version: number;
  status: string;
  bilingual_enabled: boolean;
  jurisdiction: string;
};

type CalendarSlot = {
  id: string;
  firm_id: string;
  publish_date: string;
  week_of: string;
  cadence_kind: string;
  planned_format: string;
  territory: string | null;
  theme: string;
  status: string;
};

type ContentPiece = {
  id: string;
  firm_id: string;
  calendar_slot_id: string | null;
  title_working: string;
  format: string;
  language_mode: string;
  workflow_gate: string;
  status: string;
  review_date: string | null;
};

type StudioData = {
  firms: Firm[];
  strategies: Strategy[];
  slots: CalendarSlot[];
  pieces: ContentPiece[];
  error: string | null;
};

const gateLabels: Record<string, string> = {
  discovery: "Discovery",
  position: "Position",
  draft: "Draft",
  legal_gate: "Legal gate",
  authoring: "EN/PT authoring",
  production: "Production",
};

const statusTone: Record<string, string> = {
  planned: "bg-black/5 text-black/70",
  briefed: "bg-sky-50 text-sky-700",
  drafting: "bg-amber-50 text-amber-700",
  legal_review: "bg-violet-50 text-violet-700",
  production: "bg-indigo-50 text-indigo-700",
  shipped: "bg-emerald-50 text-emerald-700",
  skipped: "bg-black/5 text-black/50",
  draft: "bg-black/5 text-black/70",
  in_review: "bg-violet-50 text-violet-700",
  changes_requested: "bg-rose-50 text-rose-700",
  approved: "bg-emerald-50 text-emerald-700",
  published: "bg-emerald-50 text-emerald-700",
  archived: "bg-black/5 text-black/50",
  active: "bg-emerald-50 text-emerald-700",
};

function firmName(firms: Firm[], firmId: string) {
  const firm = firms.find((f) => f.id === firmId);
  return firm?.name ?? "Unknown firm";
}

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

async function getStudioData(): Promise<StudioData> {
  const [firmsRes, strategiesRes, slotsRes, piecesRes] = await Promise.all([
    supabase
      .from("intake_firms")
      .select("id,name")
      .order("created_at", { ascending: false }),
    supabase
      .from("firm_content_strategies")
      .select("id,firm_id,name,version,status,bilingual_enabled,jurisdiction")
      .eq("status", "active")
      .order("version", { ascending: false }),
    supabase
      .from("content_calendar_slots")
      .select(
        "id,firm_id,publish_date,week_of,cadence_kind,planned_format,territory,theme,status"
      )
      .order("publish_date", { ascending: true })
      .limit(16),
    supabase
      .from("content_pieces")
      .select(
        "id,firm_id,calendar_slot_id,title_working,format,language_mode,workflow_gate,status,review_date"
      )
      .order("created_at", { ascending: false })
      .limit(16),
  ]);

  const error =
    firmsRes.error?.message ??
    strategiesRes.error?.message ??
    slotsRes.error?.message ??
    piecesRes.error?.message ??
    null;

  return {
    firms: (firmsRes.data ?? []) as Firm[],
    strategies: (strategiesRes.data ?? []) as Strategy[],
    slots: (slotsRes.data ?? []) as CalendarSlot[],
    pieces: (piecesRes.data ?? []) as ContentPiece[],
    error,
  };
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded text-xs font-medium ${statusTone[value] ?? "bg-black/5 text-black/60"}`}
    >
      {humanize(value)}
    </span>
  );
}

export default async function ContentStudioPage() {
  const { firms, strategies, slots, pieces, error } = await getStudioData();
  const piecesBySlot = new Map(
    pieces.map((piece) => [piece.calendar_slot_id, piece])
  );
  const activePieces = pieces.filter((p) => p.status !== "archived");
  const legalGateCount = activePieces.filter(
    (p) => p.workflow_gate === "legal_gate"
  ).length;
  const productionCount = activePieces.filter(
    (p) => p.workflow_gate === "production"
  ).length;

  return (
    <div>
      <PageHeader
        title="Content Studio"
        subtitle="Editorial calendar, source briefs, legal gate, and channel production."
      />

      <div className="mt-6 space-y-6">
        {error && (
          <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}. Run{" "}
            <code className="text-xs">
              supabase/migrations/20260624_content_studio_foundation.sql
            </code>{" "}
            in Supabase SQL Editor.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">
              Active strategies
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {strategies.length}
            </div>
          </div>
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">
              Calendar slots
            </div>
            <div className="mt-2 text-2xl font-semibold">{slots.length}</div>
          </div>
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">
              Legal gate
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {legalGateCount}
            </div>
          </div>
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">
              Production
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {productionCount}
            </div>
          </div>
        </div>

        <div className="rounded border border-black/8 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-black/10">
            <div className="text-sm font-medium">Editorial Calendar</div>
            <div className="text-xs text-black/50 mt-1">
              Weekly themes mapped to territories and format commitments.
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-black/50 border-b border-black/10 bg-black/[0.02]">
              <tr>
                <th className="text-left px-4 py-3">Publish date</th>
                <th className="text-left">Firm</th>
                <th className="text-left">Cadence</th>
                <th className="text-left">Territory</th>
                <th className="text-left">Theme</th>
                <th className="text-left">Piece</th>
                <th className="text-right px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {slots.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-8 text-center text-black/40"
                  >
                    No calendar slots yet. Run the migration, then seed DRG
                    weekly themes.
                  </td>
                </tr>
              )}
              {slots.map((slot) => {
                const piece = piecesBySlot.get(slot.id);
                return (
                  <tr
                    key={slot.id}
                    className="border-b border-black/5"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDate(slot.publish_date)}
                    </td>
                    <td>{firmName(firms, slot.firm_id)}</td>
                    <td className="text-black/60">
                      {humanize(slot.cadence_kind)}
                    </td>
                    <td className="text-black/60">
                      {slot.territory ?? "Unassigned"}
                    </td>
                    <td className="max-w-xs">
                      <div className="font-medium">{slot.theme}</div>
                      <div className="text-xs text-black/50">
                        {humanize(slot.planned_format)}
                      </div>
                    </td>
                    <td className="text-black/60">
                      {piece ? (
                        <Link
                          href={`/admin/content-studio/${piece.id}`}
                          className="text-navy hover:underline"
                        >
                          {piece.title_working}
                        </Link>
                      ) : (
                        <span className="text-black/40">Not created</span>
                      )}
                    </td>
                    <td className="px-4 text-right">
                      <StatusBadge
                        value={piece?.status ?? slot.status}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded border border-black/8 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-black/10">
              <div className="text-sm font-medium">Workflow Queue</div>
              <div className="text-xs text-black/50 mt-1">
                Current pieces grouped by the six editorial gates.
              </div>
            </div>
            <div className="divide-y divide-black/5">
              {activePieces.length === 0 && (
                <div className="p-6 text-sm text-black/40">
                  No content pieces yet.
                </div>
              )}
              {activePieces.map((piece) => (
                <Link
                  key={piece.id}
                  href={`/admin/content-studio/${piece.id}`}
                  className="p-4 flex items-start justify-between gap-4 hover:bg-black/[0.02] transition-colors"
                >
                  <div>
                    <div className="font-medium text-sm">
                      {piece.title_working}
                    </div>
                    <div className="text-xs text-black/50 mt-1">
                      {firmName(firms, piece.firm_id)} /{" "}
                      {humanize(piece.format)} /{" "}
                      {piece.language_mode.toUpperCase()}
                    </div>
                    <div className="text-xs text-black/50 mt-1">
                      Review date: {formatDate(piece.review_date)}
                    </div>
                  </div>
                  <div className="text-right space-y-2">
                    <StatusBadge value={piece.status} />
                    <div className="text-xs text-black/50">
                      {gateLabels[piece.workflow_gate] ??
                        humanize(piece.workflow_gate)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded border border-black/8 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-black/10">
              <div className="text-sm font-medium">Firm Strategy Config</div>
              <div className="text-xs text-black/50 mt-1">
                Versioned context for prompts, validators, and gate decisions.
              </div>
            </div>
            <div className="divide-y divide-black/5">
              {strategies.length === 0 && (
                <div className="p-6 text-sm text-black/40">
                  No active strategies yet.
                </div>
              )}
              {strategies.map((strategy) => (
                <div
                  key={strategy.id}
                  className="p-4 flex items-start justify-between gap-4"
                >
                  <div>
                    <div className="font-medium text-sm">
                      {strategy.name}
                    </div>
                    <div className="text-xs text-black/50 mt-1">
                      {firmName(firms, strategy.firm_id)} / v
                      {strategy.version} / {strategy.jurisdiction}
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusBadge value={strategy.status} />
                    <div className="text-xs text-black/50 mt-2">
                      {strategy.bilingual_enabled
                        ? "Bilingual"
                        : "English only"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
