import { describe, it, expect } from 'vitest';
import {
  validateQuestion,
  resolveAllowedOrigin,
  buildExitResponse,
  SCREEN_HANDOFF_MESSAGE,
  NO_COVERAGE_MESSAGE,
  type SourcePage,
} from '../answer-route-pure';
import type { AnswerModelResponse } from '../answer-prompt';

describe('validateQuestion', () => {
  it('accepts a well-formed question', () => {
    const result = validateQuestion('Do you handle commercial lease reviews?');
    expect(result.ok).toBe(true);
    expect(result.question).toBe('Do you handle commercial lease reviews?');
  });

  it('rejects a non-string', () => {
    expect(validateQuestion(42).ok).toBe(false);
    expect(validateQuestion(null).ok).toBe(false);
    expect(validateQuestion(undefined).ok).toBe(false);
  });

  it('rejects a too-short question after trim', () => {
    expect(validateQuestion('  hi ').ok).toBe(false);
  });

  it('rejects a question over the length cap', () => {
    expect(validateQuestion('a'.repeat(501)).ok).toBe(false);
  });

  it('accepts a question exactly at the length cap', () => {
    expect(validateQuestion('a'.repeat(500)).ok).toBe(true);
  });

  it('strips HTML tags before validating', () => {
    const result = validateQuestion('<script>alert(1)</script>What is a lease?');
    expect(result.ok).toBe(true);
    expect(result.question).toBe('alert(1)What is a lease?');
    expect(result.question).not.toContain('<script>');
  });
});

describe('resolveAllowedOrigin', () => {
  it('returns null when no Origin header is present', () => {
    expect(resolveAllowedOrigin(null, ['https://drglaw.ca'], null)).toBeNull();
  });

  it('matches an origin on the embed_origins allow-list', () => {
    expect(resolveAllowedOrigin('https://drglaw.ca', ['https://drglaw.ca'], null)).toBe('https://drglaw.ca');
  });

  it('rejects an origin not on the allow-list', () => {
    expect(resolveAllowedOrigin('https://evil.example', ['https://drglaw.ca'], null)).toBeNull();
  });

  it('matches the firm custom_domain (apex and www)', () => {
    expect(resolveAllowedOrigin('https://drglaw.ca', [], 'drglaw.ca')).toBe('https://drglaw.ca');
    expect(resolveAllowedOrigin('https://www.drglaw.ca', [], 'drglaw.ca')).toBe('https://www.drglaw.ca');
  });

  it('is case-insensitive and trailing-slash tolerant', () => {
    expect(resolveAllowedOrigin('https://DRGLaw.ca/', ['https://drglaw.ca'], null)).toBe('https://DRGLaw.ca/');
  });

  it('rejects everything when no embed_origins and no custom_domain are configured', () => {
    expect(resolveAllowedOrigin('https://drglaw.ca', [], null)).toBeNull();
  });
});

describe('buildExitResponse', () => {
  const pagesById = new Map<string, SourcePage>([
    ['page-1', { id: 'page-1', title: 'Commercial Leases', url: 'https://drglaw.ca/journal/leases' }],
  ]);

  it('maps case_specific to the fixed screen_handoff copy, never the model text', () => {
    const modelResponse: AnswerModelResponse = {
      intent: 'case_specific',
      answer_html: '<p>ignored model text</p>',
      source_page_ids: [],
    };
    const result = buildExitResponse(modelResponse, pagesById);
    expect(result).toEqual({ exit: 'screen_handoff', message: SCREEN_HANDOFF_MESSAGE });
  });

  it('maps out_of_corpus to the fixed no_coverage copy', () => {
    const modelResponse: AnswerModelResponse = {
      intent: 'out_of_corpus',
      answer_html: '',
      source_page_ids: [],
    };
    const result = buildExitResponse(modelResponse, pagesById);
    expect(result).toEqual({ exit: 'no_coverage', message: NO_COVERAGE_MESSAGE });
  });

  it('maps informational to answered with resolved sources', () => {
    const modelResponse: AnswerModelResponse = {
      intent: 'informational',
      answer_html: '<p>The firm reviews commercial leases before signing.</p>',
      source_page_ids: ['page-1'],
    };
    const result = buildExitResponse(modelResponse, pagesById);
    expect(result.exit).toBe('answered');
    if (result.exit === 'answered') {
      expect(result.answer_html).toContain('reviews commercial leases');
      expect(result.sources).toEqual([{ title: 'Commercial Leases', url: 'https://drglaw.ca/journal/leases' }]);
    }
  });

  it('drops a hallucinated source_page_id silently instead of surfacing a broken link', () => {
    const modelResponse: AnswerModelResponse = {
      intent: 'informational',
      answer_html: '<p>Some answer.</p>',
      source_page_ids: ['page-1', 'page-does-not-exist'],
    };
    const result = buildExitResponse(modelResponse, pagesById);
    expect(result.exit).toBe('answered');
    if (result.exit === 'answered') {
      expect(result.sources).toHaveLength(1);
    }
  });

  it('sanitizes the model answer_html (strips a script tag)', () => {
    const modelResponse: AnswerModelResponse = {
      intent: 'informational',
      answer_html: '<p>Safe text</p><script>alert(1)</script>',
      source_page_ids: [],
    };
    const result = buildExitResponse(modelResponse, pagesById);
    expect(result.exit).toBe('answered');
    if (result.exit === 'answered') {
      expect(result.answer_html).not.toContain('<script>');
      expect(result.answer_html).not.toContain('alert(1)');
      expect(result.answer_html).toContain('Safe text');
    }
  });

  describe('href host constraint (Ses.18 audit F6b)', () => {
    it('keeps a link pointing at a source page host', () => {
      const modelResponse: AnswerModelResponse = {
        intent: 'informational',
        answer_html: '<p>See <a href="https://drglaw.ca/journal/leases">this page</a>.</p>',
        source_page_ids: ['page-1'],
      };
      const result = buildExitResponse(modelResponse, pagesById);
      expect(result.exit).toBe('answered');
      if (result.exit === 'answered') {
        expect(result.answer_html).toContain('<a href="https://drglaw.ca/journal/leases">');
      }
    });

    it('unwraps a link to a host that is neither a source page nor the custom domain', () => {
      const modelResponse: AnswerModelResponse = {
        intent: 'informational',
        answer_html: '<p>See <a href="https://evil.example/steal">this</a>.</p>',
        source_page_ids: [],
      };
      const result = buildExitResponse(modelResponse, pagesById);
      expect(result.exit).toBe('answered');
      if (result.exit === 'answered') {
        expect(result.answer_html).not.toContain('<a ');
        expect(result.answer_html).not.toContain('evil.example');
      }
    });

    it('keeps a link to the firm custom_domain even without a matching source page', () => {
      const modelResponse: AnswerModelResponse = {
        intent: 'informational',
        answer_html: '<p><a href="https://drglaw.ca/contact">Contact</a></p>',
        source_page_ids: [],
      };
      const result = buildExitResponse(modelResponse, pagesById, 'drglaw.ca');
      expect(result.exit).toBe('answered');
      if (result.exit === 'answered') {
        expect(result.answer_html).toContain('<a href="https://drglaw.ca/contact">');
      }
    });
  });
});
