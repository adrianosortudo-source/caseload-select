/**
 * POST /api/portal/[firmId]/periods
 *
 * Operator-only. Create a content-plan week (date range + theme + details +
 * rationale). The firm reads these; only the operator authors them.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { createPeriod } from "@/lib/deliverables";
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: {
    week_number?: unknown;
    starts_on?: unknown;
    ends_on?: unknown;
    theme?: unknown;
    details?: unknown;
    rationale?: unknown;
    strategyBrief?: unknown;
    strategy_brief?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const startsOn =
    typeof body.starts_on === "string" && DATE_RE.test(body.starts_on) ? body.starts_on : null;
  const endsOn =
    typeof body.ends_on === "string" && DATE_RE.test(body.ends_on) ? body.ends_on : null;
  if (!startsOn || !endsOn) {
    return NextResponse.json(
      { error: "starts_on and ends_on (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }
  if (endsOn < startsOn) {
    return NextResponse.json({ error: "ends_on must be on or after starts_on" }, { status: 400 });
  }

  const weekNumber =
    typeof body.week_number === "number" && Number.isInteger(body.week_number) && body.week_number > 0
      ? body.week_number
      : null;
  const strategyBrief = parseStrategyBrief(body.strategyBrief ?? body.strategy_brief);
  if (strategyBrief === "invalid") {
    return NextResponse.json(
      { error: "strategyBrief must contain exactly six non-empty string fields" },
      { status: 400 },
    );
  }

  const result = await createPeriod({
    firmId,
    weekNumber,
    startsOn,
    endsOn,
    theme: cleanText(body.theme, 200),
    details: cleanText(body.details, 2000),
    rationale: cleanText(body.rationale, 2000),
    strategyBrief,
    actor: resolved.actor,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, period: result.period });
}
