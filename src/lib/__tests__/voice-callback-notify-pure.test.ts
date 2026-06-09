/**
 * Tests for the pure unconfirmed-voice-intake email builder (#125).
 *
 * The I/O wrapper (notifyOperatorOfUnconfirmedVoiceIntake) is a thin shell over
 * sendEmail; the logic worth testing is the email composition: the
 * what-is-missing descriptor, the next-action branching (call back / listen to
 * recording / unrecoverable), HTML escaping, and transcript truncation.
 */

import { describe, it, expect } from 'vitest';
import {
  buildUnconfirmedVoiceEmail,
  buildVoiceCallbackEmail,
  describeMissingContact,
  htmlEscape,
  type UnconfirmedVoiceNotifyArgs,
  type VoiceCallbackNotifyArgs,
} from '../voice-callback-notify-pure';

function baseArgs(overrides: Partial<UnconfirmedVoiceNotifyArgs> = {}): UnconfirmedVoiceNotifyArgs {
  return {
    inquiryId: 'unc-123',
    firmId: 'firm-abc',
    callId: 'call-xyz',
    callerName: null,
    callerPhone: null,
    callerPhoneSource: 'none',
    recordingUrl: null,
    callDurationSec: 42,
    matterType: 'wrongful_dismissal',
    practiceArea: 'employment',
    intakeLanguage: 'en',
    reason: 'no_contact_provided',
    transcript: 'Caller: I was let go last week and I want to know my options.',
    ...overrides,
  };
}

describe('describeMissingContact', () => {
  it('reports the name when only the name is missing', () => {
    expect(describeMissingContact(null, '+16475551234')).toBe('missing the caller name');
  });

  it('reports the number when only the phone is missing', () => {
    expect(describeMissingContact('Jane Doe', null)).toBe('missing a callback number');
  });

  it('reports both when both are missing', () => {
    expect(describeMissingContact(null, null)).toBe(
      'missing the caller name and a callback number',
    );
  });

  it('reports a generic line when nothing is missing (defensive)', () => {
    expect(describeMissingContact('Jane Doe', '+16475551234')).toBe(
      'contact details could not be confirmed',
    );
  });
});

describe('buildUnconfirmedVoiceEmail — subject', () => {
  it('puts the callback number in the subject when present', () => {
    const { subject } = buildUnconfirmedVoiceEmail(
      baseArgs({ callerPhone: '+16475551234', callerName: null }),
    );
    expect(subject).toBe('Voice intake needs follow-up — +16475551234');
  });

  it('falls back to a generic subject when no phone was captured', () => {
    const { subject } = buildUnconfirmedVoiceEmail(baseArgs({ callerPhone: null }));
    expect(subject).toBe('Voice intake needs follow-up');
  });
});

describe('buildUnconfirmedVoiceEmail — next action branching', () => {
  it('tells the operator to call back when a number was captured', () => {
    const { html } = buildUnconfirmedVoiceEmail(
      baseArgs({ callerPhone: '+16475551234', callerPhoneSource: 'voice-ai-api' }),
    );
    expect(html).toContain('Call back to complete the intake');
  });

  it('tells the operator to listen to the recording when no number but a recording exists', () => {
    const { html } = buildUnconfirmedVoiceEmail(
      baseArgs({ callerPhone: null, recordingUrl: 'https://rec.example/abc.mp3' }),
    );
    expect(html).toContain('Listen to the recording');
    expect(html).toContain('href="https://rec.example/abc.mp3"');
  });

  it('flags the call as unrecoverable when neither number nor recording exists', () => {
    const { html } = buildUnconfirmedVoiceEmail(
      baseArgs({ callerPhone: null, recordingUrl: null }),
    );
    expect(html).toContain('cannot be recovered automatically');
    expect(html).not.toContain('Listen to the call recording');
  });
});

