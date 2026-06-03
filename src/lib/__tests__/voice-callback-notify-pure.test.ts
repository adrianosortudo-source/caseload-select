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
  describeMissingContact,
  htmlEscape,
  type UnconfirmedVoiceNotifyArgs,
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

describe('htmlEscape', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(htmlEscape(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
