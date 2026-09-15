import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const pageSource = fs.readFileSync(
  path.join(
    process.cwd(),
    "src",
    "app",
    "portal",
    "[firmId]",
    "triage",
    "[leadId]",
    "page.tsx",
  ),
  "utf8",
);
const layoutSource = fs.readFileSync(
  path.join(process.cwd(), "src", "components", "portal", "lead-report-layout.ts"),
  "utf8",
);

describe("triage lead conversation integration", () => {
  it("limits the panel to Facebook, Instagram, and WhatsApp leads", () => {
    expect(pageSource).toMatch(
      /channel === "facebook" \|\| channel === "instagram" \|\| channel === "whatsapp"/,
    );
  });

  it("mounts the conversation in a stable v2 report-rail slot", () => {
    expect(pageSource).toContain("ensureConversationRailSlot(originalBriefHtml)");
    expect(layoutSource).toContain("data-channel-conversation-slot");
    expect(pageSource).toMatch(
      /<BriefFrame html=\{briefBottomHtml\}[\s\S]*?<ConversationRailPortal/,
    );
  });

  it("keeps a below-report conversation fallback for legacy briefs without a rail", () => {
    expect(pageSource).toMatch(
      /conversationChannel && !conversationSlotResult\.inserted[\s\S]*?<ChannelConversationPanel/,
    );
  });

  it("uses the firm-scoped lead reply endpoint and does not serialize destination IDs into it", () => {
    expect(pageSource).toContain(
      "replyEndpoint={`/api/portal/${firmId}/triage/${row.lead_id}/reply`}",
    );
    expect(pageSource).not.toMatch(/replyEndpoint=.*(?:page_id|sender_|igsid|wa_id)/);
  });

  it("keeps ledger messages in the reply panel and moves intake evidence to the final panel", () => {
    expect(pageSource).toContain("messages={conversation?.messages ?? []}");
    expect(pageSource).toContain("reconstructLegacyChannelIntakeHistory");
    expect(pageSource).toContain("rawTranscript: row.raw_transcript");
    expect(pageSource).toContain("<IntakeTranscriptPanel history={intakeHistory} />");
    expect(pageSource).not.toContain("intakeTranscript={row.raw_transcript}");
  });

  it("fails the composer closed when the portal session lacks a stable actor UUID", () => {
    expect(pageSource).toContain(
      "actorIdentityAvailable={isStableActorId(session?.lawyer_id)}",
    );
    expect(pageSource).toMatch(/function isStableActorId[\s\S]*?\^\[0-9a-f\]/);
  });
});
