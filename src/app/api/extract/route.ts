import { NextResponse } from "next/server";
import { llmExtractServer } from "@/lib/screen-llm-server";
import { initialiseState } from "@/lib/screen-engine/extractor";
import type { MatterType } from "@/lib/screen-engine/types";

interface ExtractRequest {
  description?: string;
  matter_type?: MatterType;
  already_extracted?: Record<string, string | null>;
}

export async function POST(req: Request) {
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

  const state = {
    ...initialiseState(description),
    matter_type: body.matter_type ?? "unknown",
    slots: body.already_extracted ?? {},
  };

  const result = await llmExtractServer(description, state);
  return NextResponse.json(result);
}
