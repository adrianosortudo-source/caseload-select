"use client";

import { forwardRef } from "react";
import Link from "next/link";
import DecisionTimer from "./DecisionTimer";
import { matterLabel, subtrackLabel } from "@/lib/screened-leads-labels";
import { channelLabel, channelBadgeClasses } from "@/lib/channel-labels";
import { intakeLanguageLabel } from "@/lib/intake-language-label";
import { formatRelativeArrival, formatAbsoluteArrival } from "@/lib/decision-timer";
import { highlightText } from "@/lib/triage-search";

/**
 * Triage queue card — NAP-first hierarchy.
 *
 * The card prioritises the lead's identity (name + contact) over the matter
 * category. Layout, top to bottom:
 *
 *   row 1: band chip | lead name (22px Manrope 700)          | countdown
 *   row 2:           | phone · email · postal (links)         |
 *   row 3:                  arrival timestamp + relative
 *   row 4:                  matter type tag · channel · lead id
 *   row 5:                  snapshot + fee + four-axis bars
 *
 * The phone link uses tel:, the email link uses mailto:. Both stop click
 * propagation so they don't open the brief view by accident — the rest of
 * the card stays clickable as a single target to the brief page.
 *
 * History view (status in passed/referred/declined/taken) collapses the
 * countdown to a "No decision needed" stamp and softens the card opacity.
 */

export interface QueueCardRow {
  lead_id: string;
  band: "A" | "B" | "C" | "D" | null;
  status: "triaging" | "taken" | "passed" | "declined" | "referred";
  matter_type: string;
  practice_area: string;
  value_score: number | null;
  complexity_score: number | null;
  urgency_score: number | null;
  readiness_score: number | null;
  readiness_answered: boolean;
  whale_nurture: boolean;
  band_c_subtrack: string | null;
  decision_deadline: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_postal_code: string | null;
  submitted_at: string;
  brief_json: { matter_snapshot?: string; fee_estimate?: string } | null;
  slot_answers: { channel?: string } | null;
  intake_language: string | null;
  score_confidence?: string | null;
}

/**
 * Wrap any case-insensitive occurrence of `highlights` in <mark> tags.
 * Returns a React fragment so it can be dropped into any text slot.
 *
 * Empty highlights → plain text is rendered.
 */
