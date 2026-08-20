import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  callerSpeechOnly,
  classifyVoiceBranchHeuristic,
  detectVoiceUrgency,
  type VoiceFineBranch,
  type VoiceUrgency,
} from '../voice-branch-classifier';
import { parseVoiceTranscript } from '../voice-transcript-lint';

interface Manifest {
  schema_version: string;
  config_version: string;
  status: string;
  operating_model: {
    voice_ai_role: string;
    human_decision_boundary: string;
    backup_mode: boolean;
  };
  agent: {
    name: string;
    prompt_path: string;
    published: boolean;
    phone_assignment: string | null;
    routes: string[];
    new_lead_core_capture: string[];
    new_lead_discovery: string[];
    discovery_policy: {
      language: string;
      adaptive: boolean;
      strategy: string;
      maximum_normal_follow_ups_after_situation: number;
      reuse_volunteered_information: boolean;
      skip_irrelevant_dimensions: boolean;
      matter_specificity_before_generic_screening: boolean;
      completion_test: string;
    };
    recovery_exits: string[];
    structured_actions: Record<string, unknown>;
    urgency_evidence: string;
    pronunciation_dictionary: Array<{ word: string; format: string; pronunciation: string }>;
    closing_behavior: {
      single_uninterrupted_sentence: boolean;
      ignore_audio_after_closing_begins: boolean;
      repeat_count: number;
      include_caller_name: boolean;
      scripted_goodbye: boolean;
      post_closing_speech: boolean;
    };
    session_end_validation: {
      native_voice_ai_end_call_action_available: boolean;
      web_call_simulator_requires_caller_or_manual_end: boolean;
      real_phone_hangup_uat_required: boolean;
      hangup_claimed_verified: boolean;
    };
    spoken_markers: boolean;
    recording_disclosure: {
      purpose: string;
      caller_may_decline: boolean;
      decline_route: string;
      decline_behavior: string;
      disable_recording_claim: boolean;
    };
    immediate_safety: {
      caller_speech_only: boolean;
      signals: string[];
      instruction: string;
      legal_advice: boolean;
      handoff: string;
    };
  };
  workflow: {
    name: string;
    status: string;
    published: boolean;
    trigger: { type: string; agent_name: string; allow_reentry: boolean };
    integration_mode: string;
    required_identifiers: string[];
    states: string[];
    recovery_sms: { requires_sms_consent: string; body: string };
  };
  release_guards: Record<string, boolean>;
}

interface EvalFixture {
  id: string;
  transcript: string;
  expected_branch: VoiceFineBranch;
  expected_urgency: VoiceUrgency;
  expected_sms_consent: 'yes' | 'no' | 'unknown';
  expected_discovery: Array<'situation' | 'timing' | 'scope' | 'complexity' | 'readiness'>;
  expected_recovery: boolean;
  expected_safety_emergency?: boolean;
  expected_retry_count?: number;
  semantic_assertion?: 'live_uat';
  policy_expected_route?: string;
  policy_expected_sms_consent?: string;
  expected_human_decision_boundary?: boolean;
}

const root = process.cwd();
const manifestPath = path.join(root, 'config', 'ghl', 'drg-voice-recovery-vnext.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
const prompt = fs.readFileSync(path.join(root, manifest.agent.prompt_path), 'utf8');
const fixtures = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'lib', '__evals__', 'fixtures', 'drg-voice-recovery-vnext.json'), 'utf8'),
) as EvalFixture[];
const coverageCases = JSON.parse(
  fs.readFileSync(path.join(root, 'src', 'lib', '__evals__', 'fixtures', 'drg-voice-screening-coverage.json'), 'utf8'),
) as Array<{
  id: string;
  caller_description: string;
  highest_value_missing_item: string;
  acceptable_next_question: string;
  unacceptable_pattern: string;
}>;

