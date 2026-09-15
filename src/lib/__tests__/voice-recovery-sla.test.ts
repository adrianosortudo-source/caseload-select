import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));
import { buildVoiceRecoverySlaEmail, isVoiceRecoverySlaEscalationDue } from '../voice-recovery-sla';
import { computeVoiceRecoverySlaDueAt } from '../voice-recovery';

describe('voice recovery acknowledgement SLA', () => {
  const now = new Date('2026-08-17T16:00:00.000Z');

  it('gives urgent recovery cases a shorter acknowledgement deadline', () => {
    expect(computeVoiceRecoverySlaDueAt('urgent', now)).toBe('2026-08-17T16:15:00.000Z');
    expect(computeVoiceRecoverySlaDueAt('normal', now)).toBe('2026-08-17T20:00:00.000Z');
  });

  it('escalates only an overdue, still-open, never-acknowledged case', () => {
    const due = { status: 'open', acknowledged_at: null, sla_due_at: '2026-08-17T15:59:59.000Z', acknowledgement_sla_escalated_at: null };
    expect(isVoiceRecoverySlaEscalationDue(due, now)).toBe(true);
    expect(isVoiceRecoverySlaEscalationDue({ ...due, acknowledged_at: now.toISOString() }, now)).toBe(false);
    expect(isVoiceRecoverySlaEscalationDue({ ...due, acknowledgement_sla_escalated_at: now.toISOString() }, now)).toBe(false);
    expect(isVoiceRecoverySlaEscalationDue({ ...due, status: 'resolved' }, now)).toBe(false);
  });

  it('builds an escalation with a queue CTA but no transcript content', () => {
    const email = buildVoiceRecoverySlaEmail({
      caseId: 'case-1', firmId: 'firm-1', firmName: 'DRG Law', callerName: 'Alex',
      disposition: 'incomplete', urgency: 'urgent', slaDueAt: '2026-08-17T16:15:00.000Z',
      triageUrl: 'https://app.example.test/portal/firm-1/triage?view=recovery',
    });
    expect(email.subject).toMatch(/acknowledgement overdue/i);
    expect(email.html).toContain('view=recovery');
    expect(email.html).not.toMatch(/raw transcript/i);
  });
});
