const PRE_APPROVAL_SEND_BLOCKERS = new Set([
  "message_not_approved",
  "approval_missing",
  "not_due",
  "minimum_spacing_not_elapsed",
  "outside_send_window",
]);

type AgencyFollowupProviderDeliveryStatus =
  | "unknown"
  | "accepted"
  | "delivered"
  | "failed"
  | "bounced"
  | "complained"
  | "unsubscribed";

const DELIVERY_STATUS_LABELS: Record<AgencyFollowupProviderDeliveryStatus, string> = {
  unknown: "Outcome unknown",
  accepted: "Accepted by provider",
  delivered: "Delivered per provider",
  failed: "Provider reports failure",
  bounced: "Bounced by recipient mail server",
  complained: "Marked as spam",
  unsubscribed: "Recipient unsubscribed",
};

export function agencyFollowupDeliveryStatusLabel(input: {
  messageState: string;
  providerDeliveryStatus: AgencyFollowupProviderDeliveryStatus;
}): string {
  if (input.providerDeliveryStatus === "unknown" && input.messageState !== "unknown") {
    return "Not sent";
  }
  return DELIVERY_STATUS_LABELS[input.providerDeliveryStatus];
}

export function canApproveAgencyFollowupMessage(input: {
  messageState: string;
  sequenceReleased: boolean;
  blockers: readonly string[];
}): boolean {
  return input.messageState === "awaiting_review" && input.sequenceReleased &&
    input.blockers.every((blocker) => PRE_APPROVAL_SEND_BLOCKERS.has(blocker));
}
