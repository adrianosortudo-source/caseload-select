import { notFound } from "next/navigation";
import ChannelConversationPanel from "@/components/portal/ChannelConversationPanel";
import IntakeTranscriptPanel from "@/components/portal/IntakeTranscriptPanel";

export default function ChannelConversationRenderedFixturePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="fixed inset-0 z-[100] overflow-y-auto bg-parchment">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <ChannelConversationPanel
          messages={[
            {
              id: "fixture-inbound-message",
              direction: "inbound",
              source: "webhook",
              body: "Hello, I would like to arrange a consultation about an employment matter.",
              status: "received",
              occurredAt: "2026-09-01T14:00:00.000Z",
            },
            {
              id: "fixture-outbound-message",
              direction: "outbound",
              source: "intake_automation",
              body: "Thank you for contacting the firm. Please share the best phone number to reach you.",
              status: "sent",
              occurredAt: "2026-09-01T14:01:00.000Z",
            },
          ]}
          channel="facebook"
          firmName="Fictional Northstar Law"
          assetId="fixture-1042"
          replyWindow={{
            isOpen: true,
            closesAt: "2026-09-02T14:00:00.000Z",
            reason: "open",
          }}
          supportPreview={false}
          actorIdentityAvailable
          replyEndpoint="/api/test/channel-conversation/reply"
          compact
        />
        <div className="mt-6">
          <IntakeTranscriptPanel
            history={{
              version: 1,
              provenance: "recorded",
              truncated: false,
              notice: null,
              rawTranscript: null,
              events: [
                {
                  id: "fixture-intake-question",
                  sequence: 1,
                  direction: "outbound",
                  body: "When did the dismissal occur?",
                  occurredAt: "2026-09-01T14:02:00.000Z",
                  status: "sent",
                  kind: "discovery_question",
                  slotIds: ["termination_date"],
                  replyToEventId: null,
                  normalizedAnswers: [],
                },
                {
                  id: "fixture-intake-answer",
                  sequence: 2,
                  direction: "inbound",
                  body: "Last Friday",
                  occurredAt: "2026-09-01T14:03:00.000Z",
                  status: "received",
                  kind: "answer",
                  slotIds: ["termination_date"],
                  replyToEventId: "fixture-intake-question",
                  normalizedAnswers: [{ slotId: "termination_date", value: "Last Friday" }],
                },
              ],
            }}
          />
        </div>
      </div>
    </main>
  );
}
