/**
 * POST /api/admin/conflict-register/import
 *
 * Bulk-imports a client list into the conflict_register table for a firm.
 * Called during onboarding when Adriano loads a firm's historical client export.
 *
 * Accepts JSON body (not raw CSV — the operator pre-processes the file):
 * {
 *   firm_id: string,
 *   rows: Array<{
 *     client_name: string,     // required
 *     opposing_party?: string,
 *     matter_type?: string,
 *     email?: string,
 *     phone?: string,
 *   }>
 * }
 *
 * Idempotency: skips rows where (firm_id + client_name + email) already exists.
 * Upserts by client_name + email combination to allow re-imports without duplication.
 *
 * Auth: Bearer CRON_SECRET (operator only)
 *
 * Returns:
 *   { imported: number, skipped: number, total: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface ImportRow {
  client_name: string;
  opposing_party?: string;
  matter_type?: string;
  email?: string;
  phone?: string;
}

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { firm_id: string; rows: ImportRow[] };

  if (!body.firm_id || !Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json(
      { error: "firm_id and rows[] are required" },
      { status: 400 }
    );
  }

  // Validate: every row must have client_name
  const invalid = body.rows.filter((r) => !r.client_name?.trim());
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `${invalid.length} row(s) missing client_name` },
      { status: 400 }
    );
  }

  // Load existing entries to check idempotency
  const { data: existing } = await supabase
    .from("conflict_register")
    .select("client_name, email")
    .eq("law_firm_id", body.firm_id)
    .eq("source", "csv_import");

  const existingKeys = new Set(
    (existing ?? []).map((r) =>
      `${r.client_name.toLowerCase()}|${(r.email ?? "").toLowerCase()}`
    )
  );

  const toInsert: object[] = [];
  let skipped = 0;

  for (const row of body.rows) {
    const key = `${row.client_name.toLowerCase()}|${(row.email ?? "").toLowerCase()}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    toInsert.push({
      law_firm_id: body.firm_id,
      client_name: row.client_name.trim(),
      opposing_party: row.opposing_party?.trim() ?? null,
      matter_type: row.matter_type?.trim() ?? null,
      email: row.email?.trim().toLowerCase() ?? null,
      phone: row.phone?.trim() ?? null,
      source: "csv_import",
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped,
      total: body.rows.length,
      message: "All rows already exist. Nothing imported.",
    });
  }

  // Insert in batches of 100 to avoid payload limits
  const BATCH = 100;
  let imported = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error } = await supabase.from("conflict_register").insert(batch);
    if (error) {
      console.error("Conflict register import error:", error);
      return NextResponse.json(
        { error: `Batch ${Math.floor(i / BATCH) + 1} failed: ${error.message}`, imported },
        { status: 500 }
      );
    }
    imported += batch.length;
  }

  return NextResponse.json({
    imported,
    skipped,
    total: body.rows.length,
    message: `Imported ${imported} record(s) into the conflict register for firm ${body.firm_id}.`,
  });
}
