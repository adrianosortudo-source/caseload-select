/**
 * Milestone option lists for the J8 Milestone Assistant.
 * Keyed by practice_area value from client_matters.
 * Falls back to 'general' when the area is not mapped.
 */

export const MILESTONE_OPTIONS: Record<string, readonly string[]> = {
  real_estate: [
    'APS reviewed',
    'Conditions waived',
    'Title search complete',
    'Closing scheduled',
    'Closing complete',
  ],
  corporate: [
    'Term sheet reviewed',
    'Due diligence complete',
    'Draft agreement circulated',
    'Agreement executed',
    'Transaction closed',
  ],
  employment: [
    'Documents reviewed',
    'Demand letter sent',
    'Negotiation opened',
    'Settlement reached',
    'File closed',
  ],
  estates: [
    'Estate assets identified',
    'Probate application filed',
    'Certificate of appointment issued',
    'Assets distributed',
    'Estate administration closed',
  ],
  immigration: [
    'Documents received and reviewed',
    'Application prepared for review',
    'Application submitted',
    'Additional documents requested',
    'Decision received',
  ],
  family: [
    'Financial disclosure received',
    'Separation agreement drafted',
    'Agreement reviewed and signed',
    'Consent order filed',
    'File closed',
  ],
  general: [
    'Initial review complete',
    'Key documents received',
    'Correspondence sent',
    'Next steps confirmed',
    'Matter closed',
  ],
};

export const CUSTOM_MILESTONE_OPTION = 'Other (type your own)';

export function getMilestoneOptions(practiceArea: string): readonly string[] {
  const normalized = practiceArea.toLowerCase().replace(/[\s-]/g, '_');
  return (
    MILESTONE_OPTIONS[normalized] ??
    MILESTONE_OPTIONS[practiceArea] ??
    MILESTONE_OPTIONS['general']
  );
}
