import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(resolve(process.cwd(), 'src/app/api/admin/prospect-operations/archive-updates/apply/route.ts'), 'utf8');

describe('prospect archive reviewed apply route contract', () => {
  it('is operator-only and requires a server-issued review permit', () => {
    expect(route).toContain('getOperatorSession');
    expect(route).toContain('session?.lawyer_id');
    expect(route).toContain('review_permit');
    expect(route).toContain('server-issued review permit');
  });

  it('uses the bounded persistence layer without a HighLevel client', () => {
    expect(route).toContain('applyReviewedArchiveSyncBundle');
    expect(route).not.toMatch(/GHL_CASELOAD_SELECT_TOKEN|services\.leadconnectorhq|fetch\s*\(/);
    expect(route).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
  });
});
