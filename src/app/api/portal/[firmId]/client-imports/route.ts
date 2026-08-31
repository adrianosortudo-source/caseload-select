import { randomUUID } from "crypto";
import { isIP } from "net";
import { NextRequest, NextResponse } from "next/server";
import { CLIENT_IMPORT_MAX_FILE_BYTES, CLIENT_IMPORT_TEMPLATE_VERSION } from "@/lib/client-import-csv";
import {
  CLIENT_IMPORT_AUTHORIZATION_POLICY_VERSION,
  CLIENT_IMPORT_AUTHORIZATION_TEXT,
  guardClientImportWrite,
  importFeatureGate,
} from "@/lib/client-import-server";
import { ipFromRequest } from "@/lib/rate-limit";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export async function POST(req: NextRequest, { params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params;
  const guard = await guardClientImportWrite(req, firmId);
  if (!guard.ok) {
    if (guard.response) return guard.response;
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const gate = importFeatureGate(guard.config);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 503 });
  let body: {
    challengeId?: unknown;
    fileSha256?: unknown;
    fileByteCount?: unknown;
    rowCount?: unknown;
    templateVersion?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const rowCount = Number(body.rowCount);
  const fileByteCount = Number(body.fileByteCount);
  if (typeof body.challengeId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.challengeId)) {
    return NextResponse.json({ error: "valid_challenge_required" }, { status: 400 });
  }
  if (typeof body.fileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.fileSha256)) {
    return NextResponse.json({ error: "valid_file_hash_required" }, { status: 400 });
  }
  if (!Number.isInteger(fileByteCount) || fileByteCount < 1 || fileByteCount > CLIENT_IMPORT_MAX_FILE_BYTES) {
    return NextResponse.json({ error: "invalid_file_size" }, { status: 400 });
  }
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > guard.config.maxRows) {
    return NextResponse.json({ error: "invalid_row_count" }, { status: 400 });
  }
  if (body.templateVersion !== CLIENT_IMPORT_TEMPLATE_VERSION) {
    return NextResponse.json({ error: "unsupported_template_version" }, { status: 400 });
  }

  const id = randomUUID();
  const requestIp = ipFromRequest(req);
  const { data, error } = await supabase.rpc("create_secure_client_import_batch", {
    p_batch_id: id,
    p_challenge_id: body.challengeId,
    p_firm_id: firmId,
    p_lawyer_id: guard.actor.id,
    p_file_sha256: body.fileSha256,
    p_file_byte_count: fileByteCount,
    p_template_version: CLIENT_IMPORT_TEMPLATE_VERSION,
    p_declared_row_count: rowCount,
    p_policy_version: CLIENT_IMPORT_AUTHORIZATION_POLICY_VERSION,
    p_authorization_text: CLIENT_IMPORT_AUTHORIZATION_TEXT,
    p_source_ip: isIP(requestIp) ? requestIp : null,
    p_user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? "",
  });
  if (error) return NextResponse.json({ error: "batch_create_failed" }, { status: 500 });
  const result = Array.isArray(data) ? data[0] as { outcome?: unknown; batch_id?: unknown } | undefined : undefined;
  const outcome = typeof result?.outcome === "string" ? result.outcome : "batch_create_failed";
  if (outcome !== "ok") {
    const status = outcome === "challenge_not_found" ? 404 : outcome === "challenge_expired" ? 410 : 409;
    return NextResponse.json({ error: outcome }, { status });
  }
  return NextResponse.json({ ok: true, batchId: id, rowCount });
}
