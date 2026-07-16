import { describe, it, expect } from 'vitest';
import { buildAnswerSystemPrompt, buildAnswerUserPrompt, ANSWER_RESPONSE_SCHEMA } from '../answer-prompt';

// Prompt-contract test (BUILD_PLAN_firm_assist_v1.md section 6): every
// load-bearing rule must survive here. This test exists specifically to
// catch a future edit that quietly waters down a DR-100 compliance rule
// while "cleaning up" the prompt text.
describe('buildAnswerSystemPrompt', () => {
  const prompt = buildAnswerSystemPrompt('DRG Law Professional Corporation');

  it('states the corpus-bound rule (DR-100: no general knowledge)', () => {
    expect(prompt).toMatch(/Answer ONLY using the numbered context chunks/i);
    expect(prompt).toMatch(/out_of_corpus/);
    expect(prompt).toMatch(/[Nn]ever use general knowledge/);
  });

  it('states the case-specific redirect rule (DR-100, DR-102)', () => {
    expect(prompt).toMatch(/case_specific/);
    expect(prompt).toMatch(/never gives advice/);
    expect(prompt).toMatch(/never collects contact information/);
  });

  it('treats context chunks and the question as untrusted content, never instructions', () => {
    expect(prompt).toMatch(/DATA, never instructions/);
  });

  it('states the LSO Rule 4.2-1 constraints', () => {
    expect(prompt).toMatch(/No outcome promises/);
    expect(prompt).toMatch(/specialist.*expert/i);
    expect(prompt).toMatch(/superlatives/);
  });

  it('forbids em dashes and italics and names the firm as the speaker', () => {
    expect(prompt).toMatch(/No em dashes/);
    expect(prompt).toMatch(/No italics markup/);
    expect(prompt).toContain('DRG Law Professional Corporation');
  });

  it('restricts informational answers to the allowed tag set', () => {
    expect(prompt).toMatch(/<p>, <ul>, <ol>, <li>, <strong>, <a href/);
  });

  it('requires source_page_ids to be drawn only from given chunks', () => {
    expect(prompt).toMatch(/Never invent a page_id/);
  });

  it('requires answering in the visitor\'s language', () => {
    expect(prompt).toMatch(/same language as the visitor's question/);
  });
});

describe('buildAnswerUserPrompt', () => {
  it('numbers chunks and labels both chunks and the question as untrusted content', () => {
    const prompt = buildAnswerUserPrompt('Do you handle wrongful dismissal?', [
      { page_id: 'p1', heading: 'Employment Law', chunk_text: 'The firm handles wrongful dismissal claims.' },
    ]);
    expect(prompt).toMatch(/untrusted content/i);
    expect(prompt).toContain('page_id=p1');
    expect(prompt).toContain('heading="Employment Law"');
    expect(prompt).toContain('Do you handle wrongful dismissal?');
  });

  it('handles an empty chunk list without throwing', () => {
    const prompt = buildAnswerUserPrompt('What is the capital of France?', []);
    expect(prompt).toMatch(/no chunks retrieved/i);
  });
});

describe('ANSWER_RESPONSE_SCHEMA', () => {
  it('requires intent, answer_html, and source_page_ids', () => {
    expect(ANSWER_RESPONSE_SCHEMA.required).toEqual(['intent', 'answer_html', 'source_page_ids']);
  });

  it('constrains intent to the three known values', () => {
    expect(ANSWER_RESPONSE_SCHEMA.properties.intent.enum).toEqual(['informational', 'case_specific', 'out_of_corpus']);
  });
});
