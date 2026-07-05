/**
 * POST /api/admin/cadence-shadow/import
 *
 * Uploads an operator-exported CSV of GHL's actual cadence sends for one firm
 * into ghl_send_imports, the diff scaffold for the shadow cadence engine
 * (CaseLoad_CRM_Migration_Plan_v1.md Phase 2). The /admin/cadence-shadow page
 * compares these rows against the shadow ledger (outbound_messages) so the
 * operator can see whether the in-house cadence engine's would-be sends line
 * up with what GHL actually sent, before any rail cutover is discussed.
 *
 * Auth (operator scope, DR-063 "the route is the gate"):
 *   - Bearer CRON_SECRET / PG_CRON_TOKEN, or an operator session cookie.
 *
 * Body: multipart/form-data, fields `file` (CSV) + `firm_id`.
 * CSV columns: cadence_key, sent_at required; matter_id, screened_lead_id,
 * step_number, recipient_email, subject optional. See ghl-send-import-pure.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { parseCsv, mapCsvRowsToImportRows } from '@/lib/ghl-send-import-pure';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const cronAuthed = isCronAuthorized(req);
  const operatorSession = cronAuthed ? null : await getOperatorSession();
  if (!cronAuthed && !operatorSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 });
  }

  const form = await req.formData();
  const fileEntry = form.get('file');
  const firmId = (form.get('firm_id') as string | null) ?? '';
  if (!(fileEntry instanceof Blob)) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (!firmId) {
    return NextResponse.json({ error: 'firm_id is required' }, { status: 400 });
  }

  const text = await fileEntry.text();
  const csvRows = parseCsv(text);
  const importedBy = operatorSession ? 'operator' : 'cron';
  const { rows, errors } = mapCsvRowsToImportRows(csvRows, firmId, importedBy);

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, errors: errors.length > 0 ? errors : ['No valid rows found'] }, { status: 400 });
  }

  const { error: insertError } = await supabase.from('ghl_send_imports').insert(rows);
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: rows.length, errors });
}
