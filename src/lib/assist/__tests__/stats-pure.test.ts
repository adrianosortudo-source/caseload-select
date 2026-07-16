import { describe, it, expect } from 'vitest';
import { summarizeAssistQueries } from '../stats-pure';

describe('summarizeAssistQueries', () => {
  it('returns zeros for an empty result set', () => {
    expect(summarizeAssistQueries([])).toEqual({
      questions: 0,
      answered: 0,
      screen_handoffs: 0,
      top_questions: [],
    });
  });

  it('counts answered and screen_handoff exits separately', () => {
    const result = summarizeAssistQueries([
      { question: 'Do you handle leases?', exit_type: 'answered' },
      { question: 'My landlord locked me out', exit_type: 'screen_handoff' },
      { question: 'What is the capital of France?', exit_type: 'no_coverage' },
    ]);
    expect(result.questions).toBe(3);
    expect(result.answered).toBe(1);
    expect(result.screen_handoffs).toBe(1);
  });

  it('groups near-duplicate questions case-insensitively and by whitespace', () => {
    const result = summarizeAssistQueries([
      { question: 'Do you handle leases?', exit_type: 'answered' },
      { question: '  DO YOU   handle leases?  ', exit_type: 'answered' },
      { question: 'do you handle leases?', exit_type: 'answered' },
    ]);
    expect(result.top_questions).toEqual([{ question: 'Do you handle leases?', count: 3 }]);
  });

  it('ranks top_questions by count, capped at 5', () => {
    const rows = [
      ...Array(3).fill({ question: 'A', exit_type: 'answered' }),
      ...Array(5).fill({ question: 'B', exit_type: 'answered' }),
      ...Array(1).fill({ question: 'C', exit_type: 'answered' }),
      ...Array(2).fill({ question: 'D', exit_type: 'answered' }),
      ...Array(4).fill({ question: 'E', exit_type: 'answered' }),
      ...Array(1).fill({ question: 'F', exit_type: 'answered' }),
    ];
    const result = summarizeAssistQueries(rows);
    expect(result.top_questions).toHaveLength(5);
    expect(result.top_questions[0]).toEqual({ question: 'B', count: 5 });
    expect(result.top_questions.map((q) => q.question)).not.toContain('F');
  });

  it('skips a blank question rather than polluting the top list', () => {
    const result = summarizeAssistQueries([
      { question: '   ', exit_type: 'no_coverage' },
      { question: 'Real question', exit_type: 'answered' },
    ]);
    expect(result.top_questions).toEqual([{ question: 'Real question', count: 1 }]);
    expect(result.questions).toBe(2);
  });
});
