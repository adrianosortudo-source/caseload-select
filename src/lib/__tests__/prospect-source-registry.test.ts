import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));

import {
  executionStateForSource,
  highLevelIdentityFromSourcePayload,
  prospectingArmFromSourcePayload,
} from '@/lib/prospect-source-registry';

describe('prospecting Control Plane source payload', () => {
  it('reads explicit BA and AE labels from direct and provision-wrapped payloads', () => {
    expect(prospectingArmFromSourcePayload({ arm: 'BA' })).toBe('BA');
    expect(prospectingArmFromSourcePayload({ experiment_arm: 'beyond_agency' })).toBe('BA');
    expect(prospectingArmFromSourcePayload({ providedSourcePayload: { method: 'Adam Erhart' } })).toBe('AE');
  });

  it('does not infer an arm from a firm name, email address, domain, or source key', () => {
    expect(prospectingArmFromSourcePayload({
      source_record_key: 'BA-B1-01',
      firm_name: 'Beyond Agency Law',
      email: 'ae@example.ca',
      website: 'https://adam-erhart.example',
    })).toBe('unknown');
  });

  it('keeps database defaults from masquerading as reconciled execution state', () => {
    expect(executionStateForSource({ method: 'beyond_agency' }, 'history_unknown', 'not_contacted')).toEqual({
      historyReconciled: false,
      displayStatus: 'history_not_reconciled',
      currentStage: 'unknown',
      method: 'beyond_agency',
    });
    expect(executionStateForSource({}, 'known_empty', 'not_contacted').displayStatus).toBe('history_not_reconciled');
    expect(executionStateForSource({}, 'evidenced_activity', 'awaiting_reply').displayStatus).toBe('awaiting_reply');
  });

  it('structures only the HighLevel identifiers carried by the immutable payload', () => {
    expect(highLevelIdentityFromSourcePayload({ providedSourcePayload: { highlevel: {
      location_id: 'location-1', contact_id: 'contact-1', smart_list_id: 'list-1', workflow_ids: ['wf-1', 'wf-2'],
    } } })).toEqual({
      locationId: 'location-1', contactId: 'contact-1', smartListId: 'list-1', workflowIds: ['wf-1', 'wf-2'],
    });
  });
});
