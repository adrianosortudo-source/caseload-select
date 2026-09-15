import { notFound } from "next/navigation";
import ConversationRailPortal from "@/components/portal/ConversationRailPortal";
import IntakeTranscriptPanel from "@/components/portal/IntakeTranscriptPanel";
import { ensureConversationRailSlot } from "@/components/portal/lead-report-layout";
import { renderBriefHtmlServer } from "@/lib/screen-brief-html";
import type { LawyerReport } from "@/lib/screen-engine/types";
import "../../portal/[firmId]/triage/[leadId]/brief.css";

const ACTION_RAIL_MARKER = "<!-- ACTION_RAIL_SLOT -->";
const STORED_SLOT_PATTERN =
  /\s*<!-- CHANNEL_CONVERSATION_SLOT -->\s*<div class="brief-conversation-slot" data-channel-conversation-slot><\/div>/;

function fixtureReport(): LawyerReport {
  return {
    lead_id: "L-FIXTURE-REPORT",
    submitted_at: "2026-09-14T18:00:00.000Z",
    matter_snapshot:
      "The lead received a severance offer after five years of employment and wants advice before signing.",
    lawyer_time_priority: "High priority callback",
    band: "A",
    confidence_calibration: "Strong matter fit with decision timing still to confirm.",
    matter_type: "wrongful_dismissal",
    practice_area: "employment",
    four_axis: {
      value: 7,
      complexity: 4,
      urgency: 8,
      readiness: 8,
      readinessAnswered: true,
    },
    axis_reasoning: {
      value: { score: 7, reasons: ["Meaningful compensation at issue"] },
      complexity: { score: 4, reasons: ["Standard severance review"] },
      urgency: { score: 8, reasons: ["Offer deadline is approaching"] },
      readiness: { score: 8, reasons: ["Documents are available"] },
      readinessAnswered: true,
    },
    truth_warnings: [],
    likely_legal_services: ["Severance review", "Negotiation strategy"],
    fee_estimate: "$1,500 to $3,500",
    why_it_matters:
      "The proposed release could affect the lead's ability to pursue additional compensation.",
    cross_sell_opportunities: ["Employment agreement review"],
    strategic_considerations: [
      "Confirm the signing deadline and whether an extension is available.",
      "Compare the offer with common-law notice factors.",
      "Review the release language before the lead signs.",
    ],
    what_to_confirm: ["Compensation", "Benefits", "Bonus history"],
    call_openers: ["Walk me through the termination meeting."],
    best_next_question: "When does the offer expire?",
    resolved_facts_v2: [
      { label: "Name", value: "Taylor Morgan", source: "stated" },
      { label: "Email", value: "taylor@example.com", source: "confirmed" },
      { label: "Tenure", value: "Five years", source: "stated" },
      { label: "Offer", value: "Six weeks", source: "stated" },
    ],
    resolved_facts: {},
    inferred_signals: ["The lead has not signed the release."],
    open_questions: ["Exact signing deadline", "Benefits continuation"],
    risk_flags: ["Urgent signing deadline may apply"],
    band_reasoning_bullets: ["Strong employment-law fit"],
    contact_complete: true,
    advisory_subtrack: "unknown",
    matter_type_provenance: "deterministic",
    lead_intent: "unknown",
  } as LawyerReport;
}

function BriefFrame({ html }: { html: string }) {
  return (
    <div
      className="brief-frame px-2 md:px-4"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default async function LeadReportConversationFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const variant = (await searchParams).variant === "stored" ? "stored" : "new";
  const rendered = renderBriefHtmlServer(
    fixtureReport(),
    "instagram",
    "en",
    undefined,
    "wrongful_dismissal",
    "employment",
    { decisionDeadlineIso: "2026-09-16T18:00:00.000Z" },
  );
  const sourceHtml = variant === "stored" ? rendered.replace(STORED_SLOT_PATTERN, "") : rendered;
  const prepared = ensureConversationRailSlot(sourceHtml);
  const splitIndex = prepared.html.indexOf(ACTION_RAIL_MARKER);
  const topHtml = prepared.html.slice(0, splitIndex);
  const bottomHtml = prepared.html.slice(splitIndex + ACTION_RAIL_MARKER.length);

  return (
    <main className="fixed inset-0 z-[100] overflow-y-auto bg-parchment">
      <div
        className="lead-report-page space-y-4 py-6 sm:py-8"
        data-lead-report-page
        data-operator-console
        data-fixture-brief-variant={variant}
      >
        <BriefFrame html={topHtml} />
        <div
          className="mx-2 border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-navy md:mx-4"
          data-fixture-action-bar
        >
          Lead decision controls
        </div>
        <BriefFrame html={bottomHtml} />
        <ConversationRailPortal
          messages={[
            {
              id: "fixture-inbound-message",
              direction: "inbound",
              source: "webhook",
              body: "I have the offer and have not signed it yet.",
              status: "received",
              occurredAt: "2026-09-14T18:10:00.000Z",
            },
            {
              id: "fixture-outbound-message",
              direction: "outbound",
              source: "intake_automation",
              body: "Thank you. A lawyer will review the information you provided.",
              status: "sent",
              occurredAt: "2026-09-14T18:11:00.000Z",
            },
          ]}
          channel="instagram"
          firmName="Fictional Northstar Law"
          assetId="fixture-instagram-asset"
          replyWindow={{
            isOpen: true,
            closesAt: "2026-09-15T18:10:00.000Z",
            reason: "open",
          }}
          supportPreview={false}
          actorIdentityAvailable
          replyEndpoint="/api/test/channel-conversation/reply"
        />
        <div className="px-2 md:px-4">
          <IntakeTranscriptPanel
            history={{
              version: 1,
              provenance: "recorded",
              truncated: false,
              notice: null,
              rawTranscript: null,
              events: [
                {
                  id: "fixture-question",
                  sequence: 1,
                  direction: "outbound",
                  body: "When does the severance offer expire?\n\n1. In the next few days\n2. More than a week",
                  occurredAt: "2026-09-14T18:02:00.000Z",
                  status: "sent",
                  kind: "discovery_question",
                  slotIds: ["severance_deadline"],
                  replyToEventId: null,
                  normalizedAnswers: [],
                },
                {
                  id: "fixture-answer",
                  sequence: 2,
                  direction: "inbound",
                  body: "1",
                  occurredAt: "2026-09-14T18:03:00.000Z",
                  status: "received",
                  kind: "answer",
                  slotIds: ["severance_deadline"],
                  replyToEventId: "fixture-question",
                  normalizedAnswers: [
                    { slotId: "severance_deadline", value: "In the next few days" },
                  ],
                },
              ],
            }}
          />
        </div>
      </div>
    </main>
  );
}
