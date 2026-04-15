/**
 * GET /api/screen/resume?session_id=xxx
 *
 * Returns the current state of an existing intake session so the widget
 * can restore the user to the correct step instead of restarting from scratch.
 *
 * Used by the "Welcome back" resume flow in IntakeWidget.tsx.
 */

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const { data: session, error } = await supabase
    .from("intake_sessions")
    .select("id, practice_area, band, scoring, status, contact, extracted_entities, situation_summary")
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Derive which step the widget should resume at
  const scoring = (session.scoring as Record<string, unknown>) ?? {};
  const confirmedAnswers = (scoring._confirmed as Record<string, unknown>) ?? {};
  const questionsAnswered = Object.keys(confirmedAnswers);
  const contact = session.contact as Record<string, unknown> | null;
  const hasContact = !!(contact?.email || contact?.phone);
  const isComplete = session.status === "complete";

  let stepHint: "intro" | "questions" | "identity" | "result";
  if (isComplete) {
    stepHint = "result";
  } else if (hasContact) {
    stepHint = "result";
  } else if (questionsAnswered.length > 0) {
    stepHint = "identity";
  } else if (session.practice_area) {
    stepHint = "questions";
  } else {
    stepHint = "intro";
  }

  return NextResponse.json({
    session_id: session.id,
    practice_area: session.practice_area ?? null,
    band: session.band ?? null,
    questions_answered: questionsAnswered,
    step_hint: stepHint,
    situation_summary: session.situation_summary ?? null,
    cpi: scoring,
  });
}
