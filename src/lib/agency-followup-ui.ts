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
  | "unsubscribed"
  | "suppressed";

const DELIVERY_STATUS_LABELS: Record<AgencyFollowupProviderDeliveryStatus, string> = {
  unknown: "Outcome unknown",
  accepted: "Accepted by provider",
  delivered: "Delivered per provider",
  failed: "Provider reports failure",
  bounced: "Bounced by recipient mail server",
  complained: "Marked as spam",
  unsubscribed: "Recipient unsubscribed",
  suppressed: "Blocked by provider",
};

export function agencyFollowupDeliveryStatusLabel(input: {
  messageState: string;
  providerDeliveryStatus: AgencyFollowupProviderDeliveryStatus;
}): string {
  if (input.messageState === "claimed" && input.providerDeliveryStatus === "unknown") {
    return "Dispatch outcome pending";
  }
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

export function formatAgencyFollowupScheduledAt(value: string, timeZone: string): string {
  const scheduledAt = new Date(value);
  if (Number.isNaN(scheduledAt.getTime())) return "scheduled time unavailable";

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(scheduledAt);
    const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    const year = getPart("year");
    const month = getPart("month");
    const day = getPart("day");
    const hour = getPart("hour");
    const minute = getPart("minute");
    if (!year || !month || !day || !hour || !minute) return "scheduled time unavailable";
    return year + "-" + month + "-" + day + " " + hour + ":" + minute;
  } catch {
    return "scheduled time unavailable";
  }
}
