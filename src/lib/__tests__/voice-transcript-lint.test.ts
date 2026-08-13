/**
 * Tests for src/lib/voice-transcript-lint.ts.
 *
 * The primary fixture is the verbatim transcript of the real DRG Law call on
 * 2026-07-28 16:05 EDT, the call that exposed the compound-question defect.
 * It is kept here as a regression fixture: if a future prompt change stops
 * this transcript producing these findings, the linter has regressed.
 *
 * The precision tests matter as much as the detection tests. A linter that
 * cries wolf gets ignored, which is the failure mode this whole module
 * exists to escape, so ordinary voice artefacts (caller barge-in, a triage
 * question offering several options in one sentence) must stay silent.
 */

import { describe, it, expect } from 'vitest';

import {
  lintVoiceTranscript,
  parseVoiceTranscript,
  summariseVoiceLint,
} from '../voice-transcript-lint';

/** Verbatim from screened_leads.raw_transcript, DRG Law, 2026-07-28. */
const DRG_2026_07_28 = [
  "bot:Thanks for calling DRG Law. I'm an automated assistant, and this call may be recorded. Are you already a client, looking for legal help for the first time, or calling about something else?",
  "human:I'm looking for legal help for the first time. ",
  'bot:Alright, thanks for letting me know. Can I get your name?',
  'human:Adriano, ',
  "bot:Thanks, Adriano. What's the best phone number to reach you?",
  "human:It is the same one I'm calling you. ",
  'human:Six four seven five four nine two one zero six. ',
  'bot:Got it. Tell me how a lawyer can help you today.',
  'human:I started doing some cleaning work with my partner, and we we now have, uh, too many customers, and we want to formalize our business. ',
  'bot:Makes sense. Just a couple quick questions to get a better sense of things—are you and your partner just starting out, or have you been operating for a while now? And roughly how many people are involved besides you two?',
  "human:Yeah. I just told you that we have, like, many customers now, so we've been operating for several months. And it's just the two of us. ",
  'bot:Thanks for clarifying. Is there any urgency—like a deadline or a specific date you need to have things formalized by?',
  'human:No. But we want it as soon as possible. ',
  'bot:Understood. Are you ready to move forward with a lawyer now, or are you still looking into your options? And have you spoken with any other lawyers yet?',
  "human:I haven't spoken to any other lawyers yet. ",
  'bot:Thanks for sharing that. Just to check—are there any contracts, agreements, or documents already in place between you and your partner, or with your customers? Or is ',
  'human:No. Nothing. ',
  'bot:everything informal so far?',
  'human:Nothing. ',
  "bot:Alright, thanks for confirming. Just to make sure I have this right, you're looking for help to formalize your cleaning business with your partner, since you've been operating for several months and now have lots of customers. Is that correct?",
  'human:That is correct. ',
  "bot:Thank you, Adriano. I'll pass this along. Our team will review this and follow up with you.",
].join('\n');

const DRG_INPUT = {
  transcript: DRG_2026_07_28,
  readinessAnswered: false,
  callerName: 'Adriano Da Silva Domingues',
  callerPhone: '+16475492106',
};

function codes(transcript: string, extra = {}) {
  return lintVoiceTranscript({ transcript, callerName: 'Test Caller', callerPhone: '+16475550123', ...extra })
    .findings.map((f) => f.code);
}

describe('parseVoiceTranscript', () => {
  it('parses speakers and preserves turn order', () => {
    const turns = parseVoiceTranscript('bot:Hello there.\nhuman:Hi.\nbot:Goodbye.');
    expect(turns.map((t) => t.speaker)).toEqual(['bot', 'human', 'bot']);
    expect(turns[0].text).toBe('Hello there.');
    expect(turns.map((t) => t.index)).toEqual([0, 1, 2]);
  });

  it('folds continuation lines into the current turn rather than inventing turns', () => {
    const turns = parseVoiceTranscript('bot:First part\nstill the same turn.\nhuman:Reply.');
    expect(turns).toHaveLength(2);
    expect(turns[0].text).toBe('First part still the same turn.');
  });

  it('accepts assistant/user aliases and drops empty turns', () => {
    const turns = parseVoiceTranscript('assistant:Hi.\nuser:Hello.\nbot:   \n');
    expect(turns.map((t) => t.speaker)).toEqual(['bot', 'human']);
  });
});

