import { describe, it, expect } from 'vitest';
import { parseCsv, mapCsvRowsToImportRows, computeShadowVsGhlDiff } from '@/lib/ghl-send-import-pure';

describe('parseCsv', () => {
  it('parses a simple header + rows', () => {
    const csv = 'a,b,c\n1,2,3\n4,5,6';
    expect(parseCsv(csv)).toEqual([['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']]);
  });

  it('handles quoted fields containing commas', () => {
    const csv = 'a,b\n"hello, world",2';
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['hello, world', '2']]);
  });

  it('handles escaped double quotes inside quoted fields', () => {
    const csv = 'a\n"she said ""hi"""';
    expect(parseCsv(csv)).toEqual([['a'], ['she said "hi"']]);
  });

  it('handles CRLF and lone CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\r1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('drops blank trailing lines', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('returns empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('mapCsvRowsToImportRows', () => {
  it('maps a well-formed CSV into import rows', () => {
    const csv = parseCsv([
      'cadence_key,matter_id,screened_lead_id,step_number,sent_at,recipient_email,subject',
      'J9,m-1,l-1,1,2026-07-01T00:00:00.000Z,a@example.com,Thank you',
    ].join('\n'));
    const { rows, errors } = mapCsvRowsToImportRows(csv, 'firm-1', 'operator');
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      firm_id: 'firm-1',
      cadence_key: 'J9',
      matter_id: 'm-1',
      screened_lead_id: 'l-1',
      step_number: 1,
      recipient_email: 'a@example.com',
      subject: 'Thank you',
      imported_by: 'operator',
    });
    expect(rows[0].sent_at).toBe('2026-07-01T00:00:00.000Z');
    expect(rows[0].source_row.cadence_key).toBe('J9');
  });

  it('rejects a CSV missing required columns', () => {
    const csv = parseCsv('matter_id,recipient_email\nm-1,a@example.com');
    const { rows, errors } = mapCsvRowsToImportRows(csv, 'firm-1', null);
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/Missing required column/);
  });

  it('reports and skips a row missing cadence_key', () => {
    const csv = parseCsv('cadence_key,sent_at\n,2026-07-01T00:00:00.000Z');
    const { rows, errors } = mapCsvRowsToImportRows(csv, 'firm-1', null);
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/missing cadence_key/);
  });

  it('reports and skips a row with an unparseable sent_at', () => {
    const csv = parseCsv('cadence_key,sent_at\nJ9,not-a-date');
    const { rows, errors } = mapCsvRowsToImportRows(csv, 'firm-1', null);
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/unparseable sent_at/);
  });

  it('treats step_number as optional and null when absent or non-numeric', () => {
    const csv = parseCsv('cadence_key,sent_at,step_number\nJ9,2026-07-01T00:00:00.000Z,abc');
    const { rows } = mapCsvRowsToImportRows(csv, 'firm-1', null);
    expect(rows[0].step_number).toBeNull();
  });

  it('processes remaining valid rows even when one row errors', () => {
    const csv = parseCsv([
      'cadence_key,sent_at',
      'J9,2026-07-01T00:00:00.000Z',
      ',bad',
      'J11,2026-07-02T00:00:00.000Z',
    ].join('\n'));
    const { rows, errors } = mapCsvRowsToImportRows(csv, 'firm-1', null);
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  it('returns an error for an empty CSV', () => {
    expect(mapCsvRowsToImportRows([], 'firm-1', null).errors[0]).toMatch(/empty/i);
  });
});

describe('computeShadowVsGhlDiff', () => {
  it('buckets by day and cadence_key, computing shadow minus ghl delta', () => {
    const shadow = [
      { cadence_key: 'J9', sent_or_scheduled_for: '2026-07-01T08:00:00.000Z' },
      { cadence_key: 'J9', sent_or_scheduled_for: '2026-07-01T09:00:00.000Z' },
      { cadence_key: 'J6', sent_or_scheduled_for: '2026-07-01T10:00:00.000Z' },
    ];
    const ghl = [
      { cadence_key: 'J9', sent_or_scheduled_for: '2026-07-01T08:30:00.000Z' },
    ];
    const buckets = computeShadowVsGhlDiff(shadow, ghl);
    expect(buckets).toHaveLength(2);
    const j9 = buckets.find((b) => b.cadence_key === 'J9')!;
    expect(j9).toMatchObject({ day: '2026-07-01', shadow_count: 2, ghl_count: 1, delta: 1 });
    const j6 = buckets.find((b) => b.cadence_key === 'J6')!;
    expect(j6).toMatchObject({ day: '2026-07-01', shadow_count: 1, ghl_count: 0, delta: 1 });
  });

  it('includes a bucket that exists only on the GHL side', () => {
    const buckets = computeShadowVsGhlDiff([], [{ cadence_key: 'J7', sent_or_scheduled_for: '2026-07-03T00:00:00.000Z' }]);
    expect(buckets).toEqual([{ day: '2026-07-03', cadence_key: 'J7', shadow_count: 0, ghl_count: 1, delta: -1 }]);
  });

  it('returns an empty array when both sides are empty', () => {
    expect(computeShadowVsGhlDiff([], [])).toEqual([]);
  });

  it('sorts by day then cadence_key', () => {
    const shadow = [
      { cadence_key: 'J9', sent_or_scheduled_for: '2026-07-02T00:00:00.000Z' },
      { cadence_key: 'J6', sent_or_scheduled_for: '2026-07-01T00:00:00.000Z' },
      { cadence_key: 'J11', sent_or_scheduled_for: '2026-07-01T00:00:00.000Z' },
    ];
    const buckets = computeShadowVsGhlDiff(shadow, []);
    expect(buckets.map((b) => `${b.day}:${b.cadence_key}`)).toEqual([
      '2026-07-01:J11', '2026-07-01:J6', '2026-07-02:J9',
    ]);
  });
});
