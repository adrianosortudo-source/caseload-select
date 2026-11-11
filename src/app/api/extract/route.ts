import { NextResponse } from "next/server";
import { llmExtractServer } from "@/lib/screen-llm-server";
import { initialiseState, classificationForMatterType, isValidMatterType } from "@/lib/screen-engine/extractor";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { familyNegativeIsGrounded } from "@/lib/screen-engine/llm/extractor";
import { SLOT_REGISTRY } from "@/lib/screen-engine/slotRegistry";
import { llmMapOptionReply } from "@/lib/llm-option-map";
import type { MatterType } from "@/lib/screen-engine/types";

interface ExtractRequest {
  description?: string;
  matter_type?: MatterType;
  family_enabled?: boolean;
  routing?: { selection: string; active_area: string; revision: number };
  already_extracted?: Record<string, string | null>;
  pending_slot_id?: string;
  reply?: string;
}

// Reject oversized descriptions explicitly before forwarding the complete accepted text.
const MAX_DESCRIPTION_CHARS = 16_000;

export async function POST(req: Request) {
  // Public route (the browser widget calls it, no auth possible); the
  // per-IP bucket is the only gate in front of the Gemini spend (H6).
  const ip = ipFromRequest(req);
  const rl = await checkRateLimit("extract", ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate limited", retry_after_seconds: Math.ceil((rl.reset - Date.now()) / 1000) },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  let body: ExtractRequest;
  try {
    body = (await req.json()) as ExtractRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const description = typeof body.description === "string" ? body.description : "";
  if (!description.trim()) {
    return NextResponse.json({ extracted: {}, mode: "disabled", reason: "empty description" });
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return NextResponse.json({ error: "description too long" }, { status: 413 });
  }

  const matter = body.matter_type ?? "unknown";
  if (typeof matter !== "string" || !isValidMatterType(matter)) {
    return NextResponse.json({ error: "invalid matter type" }, { status: 400 });
  }
  const areas = ["corporate", "real_estate", "employment", "estates", "family"];
  const routing = body.routing;
  if (routing !== undefined) {
    const actualArea = classificationForMatterType(matter).practice_area;
    if (!routing || typeof routing !== "object" || !["auto", ...areas].includes(routing.selection) ||
        !["unknown", ...areas].includes(routing.active_area) || !Number.isSafeInteger(routing.revision) || routing.revision < 0 ||
        actualArea !== routing.active_area) {
      return NextResponse.json({ error: "invalid routing context" }, { status: 400 });
    }
    if (body.already_extracted !== undefined && (!body.already_extracted || typeof body.already_extracted !== "object" || Array.isArray(body.already_extracted) ||
        Object.entries(body.already_extracted).some(([id, value]) => !SLOT_REGISTRY.some(slot =>
          slot.id === id && slot.applies_to.includes(matter) && (value === null || (typeof value === "string" && (slot.input_type !== "single_select" || !slot.options || slot.options.some(option => option.value === value)))))))) {
      return NextResponse.json({ error: "invalid extracted fields" }, { status: 400 });
    }
  }

  const state = {
    ...initialiseState(description),
    ...(routing ? classificationForMatterType(matter) : { matter_type: matter }),
    ...(routing ? { demoRouting: { selection: routing.selection as "auto" | "corporate" | "real_estate" | "employment" | "estates" | "family", candidate: null, pending: null, revision: routing.revision, declinedCandidate: null } } : {}),
    family_enabled: body.family_enabled === true,
    slots: body.already_extracted ?? {},
  };

  const slot = typeof body.pending_slot_id === "string" ? SLOT_REGISTRY.find((item) => item.id === body.pending_slot_id) : undefined;
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if ((body.pending_slot_id !== undefined || body.reply !== undefined) &&
      (!slot || slot.tier === "contact" || slot.input_type !== "single_select" || !slot.options?.length ||
       !slot.applies_to.includes(state.matter_type) || !reply || reply.length > 4000)) {
    return NextResponse.json({ error: "invalid pending slot or reply" }, { status: 400 });
  }
  const [result, mapped] = await Promise.all([
    llmExtractServer(description, state, MAX_DESCRIPTION_CHARS),
    slot && reply ? llmMapOptionReply({ questionLabel: slot.question, options: slot.options!, reply, language: "en" }) : Promise.resolve(null),
  ]);
  const value = mapped?.value;
  const compositeNegativeGrounded = slot?.id !== "family_existing_order" || value !== "Neither" ||
    /^neither[.!\s]*$/i.test(reply) || familyNegativeIsGrounded(slot.id, value, `${description}\n${reply}`);
  const mapped_answer = slot && value && compositeNegativeGrounded && slot.options?.some((option) => option.value === value)
    ? { slotId: slot.id, value } : undefined;
  return NextResponse.json({ ...result, ...(mapped ? { mapping_mode: mapped.mode } : {}), ...(mapped_answer ? { mapped_answer } : {}) });
}