describe('lintVoiceTranscript — DRG 2026-07-28 regression fixture', () => {
  const report = lintVoiceTranscript(DRG_INPUT);

  it('is not clean', () => {
    expect(report.clean).toBe(false);
  });

  it('flags both compound questions', () => {
    const compound = report.findings.filter((f) => f.code === 'compound_question');
    expect(compound).toHaveLength(2);
    expect(compound[0].excerpt).toContain('just starting out');
    expect(compound[1].excerpt).toContain('ready to move forward');
  });

  it('flags the question split across the caller interruption exactly once', () => {
    const split = report.findings.filter((f) => f.code === 'split_question');
    expect(split).toHaveLength(1);
    expect(split[0].excerpt).toContain('everything informal so far?');
  });

  it('flags the caller pushback and quotes only the matched phrase', () => {
    const pushback = report.findings.filter((f) => f.code === 'caller_pushback');
    expect(pushback).toHaveLength(1);
    expect(pushback[0].excerpt).toBe('I just told you');
    // No caller PII beyond the phrase itself.
    expect(pushback[0].excerpt).not.toContain('customers');
  });

  it('flags the unanswered readiness axis', () => {
    expect(report.findings.some((f) => f.code === 'readiness_unanswered')).toBe(true);
  });

  it('does not flag name or callback number, both of which were captured', () => {
    expect(codes(DRG_2026_07_28, DRG_INPUT)).not.toContain('missing_caller_name');
    expect(codes(DRG_2026_07_28, DRG_INPUT)).not.toContain('missing_callback_number');
  });

  it('does not flag the single close', () => {
    expect(report.findings.some((f) => f.code === 'double_close')).toBe(false);
  });

  it('counts four high and one medium', () => {
    expect(report.counts.high).toBe(4);
    expect(report.counts.medium).toBe(1);
  });

  it('summarises for the operator email', () => {
    expect(summariseVoiceLint(report)).toBe(
      '4 high, 1 medium: caller_pushback, compound_question x2, readiness_unanswered, split_question',
    );
  });
});

describe('precision — things that must NOT be flagged', () => {
  it('treats a multi-option triage question as one question', () => {
    const t =
      'bot:Are you already a client, looking for legal help for the first time, or calling about something else?\nhuman:New client.';
    expect(codes(t)).not.toContain('compound_question');
  });

  it('ignores caller barge-in when the agent starts a fresh sentence afterwards', () => {
    // Agent turn lacks terminal punctuation, but the next agent turn opens
    // with a capital, i.e. a new sentence rather than a severed one.
    const t = 'bot:Tell me how a lawyer can help you\nhuman:Sorry?\nbot:How can a lawyer help you today?';
    expect(codes(t)).not.toContain('split_question');
  });

  it('does not treat an ordinary "I said" as pushback', () => {
    const t = 'bot:Can I get your name?\nhuman:I said Adriano.';
    expect(codes(t)).not.toContain('caller_pushback');
  });

  it('returns clean for a well-run call', () => {
    const t = [
      'bot:Thanks for calling DRG Law. Are you already a client, looking for legal help for the first time, or calling about something else?',
      'human:First time.',
      'bot:Can I get your name?',
      'human:Maria.',
      "bot:What's the best phone number to reach you?",
      'human:Five one nine five five five zero one two three.',
      'bot:Tell me how a lawyer can help you today.',
      'human:I need help formalising my business.',
      'bot:Are you ready to move forward with a lawyer now?',
      'human:Yes, ready now.',
      "bot:Thank you, Maria. I'll pass this along. Our team will review this and follow up with you.",
    ].join('\n');
    const report = lintVoiceTranscript({
      transcript: t,
      readinessAnswered: true,
      callerName: 'Maria',
      callerPhone: '+15195550123',
    });
    expect(report.clean).toBe(true);
    expect(summariseVoiceLint(report)).toBeNull();
  });
});

describe('capture-gap checks', () => {
  it('flags a blank name', () => {
    expect(codes('bot:Hi.', { callerName: '   ' })).toContain('missing_caller_name');
  });

  it('flags GHL placeholder names', () => {
    for (const name of ['Guest Visitor 001', 'unknown', 'N/A', '+1 647 555 0123']) {
      expect(codes('bot:Hi.', { callerName: name })).toContain('missing_caller_name');
    }
  });

  it('flags an unusable callback number', () => {
    expect(codes('bot:Hi.', { callerPhone: '555' })).toContain('missing_callback_number');
    expect(codes('bot:Hi.', { callerPhone: null })).toContain('missing_callback_number');
  });

  it('accepts a formatted ten-digit number', () => {
    expect(codes('bot:Hi.', { callerPhone: '(519) 381-6270' })).not.toContain(
      'missing_callback_number',
    );
  });

  it('stays silent on readiness when the flag is absent rather than false', () => {
    expect(codes('bot:Hi.', { readinessAnswered: null })).not.toContain('readiness_unanswered');
    expect(codes('bot:Hi.', { readinessAnswered: true })).not.toContain('readiness_unanswered');
  });
});

describe('hard-rule checks', () => {
  it('flags a repeated closing line (H7)', () => {
    const t = [
      "bot:Thank you, Adriano. I'll pass this along. Our team will review this and follow up with you.",
      'human:Okay, thanks.',
      "bot:Thanks again. I'll pass this along.",
    ].join('\n');
    expect(codes(t)).toContain('double_close');
  });

  it('tolerates a missing or empty transcript without throwing', () => {
    expect(() => lintVoiceTranscript({ transcript: null })).not.toThrow();
    expect(lintVoiceTranscript({ transcript: '', callerName: 'A', callerPhone: '+15195550123' }).findings.map((f) => f.code)).toEqual([]);
  });
});
