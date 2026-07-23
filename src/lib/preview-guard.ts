import "server-only";
import { NextResponse } from "next/server";
import { getPreviewIntent, previewBlocksWrite } from "./preview-mode";
import {
  SUPPORT_PREVIEW_READ_ONLY_CODE,
  SUPPORT_PREVIEW_READ_ONLY_MESSAGE,
} from "./support-preview-copy";

/**
 * Read-only guard for operator-accepting write routes (DR-084). Returns a 403
 * response when the caller is an operator in preview for this firm, or null when
 * the write may proceed. Call at the top of any portal write handler that admits
 * an operator session (the deliverables mutations). Routes that already reject
 * operators (getFirmSession) or require a client token do not need this: an
 * operator in preview is already blocked there.
 *
 * Response body carries a machine-readable `code` alongside the human `error`
 * message, so a caller can branch on the reason without string-matching.
 */
export async function denyWriteIfPreview(firmId: string): Promise<NextResponse | null> {
  if (previewBlocksWrite(await getPreviewIntent(), firmId)) {
    return NextResponse.json(
      { error: SUPPORT_PREVIEW_READ_ONLY_MESSAGE, code: SUPPORT_PREVIEW_READ_ONLY_CODE },
      { status: 403 },
    );
  }
  return null;
}
