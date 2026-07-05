/**
 * Pure helpers for the shadow-vs-GHL diff scaffold (CaseLoad_CRM_Migration_Plan_v1.md
 * Phase 2 rail 1). An operator exports GHL's actual send log for a firm/cadence
 * as CSV and uploads it; this module parses that CSV into ghl_send_imports rows
 * and computes the day-by-day comparison against the shadow ledger
 * (outbound_messages). No I/O; the caller does the Supabase read/write.
 *
 * CSV columns (header row required, order-independent):
 *   cadence_key, matter_id, screened_lead_id, step_number, sent_at,
 *   recipient_email, subject
 * Only cadence_key and sent_at are required per row; the rest may be blank.
 */

/** Minimal RFC4180-ish CSV parser: quoted fields, escaped "" inside quotes, commas inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const chars = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (inQuotes) {
      if (c === '"') {
        if (chars[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export interface GhlImportRow {
  firm_id: string;
  cadence_key: string | null;
  matter_id: string | null;
  screened_lead_id: string | null;
  step_number: number | null;
  sent_at: string | null;
  recipient_email: string | null;
  subject: string | null;
  source_row: Record<string, string>;
  imported_by: string | null;
}

export interface MapCsvResult {
  rows: GhlImportRow[];
  errors: string[]; // 1-indexed data-row error messages (header excluded)
}

const REQUIRED_COLUMNS = ['cadence_key', 'sent_at'];
const KNOWN_COLUMNS = ['cadence_key', 'matter_id', 'screened_lead_id', 'step_number', 'sent_at', 'recipient_email', 'subject'];

/**
 * Maps parsed CSV rows (header + data) into ghl_send_imports insert rows.
 * A row missing a required column, or with an unparseable sent_at, is
 * skipped and reported in `errors` rather than silently dropped.
 */
export function mapCsvRowsToImportRows(
  csvRows: string[][],
  firmId: string,
  importedBy: string | null,
): MapCsvResult {
  if (csvRows.length === 0) return { rows: [], errors: ['CSV is empty'] };

  const header = csvRows[0].map((h) => h.trim().toLowerCase());
  const missingRequired = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missingRequired.length > 0) {
    return { rows: [], errors: [`Missing required column(s): ${missingRequired.join(', ')}`] };
  }

  const colIndex = (name: string) => header.indexOf(name);
  const rows: GhlImportRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < csvRows.length; i++) {
    const raw = csvRows[i];
    const get = (name: string): string | null => {
      const idx = colIndex(name);
      if (idx < 0 || idx >= raw.length) return null;
      const v = raw[idx].trim();
      return v === '' ? null : v;
    };

    const cadenceKey = get('cadence_key');
    const sentAtRaw = get('sent_at');
    if (!cadenceKey) { errors.push(`Row ${i + 1}: missing cadence_key`); continue; }
    if (!sentAtRaw) { errors.push(`Row ${i + 1}: missing sent_at`); continue; }
    const sentAt = new Date(sentAtRaw);
    if (Number.isNaN(sentAt.getTime())) { errors.push(`Row ${i + 1}: unparseable sent_at "${sentAtRaw}"`); continue; }

    const stepRaw = get('step_number');
    const stepNumber = stepRaw !== null && /^\d+$/.test(stepRaw) ? parseInt(stepRaw, 10) : null;

    const sourceRow: Record<string, string> = {};
    for (const col of KNOWN_COLUMNS) {
      const v = get(col);
      if (v !== null) sourceRow[col] = v;
    }

    rows.push({
      firm_id: firmId,
      cadence_key: cadenceKey,
      matter_id: get('matter_id'),
      screened_lead_id: get('screened_lead_id'),
      step_number: stepNumber,
      sent_at: sentAt.toISOString(),
      recipient_email: get('recipient_email'),
      subject: get('subject'),
      source_row: sourceRow,
      imported_by: importedBy,
    });
  }

  return { rows, errors };
}

// ── Diff computation ───────────────────────────────────────────────────────

export interface DiffInputRow {
  cadence_key: string | null;
  sent_or_scheduled_for: string; // ISO timestamp
}

export interface DiffDayBucket {
  day: string; // YYYY-MM-DD (UTC)
  cadence_key: string;
  shadow_count: number;
  ghl_count: number;
  delta: number; // shadow_count - ghl_count
}

/**
 * Buckets shadow-ledger rows and GHL-imported rows by (cadence_key, UTC day)
 * and returns one comparison row per bucket present in either side. Sorted by
 * day then cadence_key for stable rendering.
 */
export function computeShadowVsGhlDiff(
  shadowRows: DiffInputRow[],
  ghlRows: DiffInputRow[],
): DiffDayBucket[] {
  const key = (r: DiffInputRow) => {
    const day = r.sent_or_scheduled_for.slice(0, 10);
    return `${day}::${r.cadence_key ?? 'unknown'}`;
  };

  const shadowCounts = new Map<string, number>();
  for (const r of shadowRows) shadowCounts.set(key(r), (shadowCounts.get(key(r)) ?? 0) + 1);

  const ghlCounts = new Map<string, number>();
  for (const r of ghlRows) ghlCounts.set(key(r), (ghlCounts.get(key(r)) ?? 0) + 1);

  const allKeys = new Set([...shadowCounts.keys(), ...ghlCounts.keys()]);
  const buckets: DiffDayBucket[] = [];
  for (const k of allKeys) {
    const [day, cadenceKey] = k.split('::');
    const shadow = shadowCounts.get(k) ?? 0;
    const ghl = ghlCounts.get(k) ?? 0;
    buckets.push({ day, cadence_key: cadenceKey, shadow_count: shadow, ghl_count: ghl, delta: shadow - ghl });
  }

  buckets.sort((a, b) => (a.day === b.day ? a.cadence_key.localeCompare(b.cadence_key) : a.day.localeCompare(b.day)));
  return buckets;
}
