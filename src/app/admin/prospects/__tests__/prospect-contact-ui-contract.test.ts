import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const surface = resolve(process.cwd(), 'src/app/admin/prospects');

function read(name: string): string {
  return readFileSync(resolve(surface, name), 'utf8');
}

describe('prospect list contact tracking UI contract', () => {
  it('uses stable GTA source keys and one batched status request', () => {
    const source = read('ReconciledProspects.tsx');
    expect(source).toContain("GTA_PROSPECT_SOURCE_SYSTEM");
    expect(source).toContain('record.id');
    expect(source).toContain('selectedOperationalContact?.email');
    expect(source).toContain('Contact</th>');
    expect(read('ProspectContactStatus.tsx')).toContain('View history');
  });

  it('uses the Brazilian cohort source record id without inventing a fallback key', () => {
    const source = read('BrazilianProspects.tsx');
    expect(source).toContain('row.sourceRecordId');
    expect(source).toContain('BRAZILIAN_PROSPECT_SOURCE_SYSTEM');
    expect(source).toContain('sourceRecordKey={row.sourceRecordId}');
    expect(source).toContain('Contact</th>');
  });

  it('keeps generic status and history requests behind the shared API boundary', () => {
    const source = read('prospect-contact-operations.ts');
    expect(source).toContain("/api/admin/prospect-operations/source-states");
    expect(source).toContain('source_record_keys: batch');
    expect(source).toContain('SOURCE_STATE_BATCH_SIZE = 100');
    expect(source).toContain('keys.slice(index, index + SOURCE_STATE_BATCH_SIZE)');
    expect(source).toContain('Promise.all(batches.map');
    expect(source).toContain('/api/admin/prospect-operations/conversations/source?source_system=');
  });

  it('marks new visible copy for UI quality auditing and avoids em dashes', () => {
    const source = [
      read('ProspectContactStatus.tsx'),
      read('prospect-contact-operations.ts'),
      read('ReconciledProspects.tsx'),
      read('BrazilianProspects.tsx'),
    ].join('\n');
    expect(source).toContain('data-ui-component-content="prospect-contact-status"');
    expect(source).not.toContain('—');
  });

  it('applies the controlled status palette instead of a neutral badge for every state', () => {
    const source = read('ProspectContactStatus.tsx');
    expect(source).toContain('STATUS_CLASSES[state.status]');
    expect(source).toContain('${statusClass}');
  });
});
