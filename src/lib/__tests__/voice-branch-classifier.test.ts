import { describe, expect, it } from 'vitest';
import {
  classifyVoiceBranchHeuristic,
  extractVoiceBranchMarker,
  parseVoiceStructuredIntent,
  reconcileVoiceBranch,
  buildVoiceCallbackMessage,
} from '../voice-branch-classifier';

describe('structured call intent', () => {
  it('normalizes constrained GHL values and rejects template noise', () => {
    expect(parseVoiceStructuredIntent('new legal help')).toBe('new_legal_help');
    expect(parseVoiceStructuredIntent('CURRENT-CLIENT')).toBe('existing_client');
    expect(parseVoiceStructuredIntent('{{ contact.call_intent }}')).toBeNull();
    expect(parseVoiceStructuredIntent('owner please')).toBeNull();
  });

  it('routes a corroborated structured new-matter call without a spoken marker', () => {
    const result = reconcileVoiceBranch({
      transcript: 'human: I need a lawyer for a shareholder dispute.',
      structuredCallIntent: 'new_legal_help',
    });
    expect(result.route).toBe('new_matter');
    expect(result.structuredIntent).toBe('new_legal_help');
    expect(result.reason).toBe('structured_and_classifier_new_matter');
  });

  it('sends a structured/classifier conflict to recovery instead of forcing intake', () => {
    const result = reconcileVoiceBranch({
      transcript: 'human: I am an existing client calling for a file update.',
      structuredCallIntent: 'new_legal_help',
    });
    expect(result.route).toBe('callback');
    expect(result.callbackBranch).toBe('unclear');
    expect(result.operatorReview).toBe(true);
  });

  it('keeps an unclear potential new matter in recovery', () => {
    const result = reconcileVoiceBranch({
      transcript: 'human: I need help with a contract dispute but I would rather explain it to a person.',
      structuredCallIntent: 'unknown_recovery',
    });
    expect(result.route).toBe('callback');
    expect(result.callbackBranch).toBe('unclear');
    expect(result.reason).toBe('structured_recovery_classifier_new_matter');
  });

  it('uses the structured existing-client route when a short transcript is inconclusive', () => {
    const result = reconcileVoiceBranch({
      transcript: 'human: Yes, that is right.',
      structuredCallIntent: 'existing_client',
    });
    expect(result.route).toBe('callback');
    expect(result.callbackBranch).toBe('existing_client');
    expect(result.operatorReview).toBe(true);
  });
});

