import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import {
  getPiece,
  updatePiece,
  getCurrentVersion,
  resolvePublishGateStatus,
} from "@/lib/content-studio";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createDeliverable, addVersion } from "@/lib/deliverables";
import {
  checkLegalGateEntryCondition,
  checkLegalGateExitCondition,
  checkBilingualAuthoringCondition,
} from "@/lib/content-studio-gates";
import {
  renderServicePagePreview,
  renderMarkdownToSafeHtml,
  type ServicePageBlock,
} from "@/lib/content-studio-structured";

export const dynamic = "force-dynamic";

// System actor for deliverables created automatically by a gate advance.
// The route itself is already operator-gated (requireOperator below), so
// "operator" is the correct role for this write; there is no separate
// human actor to attribute it to.
const GATE_ACTOR = { role: "operator" as const, id: null, name: "Content Studio (automated)", email: null };

const WORKFLOW_GATES = [
  "discovery",
  "position",
  "draft",
  "legal_gate",
  "authoring",
  "production",
] as const;

type WorkflowGate = (typeof WORKFLOW_GATES)[number];

/**
 * GET /api/admin/content-studio/pieces/[id]
 * Returns the piece, its current EN and PT versions, and recent AI runs.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { id } = await params;

  const { data: piece, error } = await getPiece(id);
  if (error || !piece) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Piece not found" },
      { status: error ? 500 : 404 }
    );
  }

  // Fetch current EN version
  const currentEn = await getCurrentVersion(id, "en");

  // Fetch current PT version (if bilingual)
  let currentPt = null;
  if (piece.language_mode === "bilingual") {
    currentPt = await getCurrentVersion(id, "pt");
  }

  // Fetch latest AI runs for this piece (limit 5)
  const { data: aiRuns } = await supabaseAdmin
    .from("content_ai_runs")
    .select("*")
    .eq("piece_id", id)
    .order("created_at", { ascending: false })
    .limit(5);

  return NextResponse.json({
    ok: true,
    piece,
    current_version_en: currentEn ?? null,
    current_version_pt: currentPt,
    ai_runs: aiRuns ?? [],
  });
}

/**
 * PATCH /api/admin/content-studio/pieces/[id]
 * Updates piece fields. Enforces forward-only workflow gate transitions.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  const allowedFields = [
    "title_working",
    "source_brief",
    "workflow_gate",
    "status",
    "owner_name",
    "review_date",
    "ship_checks",
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: "No valid fields to update" },
      { status: 400 }
    );
  }

  // If workflow_gate is being changed, validate forward-only transition
  if ("workflow_gate" in updates) {
    const { data: currentPiece, error: fetchErr } = await getPiece(id);
    if (fetchErr || !currentPiece) {
      return NextResponse.json(
        { ok: false, error: fetchErr?.message ?? "Piece not found" },
        { status: fetchErr ? 500 : 404 }
      );
    }

    const currentGate = currentPiece.workflow_gate as WorkflowGate;
    const newGate = updates.workflow_gate as WorkflowGate;

    const currentIndex = WORKFLOW_GATES.indexOf(currentGate);
    const newIndex = WORKFLOW_GATES.indexOf(newGate);

    if (newIndex < 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid workflow_gate. Must be one of: ${WORKFLOW_GATES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (newIndex <= currentIndex) {
      return NextResponse.json(
        {
          ok: false,
          error: `Workflow gate can only advance forward. Current: ${currentGate}, requested: ${newGate}`,
        },
        { status: 422 }
      );
    }

    // WP-2 (Ses.16 next-20% build plan): legal_gate is a real gate, not a
    // label. Any transition LANDING at legal_gate must pass the entry
    // condition (a current version exists and its latest validation run has
    // zero fails); any transition LANDING at authoring or production must
    // pass the exit condition (linked deliverable approved, or an active
    // publish delegation covers this format). Checked by destination gate,
    // not by the specific (from, to) pair, so a gate-skipping PATCH cannot
    // route around either check.
    if (newGate === "legal_gate") {
      const version = await getCurrentVersion(id, "en");
      let latestValidationResults: { status: string }[] | null = null;
      if (version) {
        const { data: run } = await supabaseAdmin
          .from("content_ai_runs")
          .select("result")
          .eq("piece_version_id", version.id)
          .eq("run_type", "validate_deterministic")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const result = run?.result as { validators?: { status: string }[] } | undefined;
        latestValidationResults = result?.validators ?? null;
      }

      const entryCheck = checkLegalGateEntryCondition({
        hasCurrentVersion: !!version,
        latestValidationResults,
      });
      if (!entryCheck.ok) {
        return NextResponse.json(
          { ok: false, error: entryCheck.reason, code: "legal_gate_entry_blocked" },
          { status: 422 }
        );
      }

      // Entry condition met: render the piece and create its linked
      // deliverable in the existing lawyer-review system. notify: false
      // (via addVersion's `silent` option) is mandatory here: this is an
      // internal workflow transition, not an operator announcing a
      // deliverable is ready, and the stop-line in the build plan forbids
      // any notification reaching the firm from this run.
      const html =
        currentPiece.format === "canonical_service_page"
          ? renderServicePagePreview(
              (version!.body_structured as ServicePageBlock[] | null) ?? [],
              (version!.seo_metadata as Record<string, unknown> | null) ?? undefined
            ).html
          : renderMarkdownToSafeHtml(version!.body_markdown as string | null);

      const created = await createDeliverable({
        firmId: currentPiece.firm_id,
        title: currentPiece.title_working,
        description: `Content Studio piece (${currentPiece.format}), auto-created on advance to legal_gate.`,
        contentKind: "text",
        actor: GATE_ACTOR,
      });
      if (!created.ok) {
        return NextResponse.json(
          { ok: false, error: `Failed to create linked deliverable: ${created.error}` },
          { status: 500 }
        );
      }

      const versioned = await addVersion({
        deliverableId: created.deliverable.id,
        firmId: currentPiece.firm_id,
        bodyHtml: html,
        storagePath: null,
        assetMime: null,
        assetSizeBytes: null,
        assetName: null,
        note: "Auto-created from Content Studio legal gate advance.",
        actor: GATE_ACTOR,
        silent: true,
      });
      if (!versioned.ok) {
        return NextResponse.json(
          { ok: false, error: `Failed to create deliverable version: ${versioned.error}` },
          { status: 500 }
        );
      }

      updates.deliverable_id = created.deliverable.id;
    }

    if (newGate === "authoring" || newGate === "production") {
      const { deliverableStatus, delegation } = await resolvePublishGateStatus(currentPiece);
      const exitCheck = checkLegalGateExitCondition({
        deliverableStatus,
        delegation,
        format: currentPiece.format as string,
      });
      if (!exitCheck.ok) {
        return NextResponse.json(
          { ok: false, error: exitCheck.reason, code: "legal_gate_exit_blocked" },
          { status: 422 }
        );
      }

      // Ses.17 WP-4: a bilingual piece cannot leave legal_gate without a
      // current PT version. Checked alongside the exit condition above, not
      // instead of it (forward-only gates allow skipping "authoring" and
      // landing directly on "production", so both destinations are guarded).
      const ptVersion = await getCurrentVersion(id, "pt");
      const bilingualCheck = checkBilingualAuthoringCondition({
        languageMode: currentPiece.language_mode as string,
        hasCurrentPtVersion: !!ptVersion,
      });
      if (!bilingualCheck.ok) {
        return NextResponse.json(
          { ok: false, error: bilingualCheck.reason, code: "bilingual_authoring_blocked" },
          { status: 422 }
        );
      }
    }
  }

  const { data: updated, error } = await updatePiece(id, updates);
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, piece: updated });
}
