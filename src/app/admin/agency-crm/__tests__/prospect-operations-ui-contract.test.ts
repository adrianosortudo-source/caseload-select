import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveProvisionedPersonEmail } from '../prospect-provisioning';

const surface = resolve(process.cwd(), 'src/app/admin/agency-crm');

function read(name: string): string {
  return readFileSync(resolve(surface, name), 'utf8');
}

describe('prospect operations UI contract', () => {
  it('loads activity history only after a prospect is selected', () => {
    const source = read('ProspectActivityPanel.tsx');
    expect(source).toContain('/api/admin/prospect-operations/conversations/agency/');
    expect(source).toContain("if (!open) return null;");
    expect(source).toContain('data-ui-component-content="prospect-activity-panel"');
    expect(source).toContain('limit=${HISTORY_PAGE_SIZE}&offset=0');
  });

  it('logs confirmed activity through the append-only operator endpoint', () => {
    const source = read('ProspectActivityPanel.tsx');
    expect(source).toContain("fetch('/api/admin/prospect-operations/activities'");
    expect(source).toContain('idempotency_key');
    expect(source).toContain('Saving this record does not send a message.');
    expect(source).toContain("normalizedDeliveryStatus = kind === 'bounce' ? 'bounced'");
    expect(source).toContain("normalizedChannel = kind === 'bounce' ? 'email' : kind === 'meeting' ? 'video'");
  });

  it('provides operator controls for contactability and next action tracking', () => {
    const source = read('ProspectActivityPanel.tsx');
    expect(source).toContain('data-ui-component-content="prospect-contact-controls"');
    expect(source).toContain("method: 'PATCH'");
    expect(source).toContain('next_action_due');
    expect(source).toContain('suppression_reason');
  });

  it('requires an explicit operator action before provisioning a missing source record', () => {
    const source = read('ProspectActivityPanel.tsx');
    expect(source).toContain("/api/admin/prospect-operations/sources/provision");
    expect(source).toContain('source_payload');
    expect(source).toContain('basis: provisioningBasis');
    expect(source).toContain('person: contactName ?');
    expect(source).toContain('primary_email: personEmailForProvisioning');
    expect(source).toContain('idempotency_key: `provision:${sourceSystem}:${sourceRecordKey}`');
    expect(source).toContain('The contact record was provisioned but could not be reloaded.');
    expect(source).toContain('A first-party source URL is required before this record can be provisioned.');
    expect(source).toContain('disabled={provisioning || !canProvisionSource}');
    expect(source).toContain('Provision contact record');
  });

  it('provisions the visible contact email unless the source supplies an explicit person-email decision', () => {
    expect(resolveProvisionedPersonEmail('owner@example.test')).toBe('owner@example.test');
    expect(resolveProvisionedPersonEmail('firm@example.test', 'owner@example.test')).toBe('owner@example.test');
    expect(resolveProvisionedPersonEmail('firm@example.test', null)).toBeNull();
    expect(resolveProvisionedPersonEmail(null)).toBeNull();
  });

  it('uses the report endpoint and governed copy tags', () => {
    const source = read('ProspectOperationsSummary.tsx');
    expect(source).toContain("fetch('/api/admin/prospect-operations/report'");
    expect(source).toContain("{ key: 'human_replies', label: 'Human reply events' }");
    expect(source).not.toContain("{ key: 'replied', label: 'Human replies' }");
    expect(source).toContain('PROSPECT_OPERATIONS_CHANGED_EVENT');
    expect(source).toContain('window.addEventListener');
    expect(source).toContain('data-ui-component-content="prospect-operations-summary"');
    expect(`${read('ProspectActivityPanel.tsx')}\n${source}`).not.toContain('—');
  });

  it('refreshes dependent operator reads after activity and control changes', () => {
    const panel = read('ProspectActivityPanel.tsx');
    const events = read('prospect-operations-events.ts');
    expect(panel.match(/notifyProspectOperationsChanged\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(events).toContain("'caseload:prospect-operations-changed'");
    expect(events).toContain('window.dispatchEvent');
  });
});
