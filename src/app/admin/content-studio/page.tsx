import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { CreatePieceButton } from "./components";

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

function StatusBadge({ value }: { value: string }) {
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded text-xs font-medium ${statusTone[value] ?? "bg-black/5 text-black/60"}`}
    >
      {humanize(value)}
    </span>
  );
}

export default async function ContentStudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const firmId = typeof sp.firm_id === "string" ? sp.firm_id : null;

  const { data: firmsData } = await supabase
    .from("intake_firms")
    .select("id,name")
    .order("name");
  const firms = (firmsData ?? []) as Firm[];

  const selected = firmId
    ? firms.find((f) => f.id === firmId) ?? null
    : firms.length === 1
      ? firms[0]
      : null;

  if (!selected) {
    return (
      <div>
        <PageHeader
          title="Content Studio"
          subtitle="Select a firm to view its editorial calendar and content pipeline."
        />
        <div className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {firms.map((firm) => (
              <Link
                key={firm.id}
                href={`/admin/content-studio?firm_id=${firm.id}`}
                className="rounded border border-black/8 bg-white p-6 hover:border-sky-300 hover:bg-sky-50/30 transition-colors"
              >
                <div className="font-medium text-sm text-black/80">
                  {firm.name ?? "Unnamed firm"}
                </div>
                <div className="text-xs text-black/40 mt-1">
                  Click to open content workspace
                </div>
              </Link>
            ))}
            {firms.length === 0 && (
              <div className="col-span-full p-8 text-center text-sm text-black/40">
                No firms configured. Add a firm via Portal Access first.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const [strategiesRes, slotsRes, piecesRes] = await Promise.all([
    supabase
      .from("firm_content_strategies")
      .select("id,firm_id,name,version,status,bilingual_enabled,jurisdiction")
      .eq("firm_id", selected.id)
      .eq("status", "active")
      .order("version", { ascending: false }),
    supabase
      .from("content_calendar_slots")
      .select(
        "id,firm_id,publish_date,week_of,cadence_kind,planned_format,territory,theme,status"
      )
      .eq("firm_id", selected.id)
      .order("publish_date", { ascending: true })
      .limit(16),
    supabase
      .from("content_pieces")
      .select(
        "id,firm_id,calendar_slot_id,title_working,format,language_mode,workflow_gate,status,review_date"
      )
      .eq("firm_id", selected.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const strategies = (strategiesRes.data ?? []) as Strategy[];
  const slots = (slotsRes.data ?? []) as CalendarSlot[];
  const pieces = (piecesRes.data ?? []) as ContentPiece[];
  const error =
    strategiesRes.error?.message ??
    slotsRes.error?.message ??
    piecesRes.error?.message ??
    null;

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
        subtitle={selected.name ?? "Unknown firm"}
        right={
          <Link
            href={`/admin/content-studio/coverage?firm_id=${selected.id}`}
            className="text-sm text-sky-600 hover:underline"
          >
            Coverage report →
          </Link>
        }
      />{/* Firm is chosen from the sidebar switcher; no redundant in-page picker. */}

      <div className="mt-6 space-y-6">
        {error && (
          <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
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
                    colSpan={6}
                    className="py-8 text-center text-black/40"
                  >
                    No calendar slots yet for {selected.name}.
                  </td>
                </tr>
              )}
              {slots.map((slot) => {
                const piece = piecesBySlot.get(slot.id);
                return (
                  <tr key={slot.id} className="border-b border-black/5">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDate(slot.publish_date)}
                    </td>
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
                          className="text-sky-600 hover:underline"
                        >
                          {piece.title_working}
                        </Link>
                      ) : (
                        <CreatePieceButton
                          firmId={selected.id}
                          slotId={slot.id}
                          theme={slot.theme}
                          format={slot.planned_format}
                        />
                      )}
                    </td>
                    <td className="px-4 text-right">
                      <StatusBadge value={piece?.status ?? slot.status} />
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
                  No active strategies for {selected.name}.
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
                      v{strategy.version} / {strategy.jurisdiction}
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
