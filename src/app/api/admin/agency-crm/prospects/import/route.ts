/**
 * /api/admin/agency-crm/prospects/import
 * Operator-only. Bulk-import prospects from external data (toronto_law_firms
 * export, Outscraper, CSV converted to rows). Body: { rows: ProspectInput[] }.
 * Dedupe + insert happen in the service-role lib; this route only gates + bounds.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { importProspects } from '@/lib/agency-prospect-import';

const MAX_ROWS = 10000;

export async function POST(req: NextRequest) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const rows = body && typeof body === 'object' && Array.isArray((body as { rows?: unknown }).rows)
    ? (body as { rows: unknown[] }).rows
    : null;
  if (!rows) return NextResponse.json({ error: 'rows[] is required' }, { status: 400 });
  if (rows.length === 0) return NextResponse.json({ error: 'rows[] is empty' }, { status: 400 });
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `too many rows (max ${MAX_ROWS} per request)` }, { status: 400 });
  }

  try {
    const result = await importProspects(rows);
    // A partial insert failure must not read as success: surface a non-2xx with
    // the full result (counts + errors) so the operator sees what landed.
    if (result.errors.length > 0) {
      return NextResponse.json(
        { ...result, error: `${result.errors.length} insert chunk(s) failed; ${result.inserted} of ${result.received} rows imported` },
        { status: 502 },
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
