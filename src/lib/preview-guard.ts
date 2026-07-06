import "server-only";
import { NextResponse } from "next/server";
import { getPreviewIntent, previewBlocksWrite } from "./preview-mode";

/**
 * Read-only guard for operator-accepting write routes (DR-084). Returns a 403
 * response when the caller is an operator in preview for this firm, or null when
 * the write may proceed. Call at the top of any portal write handler that admits
 * an operator session (the deliverables mutations). Routes that already reject
 * operators (getFirmSession) or require a client token do not need this: an
 * operator in preview is already blocked there.
 */
export async function denyWriteIfPreview(firmId: string): Promise<NextResponse | null> {
  if (previewBlocksWrite(await getPreviewIntent(), firmId)) {
    return NextResponse.json(
      { error: "Preview mode: actions are disabled here." },
      { status: 403 },
    );
  }
  return null;
}