function evaluateSmsConsent(transcript: string): 'yes' | 'no' | 'unknown' {
  const turns = parseVoiceTranscript(transcript);
  for (let i = 0; i < turns.length - 1; i += 1) {
    const ask = turns[i];
    const answer = turns[i + 1];
    if (ask.speaker !== 'bot' || answer.speaker !== 'human') continue;
    if (!/\b(text|sms)\b/i.test(ask.text)) continue;
    if (/\b(yes|yeah|sure|okay|ok|you may|please do)\b/i.test(answer.text)) return 'yes';
    if (/\b(no|do not|don't|decline|not by text)\b/i.test(answer.text)) return 'no';
  }
  return 'unknown';
}

function evaluateDiscovery(transcript: string, branch: VoiceFineBranch): EvalFixture['expected_discovery'] {
  if (branch !== 'new_matter') return [];
  const caller = callerSpeechOnly(transcript);
  const found: EvalFixture['expected_discovery'] = [];
  if (/\b(help|dispute|served|papers|locked|legal|lawyer|file)\b/i.test(caller)) found.push('situation');
  if (/\b(value|worth|scope|\$|dollars?|thousand|million)\b/i.test(caller)) found.push('scope');
  if (/\b(today|tomorrow|soon|deadline|due|scheduled|court|hearing)\b/i.test(caller)) found.push('timing');
  if (/\b(parties|party|shareholders?|prior steps|formal steps|proceedings?)\b/i.test(caller)) found.push('complexity');
  if (/\b(ready|next steps|gathering|options)\b/i.test(caller)) found.push('readiness');
  return found;
}

function hasImmediateSafetyEmergency(transcript: string): boolean {
  const caller = callerSpeechOnly(transcript);
  return /\b(immediate physical danger|medical emergency|crime in progress|breaking into|attack(?:ing)? me right now)\b/i.test(caller);
}

function requiresHumanRecovery(transcript: string, branch: VoiceFineBranch, urgency: VoiceUrgency): boolean {
  const caller = callerSpeechOnly(transcript);
  return branch === 'unclear' || urgency === 'urgent' || /\b(want|need|prefer) (?:a )?(?:person|human)\b/i.test(caller);
}

describe('canonical DRG hybrid Voice AI manifest', () => {
  it('is explicitly versioned and locked to pre-production test assets', () => {
    expect(manifest.schema_version).toBe('drg.voice-ai.hybrid-reception.v1');
    expect(manifest.config_version).toMatch(/^3\.0\.0-test\.\d+$/);
    expect(manifest.status).toBe('preproduction_test');
    expect(manifest.agent.name).toBe('DRG Law Reception - Recovery TEST');
    expect(manifest.workflow.name).toBe('DRG Voice Recovery VNext - TEST');
    expect(manifest.agent.published).toBe(false);
    expect(manifest.agent.phone_assignment).toBeNull();
    expect(manifest.workflow.status).toBe('draft');
    expect(manifest.workflow.published).toBe(false);
    expect(Object.values(manifest.release_guards)).not.toContain(true);
  });

  it('locks the primary-receptionist operating decision and human boundary', () => {
    expect(manifest.operating_model.voice_ai_role).toBe('primary_receptionist');
    expect(manifest.operating_model.backup_mode).toBe(false);
    expect(manifest.operating_model.human_decision_boundary).toMatch(/operator and lawyer decide/i);
    expect(prompt).toMatch(/automated primary receptionist/i);
    expect(prompt).toMatch(/human team decides/i);
  });

  it('requires a plain-language adaptive screen for cooperative new legal-help callers', () => {
    expect(manifest.agent.new_lead_core_capture).toEqual(['situation']);
    expect(manifest.agent.new_lead_discovery).toEqual([
      'specific_situation',
      'current_stage',
      'desired_legal_help',
      'timing',
      'relevant_people_or_entities_when_useful',
      'material_stakes_when_relevant',
    ]);
    expect(manifest.agent.discovery_policy).toEqual({
      language: 'plain',
      adaptive: true,
      strategy: 'single_next_best_missing_question',
      maximum_normal_follow_ups_after_situation: 4,
      reuse_volunteered_information: true,
      skip_irrelevant_dimensions: true,
      matter_specificity_before_generic_screening: true,
      completion_test: 'specific_situation_current_stage_desired_help_and_real_timing_are_human_readable',
    });
    expect(prompt).toContain('In one or two sentences, what would you like a lawyer to help you with?');
    expect(prompt).toMatch(/single highest-value missing item/i);
    expect(prompt).toMatch(/make a vague matter specific before asking generic screening questions/i);
    expect(prompt).toMatch(/what the caller wants the lawyer to help them do/i);
    expect(prompt).toMatch(/Could a human reading the handoff explain the specific situation/i);
    expect(prompt).toMatch(/Do not mechanically complete a checklist/i);
    expect(prompt).toMatch(/Do not automatically ask about deadlines, documents, people, or value/i);
    expect(prompt).toMatch(/Do not ask the new-matter screening dimensions/g);
  });

  it('defines cross-area next-best-question coverage instead of one matter-specific script', () => {
    expect(coverageCases.map((item) => item.id)).toEqual([
      'broad-business-formation',
      'broad-property-request',
      'employment-event',
      'business-owner-dispute',
      'estate-planning-request',
      'court-papers-with-near-date',
    ]);
    expect(new Set(coverageCases.map((item) => item.highest_value_missing_item))).toEqual(
      new Set(['specific_situation', 'current_stage', 'desired_legal_help', 'timing']),
    );
    for (const item of coverageCases) {
      expect(item.caller_description.trim()).not.toBe('');
      expect(item.acceptable_next_question.trim()).not.toBe('');
      expect(item.unacceptable_pattern).toMatch(/generic|jargon|checklist|irrelevant|premature/i);
    }
  });

  it('separates immediate safety emergencies from ordinary legal urgency', () => {
    expect(manifest.agent.immediate_safety).toEqual({
      caller_speech_only: true,
      signals: ['immediate_physical_danger', 'medical_emergency', 'crime_in_progress'],
      instruction: 'direct_to_911_or_local_emergency_services',
      legal_advice: false,
      handoff: 'minimum_recovery_only_if_safe',
    });
    expect(prompt).toMatch(/Immediate physical danger, a medical emergency, or a crime in progress/i);
    expect(prompt).toMatch(/call 911 or local emergency services now/i);
    expect(prompt).toMatch(/If it is safe for the caller to continue/i);
  });

  it('pins recovery exits, explicit consent, human-only urgency, and silent structured actions', () => {
    expect(manifest.agent.recovery_exits).toHaveLength(7);
    expect(manifest.agent.urgency_evidence).toBe('caller_speech_only');
    expect(prompt).toContain('may DRG Law text you at the number you\'re calling from?');
    expect(prompt).toMatch(/yes only after an explicit affirmative answer from the caller/i);
    expect(prompt).toMatch(/Words spoken by the assistant never create urgency/i);
    expect(prompt).toMatch(/Use Update Call Intent silently/);
    expect(prompt).toMatch(/Use Update SMS Consent silently/);
    expect(prompt).toMatch(/as soon as possible is readiness, not urgency/i);
    expect(prompt).toMatch(/explicitly says there is no deadline/i);
  });

  it('pins brand pronunciation and a single non-restarting closing', () => {
    expect(manifest.agent.pronunciation_dictionary).toEqual([
      { word: 'DRG', format: 'IPA', pronunciation: '/di\u02d0\u0251\u0279d\u0292i\u02d0/' },
    ]);
    expect(manifest.agent.closing_behavior).toEqual({
      single_uninterrupted_sentence: true,
      ignore_audio_after_closing_begins: true,
      repeat_count: 1,
      include_caller_name: false,
      scripted_goodbye: false,
      post_closing_speech: false,
    });
    expect(manifest.agent.session_end_validation).toEqual({
      native_voice_ai_end_call_action_available: false,
      web_call_simulator_requires_caller_or_manual_end: true,
      real_phone_hangup_uat_required: true,
      hangup_claimed_verified: false,
    });
    expect(prompt).toMatch(/conversation is closed/i);
    expect(prompt).toMatch(/never answer with a second goodbye/i);
    expect(prompt).toContain('Thank you. DRG Law will review your information');
    expect(prompt).not.toMatch(/review your information[^\n]+Goodbye/i);
  });

  it('never instructs the agent to speak machine markers', () => {
    expect(manifest.agent.spoken_markers).toBe(false);
    expect(prompt).not.toMatch(/RECORD_BRANCH/i);
    expect(prompt).toMatch(/Never speak internal route names, field names, action names/i);
  });

  it('discloses recording purpose and provides a safe decline path without claiming recording stopped', () => {
    expect(manifest.agent.recording_disclosure).toEqual({
      purpose: 'help DRG review and route the request',
      caller_may_decline: true,
      decline_route: 'unknown_recovery',
      decline_behavior: 'collect_no_substantive_details_and_create_human_follow_up',
      disable_recording_claim: false,
    });
    expect(prompt).toMatch(/recorded to help DRG review and route your request/i);
    expect(prompt).toMatch(/You may decline recording/i);
    expect(prompt).toMatch(/do not collect substantive legal or file details/i);
    expect(prompt).toMatch(/do not say that recording has been disabled or stopped/i);
  });

  it('pins the test workflow trigger, state model, identifiers, and consent gate', () => {
    expect(manifest.workflow.trigger).toEqual({
      type: 'transcript_generated',
      agent_name: 'DRG Law Reception - Recovery TEST',
      allow_reentry: true,
    });
    expect(manifest.workflow.required_identifiers).toEqual(['ghl_call_event_id', 'ghl_contact_id']);
    expect(manifest.workflow.states).toEqual([
      'qualified_legal',
      'existing_client',
      'admin_business',
      'recovery_required',
      'transcript_or_integration_exception',
    ]);
    expect(manifest.workflow.integration_mode).toBe('preproduction_test');
    expect(manifest.workflow.recovery_sms.requires_sms_consent).toBe('yes');
    expect(manifest.workflow.recovery_sms.body).toContain('Reply STOP to opt out.');
  });
});

describe('deterministic hybrid reception scenarios', () => {
  it('contains the required high-risk scenario coverage', () => {
    expect(fixtures.map((fixture) => fixture.id)).toEqual([
      'cooperative-new-legal-help',
      'owner-request-remains-ambiguous',
      'existing-client-concise-message',
      'administrative-vendor-route',
      'caller-spoken-court-tomorrow',
      'assistant-words-never-create-urgency',
      'asap-with-no-deadline-is-normal',
      'caller-declines-intake',
      'caller-declines-recording',
      'immediate-physical-danger',
      'portuguese-new-help-policy',
      'noisy-call-retry-then-recovery',
    ]);
  });

  for (const fixture of fixtures) {
    it(`${fixture.id}: routes, qualifies, recovers, and records consent from caller evidence`, () => {
      const branch = classifyVoiceBranchHeuristic(fixture.transcript);
      const urgency = detectVoiceUrgency(fixture.transcript).urgency;
      if (fixture.semantic_assertion === 'live_uat') {
        expect(fixture.policy_expected_route).toBe('new_legal_help');
        expect(fixture.policy_expected_sms_consent).toBe('yes');
        expect(fixture.expected_human_decision_boundary).toBe(true);
        expect(prompt).toMatch(/If the caller naturally speaks Portuguese/i);
        return;
      }
      expect(branch).toBe(fixture.expected_branch);
      expect(urgency).toBe(fixture.expected_urgency);
      expect(evaluateSmsConsent(fixture.transcript)).toBe(fixture.expected_sms_consent);
      expect(evaluateDiscovery(fixture.transcript, branch)).toEqual(fixture.expected_discovery);
      expect(requiresHumanRecovery(fixture.transcript, branch, urgency)).toBe(fixture.expected_recovery);
      expect(hasImmediateSafetyEmergency(fixture.transcript)).toBe(fixture.expected_safety_emergency ?? false);
      if (fixture.expected_retry_count !== undefined) {
        expect((fixture.transcript.match(/please repeat it once/gi) ?? []).length).toBe(fixture.expected_retry_count);
      }
      expect(fixture.transcript).not.toMatch(/RECORD_BRANCH/i);
    });
  }
});
