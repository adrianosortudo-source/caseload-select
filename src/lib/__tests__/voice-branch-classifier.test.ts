import { describe, expect, it } from 'vitest';
import {
  classifyVoiceBranchHeuristic,
  extractVoiceBranchMarker,
  reconcileVoiceBranch,
  buildVoiceCallbackMessage,
} from '../voice-branch-classifier';

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