function Highlighted({ value, highlights }: { value: string | null | undefined; highlights: string[] }) {
  if (!value) return null;
  if (highlights.length === 0) return <>{value}</>;
  const segments = highlightText(value, highlights);
  return (
    <>
      {segments.map((seg, i) =>
        seg.mark != null ? (
          <mark key={i} className="bg-gold/30 text-navy rounded-sm px-0.5 py-0">{seg.mark}</mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

interface TriageQueueCardProps {
  firmId: string;
  row: QueueCardRow;
  view: "active" | "history";
  highlights?: string[];
  /** Index in the visible list — used for ↑/↓ keyboard navigation. */
  cardIndex?: number;
  /** True when this card is the keyboard-focused one in the queue list. */
  isFocused?: boolean;
}

const TriageQueueCard = forwardRef<HTMLAnchorElement, TriageQueueCardProps>(function TriageQueueCard(
  { firmId, row, view, highlights = [], cardIndex, isFocused = false },
  ref,
) {
  const snapshot = row.brief_json?.matter_snapshot ?? matterLabel(row.matter_type);
  const subtrack = subtrackLabel(row.band_c_subtrack);
  const simplicity = row.complexity_score === null ? null : 10 - row.complexity_score;
  const channel = row.slot_answers?.channel ?? null;
  const langLabel = intakeLanguageLabel(row.intake_language);
  const isHistory = view === "history";
  const relative = formatRelativeArrival(row.submitted_at);
  const absolute = formatAbsoluteArrival(row.submitted_at);

  const statusChip =
    !isHistory
      ? null
      : row.status === "passed"
      ? { label: "Passed", classes: "bg-parchment-2 text-muted border-border-brand" }
      : row.status === "referred"
      ? { label: "Referred", classes: "bg-navy text-white border-navy" }
      : row.status === "declined"
      ? { label: "Declined", classes: "text-red-fail border-red-fail bg-transparent" }
      : row.status === "taken"
      ? { label: "Taken", classes: "bg-green-pass text-white border-green-pass" }
      : null;

  // tel: and mailto: builders: tolerate missing fields.
  const telHref = row.contact_phone ? `tel:${row.contact_phone.replace(/\s+/g, "")}` : null;
  const mailHref = row.contact_email ? `mailto:${row.contact_email}` : null;

  // We swallow clicks on the inner contact links so they trigger their own
  // intent (dial / mail) instead of opening the brief view.
  function stopProp(e: React.MouseEvent): void {
    e.stopPropagation();
  }

  return (
    <Link
      ref={ref}
      href={`/portal/${firmId}/triage/${row.lead_id}`}
      data-card-index={cardIndex}
      className={`block bg-white border transition-colors outline-none ${
        isFocused ? "ring-2 ring-navy ring-offset-1" : ""
      } ${
        isHistory
          ? "border-black/10 hover:border-stone-400 opacity-80 hover:opacity-100"
          : "border-black/10 hover:border-navy focus:border-navy"
      }`}
    >
      {/* ── Top section: band + name + contact + countdown ────────────── */}
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-4 px-5 pt-5 pb-3">
        {/* Band — spans the two top rows */}
        <div className="row-span-2">
          <BandBadge band={row.band} />
        </div>

        {/* Name */}
        <div className="min-w-0">
          <div className="text-[22px] font-display font-bold text-navy leading-tight truncate">
            <Highlighted value={row.contact_name ?? "Unknown caller"} highlights={highlights} />
          </div>
        </div>

        {/* Countdown — spans the two top rows */}
        <div className="row-span-2 text-right min-w-[110px]">
          {isHistory ? (
            <span className="text-[10px] uppercase tracking-wider font-bold text-muted">
              No decision needed
            </span>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-black/40 mb-1">
                Decision in
              </div>
              <DecisionTimer deadlineIso={row.decision_deadline} submittedAtIso={row.submitted_at} />
            </>
          )}
        </div>

        {/* Contact row — under the name */}
        <div className="col-start-2 row-start-2 text-sm text-black/65 mt-0.5 truncate">
          {telHref && row.contact_phone && (
            <a
              href={telHref}
              onClick={stopProp}
              className="text-black/80 hover:text-navy hover:underline"
            >
              <Highlighted value={row.contact_phone} highlights={highlights} />
            </a>
          )}
          {telHref && (mailHref || row.contact_postal_code) && (
            <span className="text-black/30 mx-2" aria-hidden>·</span>
          )}
          {mailHref && row.contact_email && (
            <a
              href={mailHref}
              onClick={stopProp}
              className="text-black/80 hover:text-navy hover:underline"
            >
              <Highlighted value={row.contact_email} highlights={highlights} />
            </a>
          )}
          {mailHref && row.contact_postal_code && (
            <span className="text-black/30 mx-2" aria-hidden>·</span>
          )}
          {row.contact_postal_code && (
            <span className="text-black/50">
              <Highlighted value={row.contact_postal_code} highlights={highlights} />
            </span>
          )}
          {!telHref && !mailHref && !row.contact_postal_code && (
            <span className="text-black/40 italic-off">No contact captured</span>
          )}
        </div>
      </div>

      {/* ── Arrival timestamp ───────────────────────────────────────── */}
      <div className="px-5 py-2.5 mx-5 border-t border-black/5 flex flex-wrap items-baseline gap-x-3 text-xs">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-black/40">
          Arrived
        </span>
        <span className="text-black/75 font-medium">{absolute}</span>
        <span className="text-black/50">{relative}</span>
      </div>

      {/* ── Tags: matter type + channel + subtrack + language + lead id ── */}
      <div className="px-5 py-2.5 mx-5 flex flex-wrap items-center gap-2">
        {statusChip && (
          <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 border ${statusChip.classes}`}>
            {statusChip.label}
          </span>
        )}
        <span className="text-[10px] uppercase tracking-wider font-bold bg-parchment-2 text-navy px-2 py-0.5 border border-black/10">
          <Highlighted value={matterLabel(row.matter_type)} highlights={highlights} />
        </span>
        {channel && (
          <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border ${channelBadgeClasses(channel)}`}>
            {channelLabel(channel)}
          </span>
        )}
        {row.whale_nurture && (
          <span className="text-[10px] uppercase tracking-wider font-semibold bg-gold/20 text-navy px-2 py-0.5 border border-gold/40">
            Whale nurture
          </span>
        )}
        <ConfidenceChip confidence={row.score_confidence ?? null} />
        {subtrack && (
          <span className="text-[10px] uppercase tracking-wider font-semibold bg-parchment-2 text-black/70 px-2 py-0.5 border border-black/10">
            {subtrack}
          </span>
        )}
        {langLabel && (
          <span className="text-[10px] uppercase tracking-wider font-semibold bg-navy/10 text-navy px-2 py-0.5 border border-navy/20">
            {langLabel}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-black/40 tracking-wider">
          <Highlighted value={row.lead_id} highlights={highlights} />
        </span>
      </div>

      {/* ── Body: snapshot + fee + axes ─────────────────────────────── */}
      <div className="px-5 pt-3 pb-4 mx-5 mb-1 border-t border-black/5">
        <p className="text-sm text-black/80 line-clamp-3">
          <Highlighted value={snapshot} highlights={highlights} />
        </p>
        {row.brief_json?.fee_estimate && (
          <p className="mt-2 text-xs text-black/55 leading-relaxed">
            <Highlighted value={row.brief_json.fee_estimate} highlights={highlights} />
          </p>
        )}
        <div className="mt-3">
          <AxisRow
            value={row.value_score}
            simplicity={simplicity}
            urgency={row.urgency_score}
            readiness={row.readiness_score}
            readinessAnswered={row.readiness_answered}
          />
        </div>
      </div>
    </Link>
  );
});

export default TriageQueueCard;

/**
 * Confidence-tier chip (C3 scoring port, promoted 2026-07-02). Distinct from
 * the band badge on purpose: band says how urgent/valuable the matter looks,
 * confidence says how much of that is backed by user-answered slots versus
 * thin evidence. A low-confidence Band A is real and should read as both.
 */
function ConfidenceChip({ confidence }: { confidence: string | null }) {
  if (!confidence) return null;
  const classes =
    confidence === "high"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : confidence === "medium"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-red-50 text-red-800 border-red-200";
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border ${classes}`}>
      {confidence} confidence
    </span>
  );
}

function BandBadge({ band }: { band: "A" | "B" | "C" | "D" | null }) {
  const colour =
    band === "A" ? "bg-gold text-deep-black border-gold"
    : band === "B" ? "bg-navy text-white border-navy"
    : band === "C" ? "bg-muted text-white border-muted"
    : band === "D" ? "bg-transparent text-field-label border-muted"
                   : "bg-parchment-2 text-muted border-border-brand";
  return (
    <span
      className={`inline-flex items-center justify-center font-display font-bold text-2xl w-14 h-14 border ${colour}`}
      aria-label={`Band ${band ?? "unrated"}`}
    >
      {band ?? "—"}
    </span>
  );
}

interface AxisRowProps {
  value: number | null;
  simplicity: number | null;
  urgency: number | null;
  readiness: number | null;
  readinessAnswered: boolean;
}

function AxisRow({ value, simplicity, urgency, readiness, readinessAnswered }: AxisRowProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px] tabular-nums">
      <Axis label="Val" score={value} />
      <Axis label="Smp" score={simplicity} />
      <Axis label="Urg" score={urgency} />
      <Axis label="Rdy" score={readiness} muted={!readinessAnswered} />
    </div>
  );
}

function Axis({ label, score, muted = false }: { label: string; score: number | null; muted?: boolean }) {
  const isZero = score === 0;
  return (
    <div className={`flex items-center gap-1 ${muted ? "opacity-50" : ""}`}>
      <span className="uppercase tracking-wider font-semibold text-black/50">{label}</span>
      <span className={`font-mono font-bold ${isZero ? "text-black/40" : "text-black/80"}`}>
        {score ?? "—"}/10
      </span>
    </div>
  );
}
