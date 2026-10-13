import React from "react";
import { createRoot } from "react-dom/client";
import AgencyFollowupClient from "@/app/admin/agency-crm/follow-up/AgencyFollowupClient";
import "@/app/globals.css";

const fixture = {
  journeys: [{ id: "journey-1", name: "Synthetic diagnostic follow-up", journeyKey: "synthetic", version: 1, state: "active" }],
  items: [
    {
      id: "message-1", enrollmentId: "enrollment-1", prospectId: "prospect-1", firmName: "Synthetic North Shore Legal Group",
      prospectStage: "researching", journeyName: "Synthetic diagnostic follow-up", stepNumber: 1, state: "awaiting_review",
      eligibility: "eligible", contactability: "allowed", conversationStatus: "awaiting_reply", recipientEmail: "review@example.test",
      subject: "A synthetic follow-up review", body: "This message uses synthetic fixture content for responsive layout checks. It does not contact a real firm or person.",
      scheduledAt: "2099-04-06T13:00:00.000Z", blockers: ["message_not_approved", "approval_missing", "not_due"], sequenceReleased: true,
    },
    {
      id: "message-2", enrollmentId: "enrollment-2", prospectId: "prospect-2", firmName: "Synthetic Central Practice",
      prospectStage: "new", journeyName: "Synthetic diagnostic follow-up", stepNumber: 1, state: "awaiting_review",
      eligibility: "pending", contactability: "unknown", conversationStatus: "not_contacted", recipientEmail: "example@example.test",
      subject: "A second synthetic message", body: "Synthetic content appears in this message card. Review the hard stop before any future approval.",
      scheduledAt: "2099-04-06T13:00:00.000Z", blockers: ["eligibility_pending", "contactability_unknown", "sequence_not_released", "approval_missing"], sequenceReleased: false,
    },
  ],
};

createRoot(document.getElementById("root")!).render(<AgencyFollowupClient initialData={fixture} />);
