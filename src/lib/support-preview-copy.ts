/**
 * Operator Support Preview copy (DR-084 completion).
 * Single source of truth for the exact strings the support-preview
 * contract requires. Components and the write guard import from here so
 * tests can pin exactness in one place.
 */

export const SUPPORT_PREVIEW_READ_ONLY_CODE = "support_preview_read_only";

export const SUPPORT_PREVIEW_READ_ONLY_MESSAGE =
  "Support preview is read-only. Complete this action from the firm’s own authorized session.";

export const SUPPORT_PREVIEW_DECISION_MAKER_SENTENCE =
  "Only the firm’s authorized lawyer/client decision-maker can complete this action from their own portal session.";

export type SupportPreviewAudience = "lawyer" | "client";

export function supportPreviewAudienceLabel(audience: SupportPreviewAudience): string {
  return audience === "client" ? "Client viewer" : "Lawyer decision-maker";
}

export function buildSupportPreviewBannerText(
  firmName: string,
  audience: SupportPreviewAudience,
): string {
  return `SUPPORT PREVIEW: You are viewing ${firmName} as ${supportPreviewAudienceLabel(audience)}. You can inspect the client experience, but cannot make changes on the firm’s behalf.`;
}
