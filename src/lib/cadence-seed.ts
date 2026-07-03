/**
 * Cadence seed library: the global default rules J6, J7, J9, J11.
 *
 * This is the SAME content seeded by
 * supabase/migrations-draft/20260703_cadence_engine_shadow.sql (section 6).
 * The database table is the runtime source of truth (the runner reads rules
 * from it, and per-firm overrides live there too). This constant exists as the
 * authored library for tests and for a future operator "reseed defaults"
 * action. Keep the two in sync: any change to a seed rule or step here must be
 * mirrored in the migration, and vice versa.
 *
 * Copy discipline (LSO Rule 4.2-1): no outcome promises, no time-relative reply
 * promises, no "specialist"/"expert" language, no banned vocabulary, no em
 * dashes. Final production copy is a Phase 3 concern; this seed proves the
 * engine end to end (enroll, schedule, consent-gate, shadow-log).
 *
 * Trigger keys match journeyTriggerForTransition (matter-stage-pure.ts) so the
 * shadow engine enrolls on exactly the signal GHL's matter_stage_changed gets.
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
  steps: SeedStep[];
}

export const CADENCE_SEED_LIBRARY: SeedRule[] = [
  {
    cadence_key: 'J6',
    name: 'Retainer Awaiting Signature',
    trigger_type: 'field_change',
    cadence_trigger: 'retainer_awaiting',
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
    cadence_key: 'J11',
    name: 'Relationship Milestone',
    trigger_type: 'field_change',
    cadence_trigger: 'relationship_milestone',
    steps: [
      { step_number: 1, delay_hours: 4380, subject_template: 'Six months on from your matter', body_template: 'Hi {first_name}, about six months since the firm worked on your {matter_type}. A quiet check-in: if anything related has come up, reply and the firm will pick it up.' },
      { step_number: 2, delay_hours: 8760, subject_template: 'A year on from your matter',       body_template: 'Hi {first_name}, a year since your {matter_type} with the firm. If a follow-on question has surfaced, the firm is here. If all is settled, that is good to hear.' },
    ],
  },
];
