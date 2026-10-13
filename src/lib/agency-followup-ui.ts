const PRE_APPROVAL_SEND_BLOCKERS = new Set([
  "message_not_approved",
  "approval_missing",
  "not_due",
  "minimum_spacing_not_elapsed",
]);

export function canApproveAgencyFollowupMessage(input: {
  messageState: string;
  sequenceReleased: boolean;
  blockers: readonly string[];
}): boolean {
  return input.messageState === "awaiting_review" && input.sequenceReleased &&
    input.blockers.every((blocker) => PRE_APPROVAL_SEND_BLOCKERS.has(blocker));
}