describe('voice branch classifier', () => {
  it('extracts the agent branch marker', () => {
    expect(extractVoiceBranchMarker('bot: RECORD_BRANCH: NEW_MATTER')?.value).toBe('NEW_MATTER');
    expect(extractVoiceBranchMarker('RECORD_BRANCH: OTHER')?.value).toBe('OTHER');
    expect(extractVoiceBranchMarker('no marker here')).toBeNull();
  });

  it('classifies new matter transcripts', () => {
    const t = 'human: I need help making a will and planning my estate.\nbot: RECORD_BRANCH: NEW_MATTER';
    expect(classifyVoiceBranchHeuristic(t)).toBe('new_matter');
    const d = reconcileVoiceBranch({ transcript: t });
    expect(d.route).toBe('new_matter');
    expect(d.operatorReview).toBe(false);
  });

  it('routes existing-client calls to callback requests', () => {
    const t = 'human: I am an existing client and I need an update on my case.\nbot: RECORD_BRANCH: OTHER';
    const d = reconcileVoiceBranch({ transcript: t });
    expect(d.route).toBe('callback');
    expect(d.callbackBranch).toBe('existing_client');
  });

  it('routes court or counsel calls as urgent callback requests', () => {
    const t = 'human: This is the court clerk. There is a hearing tomorrow.\nbot: RECORD_BRANCH: OTHER';
    const d = reconcileVoiceBranch({ transcript: t });
    expect(d.route).toBe('callback');
    expect(d.callbackBranch).toBe('court_or_counsel');
    expect(d.urgency).toBe('urgent');
    expect(d.urgencyTriggers).toContain('tomorrow');
  });

  it('does not let bot speech create a false court-hearing urgency', () => {
    const t = 'human: I cannot hear you clearly.\nbot: If this concerns a court hearing tomorrow, say so.\nbot: RECORD_BRANCH: OTHER';
    const d = reconcileVoiceBranch({ transcript: t });
    expect(d.urgency).toBe('normal');
    expect(d.urgencyTriggers).toEqual([]);
  });

  it('does not treat a negated deadline as urgent', () => {
    const d = reconcileVoiceBranch({
      transcript: 'human: No deadline that I know of. I am looking for help with a contract.',
      structuredCallIntent: 'new_legal_help',
    });
    expect(d.urgency).toBe('normal');
    expect(d.urgencyTriggers).toEqual([]);
  });

  it('requires imminent timing rather than treating any court mention as urgent', () => {
    const ordinary = reconcileVoiceBranch({
      transcript: 'human: I have a court hearing next month.',
      structuredCallIntent: 'unknown_recovery',
    });
    const imminent = reconcileVoiceBranch({
      transcript: 'human: I have a court hearing tomorrow.',
      structuredCallIntent: 'unknown_recovery',
    });
    expect(ordinary.urgency).toBe('normal');
    expect(imminent.urgency).toBe('urgent');
    expect(imminent.urgencyTriggers).toContain('tomorrow');
  });

  it('does not treat declining SMS as declining legal-help qualification', () => {
    const t = 'human: I need a lawyer for a shareholder dispute. Please do not text me.\nbot: RECORD_BRANCH: NEW_MATTER';
    const d = reconcileVoiceBranch({ transcript: t });
    expect(d.classifierBranch).toBe('new_matter');
    expect(d.route).toBe('new_matter');
  });

  it('routes vendor calls away from the lawyer lead queue', () => {
    const t = 'human: We sell SEO and lead generation services for law firms.\nbot: RECORD_BRANCH: OTHER';
    const d = reconcileVoiceBranch({ transcript: t });
    expect(d.route).toBe('callback');
    expect(d.callbackBranch).toBe('vendor');
  });

  it('routes wrong numbers away from the lawyer lead queue', () => {
    const t = 'human: Sorry, wrong number.\nbot: RECORD_BRANCH: OTHER';
    const d = reconcileVoiceBranch({ transcript: t });
    expect(d.route).toBe('callback');
    expect(d.callbackBranch).toBe('wrong_number');
  });

  it('flags marker/classifier disagreements for operator review', () => {
    const t = 'human: I am a current client calling about my file update.\nbot: RECORD_BRANCH: NEW_MATTER';
    const d = reconcileVoiceBranch({ transcript: t });
    expect(d.route).toBe('callback');
    expect(d.callbackBranch).toBe('unclear');
    expect(d.operatorReview).toBe(true);
    expect(d.reason).toBe('marker_new_matter_classifier_non_intake');
  });

  it('keeps legacy clear-new-matter calls flowing when marker is missing', () => {
    const d = reconcileVoiceBranch({
      transcript: 'human: I need a lawyer for a wrongful dismissal.',
    });
    expect(d.route).toBe('new_matter');
    expect(d.operatorReview).toBe(true);
    expect(d.reason).toBe('missing_marker_legacy_new_matter');
  });

  it('can strict-route missing markers to callback review', () => {
    const d = reconcileVoiceBranch({
      transcript: 'human: I need a lawyer for a wrongful dismissal.',
      strictMissingMarker: true,
    });
    expect(d.route).toBe('callback');
    expect(d.callbackBranch).toBe('unclear');
    expect(d.operatorReview).toBe(true);
  });

  it('builds callback message from human turns without branch marker noise', () => {
    const msg = buildVoiceCallbackMessage([
      'bot: Thanks for calling.',
      'human: I am calling about billing.',
      'bot: RECORD_BRANCH: OTHER',
    ].join('\n'));
    expect(msg).toBe('I am calling about billing.');
  });
});
