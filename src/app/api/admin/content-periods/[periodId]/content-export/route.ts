/**
 * GET /api/admin/content-periods/[periodId]/content-export
 *
 * Read-only, operator-only publishing bundle for a content period: exact,
 * already-stored deliverable content, so an operator or a publishing agent
 * can retrieve what already exists in the client portal without searching
 * the filesystem, guessing asset locations, or regenerating anything.
 *
 * This is a SEPARATE feature from the publication-manifest route above it
 * in this same directory tree. It does not extend, redesign, or depend on
 * Publication Readiness; see content-period-export.ts's module header for
 * the full boundary statement.
 *
 * Auth: operator session only (requireOperator). No cron-bearer bypass:
 * unlike publication-manifest, nothing in this spec calls for an
 * unattended cron caller, so none is added.
 *
 * Query params:
 *   format   json (default) | markdown
 *
 * WITHHOLDING POLICY — what this route removes, and what it deliberately does
 * not. Both formats withhold the same thing, decided by the same predicate
 * (shouldWithholdArtifactLinks): a temporary signed URL, and the public URL
 * beside it, for any object that is retracted, not bound to the deliverable's
 * current version, or belongs to a deliverable not cleared to publish.
 *
 * ACCESS is withheld; IDENTITY and CONTENT are not. storage_path,
 * storage_bucket, sha256, mime and size are always present, because an
 * operator who cannot be handed a URL still needs to find the file by hand.
 * Unapproved body_html is likewise always present. That is deliberate, and
 * the rule is: a signed URL mints a time-limited capability against storage,
 * whereas a body is data already inside a response this operator-only route is
 * authorised to return. An operator can read the same draft in the review UI.
 * If that rule is ever revisited, revisit it HERE -- the previous absence of a
 * stated rule is what made the difference between the two look like an
 * oversight rather than a decision.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import {
  buildContentExportBundle,
  renderContentExportMarkdown,
  withholdBundleLinks,
} from "@/lib/content-period-export";

export async function GET(req: NextRequest, { params }: { params: Promise<{ periodId: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { periodId } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "markdown" ? "markdown" : "json";

  const result = await buildContentExportBundle(periodId);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.error === "period not found" ? 404 : 500 },
    );
  }

  if (format === "markdown") {
    return new NextResponse(renderContentExportMarkdown(result.bundle), {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }

  // withholdBundleLinks, not result.bundle: buildContentExportBundle signs
  // every asset unconditionally (signing runs before may_publish is computed),
  // so the raw bundle carries working URLs to retracted and unapproved
  // material. json is the DEFAULT format, so serialising it raw made the
  // ungated path the one an agent reaches first. The markdown branch above
  // deliberately keeps the raw bundle -- its withheld-reason lines are gated
  // on signed_url being present, so it must see the URL in order to refuse it.
  return NextResponse.json({ ok: true, bundle: withholdBundleLinks(result.bundle) }, { status: 200 });
}
