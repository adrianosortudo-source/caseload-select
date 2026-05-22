import { describe, it, expect } from 'vitest';
import {
  validateStageTransition,
  journeyTriggerForTransition,
  nextStage,
  canAdvanceStage,
} from '../matter-stage-pure';

describe('validateStageTransition', () => {
  it('accepts each legal forward transition', () => {
    expect(validateStageTransition('intake', 'retainer_pending')).toBe(true);
    expect(validateStageTransition('retainer_pending', 'active')).toBe(true);
    expect(validateStageTransition('active', 'closing')).toBe(true);
    expect(validateStageTransition('closing', 'closed')).toBe(true);
  });

  it('rejects same-stage no-op', () => {
    expect(validateStageTransition('intake', 'intake')).toBe(false);
    expect(validateStageTransition('active', 'active')).toBe(false);
  });

  it('rejects every reverse transition', () => {
    expect(validateStageTransition('retainer_pending', 'intake')).toBe(false);
    expect(validateStageTransition('active', 'retainer_pending')).toBe(false);
    expect(validateStageTransition('closing', 'active')).toBe(false);
    expect(validateStageTransition('closed', 'closing')).toBe(false);
  });

  it('rejects stage-skipping transitions', () => {
    expect(validateStageTransition('intake', 'active')).toBe(false);
    expect(validateStageTransition('intake', 'closing')).toBe(false);
    expect(validateStageTransition('intake', 'closed')).toBe(false);
    expect(validateStageTransition('retainer_pending', 'closing')).toBe(false);
    expect(validateStageTransition('active', 'closed')).toBe(false);
  });

  it('rejects any transition from the terminal closed stage', () => {
    expect(validateStageTransition('closed', 'intake')).toBe(false);
    expect(validateStageTransition('closed', 'active')).toBe(false);
    expect(validateStageTransition('closed', 'closed')).toBe(false);
  });
});

describe('journeyTriggerForTransition', () => {
  it('maps each forward transition to its journey cadence', () => {
    expect(journeyTriggerForTransition('intake', 'retainer_pending')).toBe('retainer_awaiting');
    expect(journeyTriggerForTransition('retainer_pending', 'active')).toBe('client_won');
    expect(journeyTriggerForTransition('active', 'closing')).toBe('review_request');
    expect(journeyTriggerForTransition('closing', 'closed')).toBe('relationship_milestone');
  });

  it('returns null for invalid transitions', () => {
    expect(journeyTriggerForTransition('intake', 'closed')).toBe(null);
    expect(journeyTriggerForTransition('active', 'retainer_pending')).toBe(null);
    expect(journeyTriggerForTransition('intake', 'intake')).toBe(null);
  });
});

describe('nextStage', () => {
  it('returns the next forward stage', () => {
    expect(nextStage('intake')).toBe('retainer_pending');
    expect(nextStage('retainer_pending')).toBe('active');
    expect(nextStage('active')).toBe('closing');
    expect(nextStage('closing')).toBe('closed');
  });

  it('returns null for the terminal closed stage', () => {
    expect(nextStage('closed')).toBe(null);
  });
});

describe('canAdvanceStage', () => {
  it('client role can never advance', () => {
    expect(canAdvanceStage('client', 'intake', 'retainer_pending')).toBe(false);
    expect(canAdvanceStage('client', 'active', 'closing')).toBe(false);
  });

  it('admin can advance every legal transition', () => {
    expect(canAdvanceStage('admin', 'intake', 'retainer_pending')).toBe(true);
    expect(canAdvanceStage('admin', 'retainer_pending', 'active')).toBe(true);
    expect(canAdvanceStage('admin', 'active', 'closing')).toBe(true);
    expect(canAdvanceStage('admin', 'closing', 'closed')).toBe(true);
  });

  it('operator can advance every legal transition', () => {
    expect(canAdvanceStage('operator', 'intake', 'retainer_pending')).toBe(true);
    expect(canAdvanceStage('operator', 'closing', 'closed')).toBe(true);
  });

  it('system can advance forward (automated triggers)', () => {
    expect(canAdvanceStage('system', 'intake', 'retainer_pending')).toBe(true);
    expect(canAdvanceStage('system', 'active', 'closing')).toBe(true);
  });

  it('staff can only advance intake → retainer_pending', () => {
    expect(canAdvanceStage('staff', 'intake', 'retainer_pending')).toBe(true);
    expect(canAdvanceStage('staff', 'retainer_pending', 'active')).toBe(false);
    expect(canAdvanceStage('staff', 'active', 'closing')).toBe(false);
    expect(canAdvanceStage('staff', 'closing', 'closed')).toBe(false);
  });

  it('any role rejects invalid transitions', () => {
    expect(canAdvanceStage('admin', 'intake', 'active')).toBe(false); // skipping
    expect(canAdvanceStage('admin', 'active', 'intake')).toBe(false); // reverse
    expect(canAdvanceStage('admin', 'closed', 'intake')).toBe(false); // terminal
    expect(canAdvanceStage('operator', 'intake', 'intake')).toBe(false); // no-op
  });
});
