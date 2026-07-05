/**
 * Cadence seed library: the global default rules J6 through J12.
 *
 * This is the SAME content seeded by
 * supabase/migrations/20260703_cadence_engine_shadow.sql (J6/J7/J9/J11) and
 * supabase/migrations/20260705_cadence_wp1_extensions.sql (J8/J10/J12 +
 * J6's exit_config). The database table is the runtime source of truth (the
 * runner reads rules from it, and per-firm overrides live there too). This
 * constant exists as the authored library for tests and for a future operator
 * "reseed defaults" action. Keep the two in sync: any change to a seed rule or
 * step here must be mirrored in the migrations, and vice versa.
 *
 * Copy discipline (LSO Rule 4.2-1): no outcome promises, no time-relative reply
 * promises, no "specialist"/"expert" language, no banned vocabulary, no em
 * dashes. Final production copy is a Phase 3 concern; this seed proves the
 * engine end to end (enroll, schedule, consent-gate, shadow-log, exit).
 *
 * Most trigger keys match journeyTriggerForTransition (matter-stage-pure.ts)
 * so the shadow engine enrolls on exactly the signal GHL's matter_stage_changed
 * gets. J10 is the exception: it is lead-status-sourced (source:
 * 'screened_leads_status', status: 'passed') because a passed lead never
 * becomes a client_matters row, so there is no stage event to enroll off.
 */

export interface SeedStep {
  step_number: number;
  delay_hours: number;
  subject_template: string;
  body_template: string;
}

export interface SeedRule {
  cadence_key: string;
  name: string;
  trigger_type: 'field_change';
  cadence_trigger: string;
  /** Present only on lead-status-sourced rules (J10); absent = stage-sourced. */
  source?: 'screened_leads_status';
  status?: string;
  /** Present only where an early-exit condition applies (J6). */
  exit_config?: Record<string, unknown>;
  steps: SeedStep[];
}

