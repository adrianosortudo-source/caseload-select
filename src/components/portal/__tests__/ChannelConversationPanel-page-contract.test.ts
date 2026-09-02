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

describe("triage lead conversation integration", () => {
  it("limits the panel to Facebook, Instagram, and WhatsApp leads", () => {
    expect(pageSource).toMatch(
      /channel === "facebook" \|\| channel === "instagram" \|\| channel === "whatsapp"/,
    );
  });

  it("renders the conversation directly after the triage action bar", () => {
    expect(pageSource).toMatch(
      /<TriageActionBar[\s\S]*?\/>\s*\{conversationChannel && \(\s*<ChannelConversationPanel/,
    );
  });

  it("uses the firm-scoped lead reply endpoint and does not serialize destination IDs into it", () => {
    expect(pageSource).toContain(
      "replyEndpoint={`/api/portal/${firmId}/triage/${row.lead_id}/reply`}",
    );
    expect(pageSource).not.toMatch(/replyEndpoint=.*(?:page_id|sender_|igsid|wa_id)/);
  });

  it("passes the legacy raw transcript separately from ledger messages", () => {
    expect(pageSource).toContain("messages={conversation?.messages ?? []}");
    expect(pageSource).toContain("intakeTranscript={row.raw_transcript}");
  });

  it("fails the composer closed when the portal session lacks a stable actor UUID", () => {
    expect(pageSource).toContain(
      "actorIdentityAvailable={isStableActorId(session?.lawyer_id)}",
    );
    expect(pageSource).toMatch(/function isStableActorId[\s\S]*?\^\[0-9a-f\]/);
  });
});
