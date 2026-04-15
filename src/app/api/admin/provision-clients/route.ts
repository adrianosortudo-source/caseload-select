/**
 * POST /api/admin/provision-clients
 *
 * Idempotent provisioning for all live client firms in CLIENT_CONFIGS.
 * Creates the firm if it doesn't exist, refreshes question_sets if it does.
 * Uses the config's `slug` stored in the description field as a stable identity key.
 *
 * Authentication: requires ADMIN_SECRET header matching ADMIN_API_SECRET env var.
 *
 * Optional body: { slug: "sakuraba-law" } — provision only one client.
 *
 * Returns: array of { slug, firmId, action: "created" | "updated" | "skipped" }
 */

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { CLIENT_CONFIGS, buildClientQuestionSets, type ClientConfig } from "@/lib/client-configs";

async function provisionClient(cfg: ClientConfig): Promise<{
  slug: string;
  firmId: string;
  action: "created" | "updated";
}> {
  const questionSets = buildClientQuestionSets(cfg.practice_areas);

  // Look up by name (stable identity)
  const { data: existing } = await supabase
    .from("intake_firms")
    .select("id")
    .eq("name", cfg.name)
    .limit(1)
    .single();

  if (!existing) {
    const { data: created, error } = await supabase
      .from("intake_firms")
      .insert({
        name: cfg.name,
        description: cfg.description,
        location: cfg.location,
        practice_areas: cfg.practice_areas,
        geographic_config: cfg.geographic_config,
        question_sets: questionSets,
        branding: cfg.branding,
        custom_instructions: cfg.custom_instructions ?? null,
      })
      .select("id")
      .single();

    if (error || !created) {
      throw new Error(`Failed to create ${cfg.name}: ${error?.message ?? "no data"}`);
    }

    return { slug: cfg.slug, firmId: created.id, action: "created" };
  }

  // Update question_sets + branding on every run so fixes auto-apply
  const { error: updateError } = await supabase
    .from("intake_firms")
    .update({
      description: cfg.description,
      location: cfg.location,
      practice_areas: cfg.practice_areas,
      geographic_config: cfg.geographic_config,
      question_sets: questionSets,
      branding: cfg.branding,
      custom_instructions: cfg.custom_instructions ?? null,
    })
    .eq("id", existing.id);

  if (updateError) {
    throw new Error(`Failed to update ${cfg.name}: ${updateError.message}`);
  }

  return { slug: cfg.slug, firmId: existing.id, action: "updated" };
}

export async function POST(req: Request) {
  // Auth check
  const adminSecret = process.env.ADMIN_API_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "ADMIN_API_SECRET not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("x-admin-secret");
  if (authHeader !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional: provision only a specific client
  let targetSlug: string | null = null;
  try {
    const body = await req.json();
    targetSlug = body?.slug ?? null;
  } catch {
    // no body — provision all
  }

  const targets = targetSlug
    ? CLIENT_CONFIGS.filter(c => c.slug === targetSlug)
    : CLIENT_CONFIGS;

  if (targetSlug && targets.length === 0) {
    return NextResponse.json({ error: `No client config found for slug: ${targetSlug}` }, { status: 404 });
  }

  const results: Array<{ slug: string; firmId: string; action: string } | { slug: string; error: string }> = [];

  for (const cfg of targets) {
    try {
      const result = await provisionClient(cfg);
      results.push(result);
      console.log(`[provision-clients] ${result.action}: ${cfg.name} → ${result.firmId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ slug: cfg.slug, error: msg });
      console.error(`[provision-clients] FAILED: ${cfg.name} — ${msg}`);
    }
  }

  const hasErrors = results.some(r => "error" in r);
  return NextResponse.json({ results }, { status: hasErrors ? 207 : 200 });
}
