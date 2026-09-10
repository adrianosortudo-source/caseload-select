import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(resolve(process.cwd(), 'src/app/api/admin/prospect-operations/archive-updates/preview/route.ts'), 'utf8');

describe('prospect archive preview route contract', () => {
  it('is operator-only, upload-backed, and has no HighLevel mutation client', () => {
    expect(route).toContain('getOperatorSession');
    expect(route).toContain('listProspectingControlPlaneSources');
    expect(route).toContain('buildArchiveSyncPreview');
    expect(route).not.toMatch(/GHL_CASELOAD_SELECT_TOKEN|services\.leadconnectorhq|fetch\s*\(/);
  });

  it('derives the cohort from source records and enforces the BA/AE 100-record gate', () => {
    expect(route).toContain("record.arm === 'BA' || record.arm === 'AE'");
    expect(route).toContain('sourcePage.total !== 100 || records.length !== 100');
    expect(route).toContain('records.some((record) => !record.highLevel.contactId || !record.conversation?.id)');
  });

  it('keeps preview non-mutating and caps untrusted upload input', () => {
    expect(route).toContain('MAX_REQUEST_BYTES');
    expect(route).toContain('MAX_EVENTS');
    expect(route).toContain('database_writes: 0');
    expect(route).toContain('highlevel_writes: 0');
    expect(route).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(/);
  });
});