export const CADENCE_SEED_LIBRARY: SeedRule[] = [
  {
    cadence_key: 'J6',
    name: 'Retainer Awaiting Signature',
    trigger_type: 'field_change',
    cadence_trigger: 'retainer_awaiting',
    exit_config: { matter_stage_not_in: ['retainer_pending'] },
    steps: [
      { step_number: 1, delay_hours: 0,   subject_template: 'Your engagement letter with {firm_name}',   body_template: 'Hi {first_name}, your engagement letter for the {matter_type} is ready for signature. Reply here if any question comes up before you sign.' },
      { step_number: 2, delay_hours: 48,  subject_template: 'A quick note on your engagement letter',      body_template: 'Hi {first_name}, following up on the engagement letter for your {matter_type}. The firm holds the file ready to begin once it is signed.' },
      { step_number: 3, delay_hours: 120, subject_template: 'Still here when you are ready',                body_template: 'Hi {first_name}, no rush on the {matter_type} engagement letter. If timing or terms need a change, tell the firm and it will adjust.' },
      { step_number: 4, delay_hours: 240, subject_template: 'Closing the loop on your engagement letter',  body_template: 'Hi {first_name}, the firm will keep the {matter_type} file open for you. When the engagement letter is signed, work begins.' },
    ],
  },
  {
    cadence_key: 'J7',
    name: 'Welcome and Onboarding',
    trigger_type: 'field_change',
    cadence_trigger: 'client_won',
    steps: [
      { step_number: 1, delay_hours: 0,   subject_template: 'Welcome to {firm_name}',              body_template: 'Hi {first_name}, welcome. Your {matter_type} is now open with the firm. This note is your starting point for what happens next.' },
      { step_number: 2, delay_hours: 24,  subject_template: 'What to expect on your matter',       body_template: 'Hi {first_name}, a short outline of the {matter_type} steps ahead and where your input will be needed. Questions are always welcome.' },
      { step_number: 3, delay_hours: 72,  subject_template: 'Documents and details for your file', body_template: 'Hi {first_name}, a checklist of documents that help move the {matter_type} forward. Send what you have; the firm will ask if anything else is needed.' },
      { step_number: 4, delay_hours: 168, subject_template: 'Your first week with the firm',       body_template: 'Hi {first_name}, a check-in at the end of your first week on the {matter_type}. Reply if anything is unclear.' },
    ],
  },
  {
    cadence_key: 'J8',
    name: 'Active Matter Update',
    trigger_type: 'field_change',
    cadence_trigger: 'client_won',
    steps: [
      { step_number: 1, delay_hours: 336,  subject_template: 'An update on your {matter_type}',    body_template: 'Hi {first_name}, a short note on where your {matter_type} stands with {firm_name}. Reply if a question has come up.' },
      { step_number: 2, delay_hours: 672,  subject_template: 'Checking in on your matter',          body_template: 'Hi {first_name}, following up on your {matter_type}. If there is anything you need from the firm at this stage, reply here.' },
      { step_number: 3, delay_hours: 1344, subject_template: 'A four-week note on your matter',     body_template: 'Hi {first_name}, a further note on your {matter_type} with {firm_name}. The firm will keep you posted as it moves forward.' },
    ],
  },
  {
    cadence_key: 'J9',
    name: 'Google Review Request',
    trigger_type: 'field_change',
    cadence_trigger: 'review_request',
    steps: [
      { step_number: 1, delay_hours: 0,   subject_template: 'Thank you from {firm_name}',           body_template: 'Hi {first_name}, thank you for trusting the firm with your {matter_type}. If the experience was a good one, a short review helps others find the firm.' },
      { step_number: 2, delay_hours: 72,  subject_template: 'A quick favour, if you have a moment',  body_template: 'Hi {first_name}, following up on a review for your {matter_type}. A few honest sentences are plenty, and it makes a real difference.' },
      { step_number: 3, delay_hours: 168, subject_template: 'Last note on leaving a review',         body_template: 'Hi {first_name}, a final note. If you would share a review of your {matter_type} experience, the firm would be grateful. Either way, thank you.' },
    ],
  },
  {
    cadence_key: 'J10',
    name: 'Re-Engagement',
    trigger_type: 'field_change',
    cadence_trigger: 're_engagement',
    source: 'screened_leads_status',
    status: 'passed',
    steps: [
      { step_number: 1, delay_hours: 2160, subject_template: 'Checking back in',       body_template: 'Hi {first_name}, it has been a while since your last conversation with {firm_name} about your {matter_type}. If circumstances have changed, the firm is glad to take another look.' },
      { step_number: 2, delay_hours: 4320, subject_template: 'Still here if useful',   body_template: 'Hi {first_name}, a final note from {firm_name}. If your {matter_type} situation resurfaces or changes, reply and the firm will pick it up.' },
    ],
  },
  {
    cadence_key: 'J11',
    name: 'Relationship Milestone',
    trigger_type: 'field_change',
    cadence_trigger: 'relationship_milestone',
    steps: [
      { step_number: 1, delay_hours: 4380, subject_template: 'Six months on from your matter', body_template: 'Hi {first_name}, about six months since the firm worked on your {matter_type}. A quiet check-in: if anything related has come up, reply and the firm will pick it up.' },
      { step_number: 2, delay_hours: 8760, subject_template: 'A year on from your matter',       body_template: 'Hi {first_name}, a year since your {matter_type} with the firm. If a follow-on question has surfaced, the firm is here. If all is settled, that is good to hear.' },
    ],
  },
  {
    cadence_key: 'J12',
    name: 'Long-Term Nurture',
    trigger_type: 'field_change',
    cadence_trigger: 'relationship_milestone',
    steps: [
      { step_number: 1, delay_hours: 13140, subject_template: 'Eighteen months on', body_template: 'Hi {first_name}, eighteen months since the firm worked on your {matter_type}. A quiet note in case anything related has come up.' },
      { step_number: 2, delay_hours: 17520, subject_template: 'Two years on',       body_template: 'Hi {first_name}, two years since your {matter_type} with {firm_name}. If a follow-on question ever surfaces, the firm is here.' },
    ],
  },
];
