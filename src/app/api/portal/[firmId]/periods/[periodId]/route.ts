/**
 * PATCH  /api/portal/[firmId]/periods/[periodId]   update a week's fields
 * DELETE /api/portal/[firmId]/periods/[periodId]   remove a week (deliverables
 *                                                  in it unassign automatically)
 *
 * Operator-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { updatePeriod, deletePeriod } from "@/lib/deliverables";
import { parseWeekNumber } from "@/lib/deliverables-pure";
import type { ContentPeriod } from "@/lib/types";
import type { StrategyBrief } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s.length ? s : null;
}

const STRATEGY_KEYS = [
  "readerAndSituation",
  "workSupported",
  "whyThisWeek",
  "practicalAngle",
  "authorityAndEvidence",
  "websiteAndConversionRole",
] as const;

function parseStrategyBrief(value: unknown): StrategyBrief | null | "invalid" {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "invalid";
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== STRATEGY_KEYS.length || !STRATEGY_KEYS.every((key) => keys.includes(key))) {
    return "invalid";
  }
  const values = STRATEGY_KEYS.map((key) => cleanText(record[key], 4000));
  if (values.some((value) => !value)) return "invalid";
  return Object.fromEntries(
    STRATEGY_KEYS.map((key, index) => [key, values[index]]),
  ) as unknown as StrategyBrief;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const { firmId, periodId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const patch: Partial<
    Pick<
      ContentPeriod,
      "starts_on" | "ends_on" | "week_number" | "theme" | "details" | "rationale" | "strategyBrief"
    >
  > = {};
  // Only touched when the key is present: an omitted week_number leaves the
  // existing number alone, an explicit null clears it.
  if ("week_number" in body) {
    const parsed = parseWeekNumber(body.week_number);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "week_number must be a whole number of 1 or more, or null" },
        { status: 400 },
      );
    }
    patch.week_number = parsed.value;
  }
  if (typeof body.starts_on === "string") {
    if (!DATE_RE.test(body.starts_on)) {
      return NextResponse.json({ error: "starts_on must be YYYY-MM-DD" }, { status: 400 });
    }
    patch.starts_on = body.starts_on;
  }
  if (typeof body.ends_on === "string") {
    if (!DATE_RE.test(body.ends_on)) {
      return NextResponse.json({ error: "ends_on must be YYYY-MM-DD" }, { status: 400 });
    }
    patch.ends_on = body.ends_on;
  }
  if ("week_number" in body) {
    if (
      typeof body.week_number !== "number" ||
      !Number.isInteger(body.week_number) ||
      body.week_number < 1
    ) {
      return NextResponse.json({ error: "week_number must be a positive integer" }, { status: 400 });
    }
    patch.week_number = body.week_number;
  }
  if (patch.starts_on && patch.ends_on && patch.ends_on < patch.starts_on) {
    return NextResponse.json({ error: "ends_on must be on or after starts_on" }, { status: 400 });
  }
  if ("theme" in body) patch.theme = cleanText(body.theme, 200);
  if ("details" in body) patch.details = cleanText(body.details, 2000);
  if ("rationale" in body) patch.rationale = cleanText(body.rationale, 2000);
  if ("strategyBrief" in body || "strategy_brief" in body) {
    const strategyBrief = parseStrategyBrief(body.strategyBrief ?? body.strategy_brief);
    if (strategyBrief === "invalid") {
      return NextResponse.json(
        { error: "strategyBrief must contain exactly six non-empty string fields" },
        { status: 400 },
      );
    }
    patch.strategyBrief = strategyBrief;
  }

  const result = await updatePeriod({ periodId, firmId, patch });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, period: result.period });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const { firmId, periodId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  const result = await deletePeriod({ periodId, firmId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