describe('buildUnconfirmedVoiceEmail — content surfacing + safety', () => {
  it('surfaces the likely matter, practice area, and identifiers', () => {
    const { html } = buildUnconfirmedVoiceEmail(baseArgs());
    expect(html).toContain('wrongful_dismissal');
    expect(html).toContain('employment');
    expect(html).toContain('unc-123');
    expect(html).toContain('call-xyz');
    expect(html).toContain('42s');
  });

  it('renders "Not provided" for null fields rather than blanks', () => {
    const { html } = buildUnconfirmedVoiceEmail(
      baseArgs({ callerName: null, callId: null }),
    );
    expect(html).toContain('Not provided');
  });

  it('HTML-escapes caller-controlled values to prevent injection', () => {
    const { html } = buildUnconfirmedVoiceEmail(
      baseArgs({ callerName: '<script>alert(1)</script>' }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('truncates a long transcript and marks it', () => {
    const long = 'x'.repeat(2000);
    const { html } = buildUnconfirmedVoiceEmail(baseArgs({ transcript: long }));
    expect(html).toContain('[...truncated]');
    // Body should not contain the full 2000-char run.
    expect(html).not.toContain('x'.repeat(1300));
  });

  it('omits the transcript section entirely when there is no transcript', () => {
    const { html } = buildUnconfirmedVoiceEmail(baseArgs({ transcript: null }));
    expect(html).not.toContain('Transcript excerpt');
  });
});

describe('buildUnconfirmedVoiceEmail name provenance (#175)', () => {
  it('labels a metadata-derived name as caller-ID only', () => {
    const { html } = buildUnconfirmedVoiceEmail(
      baseArgs({ callerName: 'Adriano Da Silva Domingues', callerNameSource: 'caller_id_only' }),
    );
    expect(html).toContain('Name source');
    expect(html).toContain('from caller ID, the caller did not state a name on this call');
  });

  it('labels a caller-stated name as stated on the call', () => {
    const { html } = buildUnconfirmedVoiceEmail(
      baseArgs({ callerName: 'Jane Doe', callerNameSource: 'stated_on_call' }),
    );
    expect(html).toContain('stated on the call');
  });

  it('defaults an unset name source to caller-ID only (never overclaims)', () => {
    const { html } = buildUnconfirmedVoiceEmail(baseArgs({ callerName: 'Jane Doe' }));
    expect(html).toContain('from caller ID, the caller did not state a name on this call');
  });
});

// Voice callback email (#175 wrong-number provenance)

function baseCallbackArgs(
  overrides: Partial<VoiceCallbackNotifyArgs> = {},
): VoiceCallbackNotifyArgs {
  return {
    id: 'cb-123',
    firmId: 'firm-abc',
    branch: 'wrong_number',
    urgency: 'normal',
    callerName: null,
    callerNameSource: 'none',
    callerPhone: '+16475492106',
    callerPhoneSource: 'body',
    organization: null,
    message: 'Thanks for calling New York.',
    callId: 'qBx9Y2cM4fgwpb8eeTqm',
    operatorReview: false,
    reason: 'marker_other_classifier_non_intake',
    ...overrides,
  };
}

describe('buildVoiceCallbackEmail wrong-number name provenance (the field bug)', () => {
  it('the exact repro: metadata name on a wrong-number call is labeled, not presented as confirmed', () => {
    const { html } = buildVoiceCallbackEmail(
      baseCallbackArgs({
        callerName: 'Adriano Da Silva Domingues',
        callerNameSource: 'caller_id_only',
      }),
    );
    // The name still shows (the operator may want it), but with provenance.
    expect(html).toContain('Adriano Da Silva Domingues');
    expect(html).toContain('Name source');
    expect(html).toContain('from caller ID, the caller did not state a name on this call');
    // And a plain-language warning so it is not read as a confirmed identity.
    expect(html).toContain('not a confirmed identity');
  });

  it('separates reachability (phone caller ID) from identity (name unverified)', () => {
    const { html } = buildVoiceCallbackEmail(
      baseCallbackArgs({
        callerName: 'Adriano Da Silva Domingues',
        callerNameSource: 'caller_id_only',
      }),
    );
    // Phone source row present (reachability is solid).
    expect(html).toContain('Phone source');
    expect(html).toContain('from the call (caller ID)');
  });

  it('labels other callback branches with a real name as unverified', () => {
    const { html } = buildVoiceCallbackEmail(
      baseCallbackArgs({
        branch: 'other',
        callerName: 'Jane Vendor',
        callerNameSource: 'unverified',
      }),
    );
    expect(html).toContain('from the call or caller ID, not verified by the firm');
    expect(html).toContain('not a confirmed identity');
  });

  it('a caller-stated name shows no unverified warning', () => {
    const { html } = buildVoiceCallbackEmail(
      baseCallbackArgs({
        branch: 'existing_client',
        callerName: 'Jane Doe',
        callerNameSource: 'stated_on_call',
      }),
    );
    expect(html).toContain('stated on the call');
    expect(html).not.toContain('not a confirmed identity');
  });

  it('no name: no overclaim, no provenance warning', () => {
    const { html } = buildVoiceCallbackEmail(
      baseCallbackArgs({ callerName: null, callerNameSource: 'none' }),
    );
    expect(html).not.toContain('not a confirmed identity');
  });
});

describe('htmlEscape', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(htmlEscape(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
