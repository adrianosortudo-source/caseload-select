/**
 * Agency CRM (Layer B): parse a pasted prospect blob into import rows.
 *
 * Pure module (no 'server-only'): the operator import panel and the server both
 * stay decoupled from the format. Accepts a JSON array / {firms|rows|data}
 * wrapper / single object, or CSV with a header row. Header + JSON keys are
 * aliased onto the canonical ProspectInput field names; the server lib
 * (importProspects) does the real validation + dedupe.
 */

export interface ParsedProspectsResult {
  rows: Record<string, unknown>[]; // normalized rows ready to POST
  withFirmName: number;            // how many carry a usable firm_name
  format: 'json' | 'csv' | 'empty';
  error: string | null;
}

// Canonical field -> accepted header/key aliases (all lowercased).
const FIELD_ALIASES: Record<string, string[]> = {
  firm_name: ['firm_name', 'firm', 'firm name', 'company', 'organisation', 'organization'],
  contact_name: ['contact_name', 'contact', 'contact name', 'lawyer', 'principal'],
  contact_email: ['contact_email', 'email', 'e-mail', 'mail'],
  contact_phone: ['contact_phone', 'phone', 'telephone', 'tel', 'phone number'],
  city: ['city', 'town', 'municipality'],
  practice_area: ['practice_area', 'practice_areas', 'practice area', 'practice', 'area'],
  source: ['source'],
  stage: ['stage'],
  fit_score: ['fit_score', 'fit', 'score'],
  notes: ['notes', 'note', 'comment', 'comments'],
};

function normalizeKey(k: string): string {
  return k.trim().toLowerCase();
}

/** Map an arbitrary object's keys onto the canonical fields, dropping unknowns. */
function normalizeRow(obj: Record<string, unknown>): Record<string, unknown> {
  const lookup = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) lookup.set(normalizeKey(k), v);
  const out: Record<string, unknown> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      if (lookup.has(alias)) {
        const v = lookup.get(alias);
        if (field === 'fit_score') {
          const n = typeof v === 'number' ? v : Number(String(v).trim());
          if (Number.isFinite(n)) out.fit_score = n;
        } else {
          out[field] = typeof v === 'string' ? v.trim() : v;
        }
        break;
      }
    }
  }
  return out;
}

/** Tokenize CSV text into rows of fields. Handles quotes, "" escapes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function extractArray(parsed: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(parsed)) return parsed.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    for (const key of ['firms', 'rows', 'data', 'prospects']) {
      if (Array.isArray(o[key])) return (o[key] as unknown[]).filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
    }
    return [o]; // a single object is one prospect
  }
  return null;
}

export function parseProspectsPaste(text: string): ParsedProspectsResult {
  const trimmed = text.trim();
  if (!trimmed) return { rows: [], withFirmName: 0, format: 'empty', error: null };

  const looksJson = trimmed[0] === '[' || trimmed[0] === '{';
  if (looksJson) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); }
    catch { return { rows: [], withFirmName: 0, format: 'json', error: 'Could not parse JSON.' }; }
    const arr = extractArray(parsed);
    if (!arr) return { rows: [], withFirmName: 0, format: 'json', error: 'JSON must be an array of objects or an object with a firms/rows/data array.' };
    const rows = arr.map(normalizeRow);
    return finalize(rows, 'json');
  }

  // CSV
  const table = parseCsv(trimmed);
  if (table.length < 2) {
    return { rows: [], withFirmName: 0, format: 'csv', error: 'CSV needs a header row and at least one data row.' };
  }
  const headers = table[0].map(normalizeKey);
  const rows = table.slice(1).map((cells) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => { if (h) obj[h] = cells[i] ?? ''; });
    return normalizeRow(obj);
  });
  return finalize(rows, 'csv');
}

function finalize(rows: Record<string, unknown>[], format: 'json' | 'csv'): ParsedProspectsResult {
  const withFirmName = rows.filter((r) => typeof r.firm_name === 'string' && (r.firm_name as string).trim() !== '').length;
  const error = withFirmName === 0 ? 'No rows have a firm_name. Add a "firm_name" column or key.' : null;
  return { rows, withFirmName, format, error };
}
