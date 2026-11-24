import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../screen-question-policy-admission', () => ({ admitScreenQuestionPolicy: (value: unknown) => value === 'grounded_v1' ? value : undefined }));
vi.mock('../rate-limit', () => ({ checkRateLimit: async () => ({ ok: true }), ipFromRequest: () => 'test', rateLimitHeaders: () => ({}) }));
vi.mock('../screen-llm-server', () => ({ llmExtractServer: vi.fn(async () => ({ mode: 'live', extracted: {} })) }));
vi.mock('../llm-option-map', () => ({ llmMapOptionReply: vi.fn(async () => ({ mode: 'live', value: null })) }));
import { handleScreenExtraction } from '../screen-extraction-handler';
import { llmExtractServer } from '../screen-llm-server';
import { llmMapOptionReply } from '../llm-option-map';

describe('grounded enquiry transport', () => {
  beforeEach(() => vi.clearAllMocks());
  it('passes prior question, reply, uncertain answer and fictional firm criteria to the same interpreter', async () => {
    const request = new Request('https://example.test/api/extract', { method: 'POST', body: JSON.stringify({
      description: 'I need help after my role ended.', matter_type: 'employment_general', family_enabled: false,
      question_policy: 'grounded_v1', firm_criteria_token: 'fictional-preview',
      pending_slot_id: 'written_timing', reply: 'Next Friday', review_question: 'When is a reply due?',
      conversation: { turns: [{ text: 'Not sure', question: 'What was offered?', answersQuestion: false, correction: false }],
        asked: [{ id: 'written_goal', answer: 'Not sure' }],
        priorRequests: [{ quote: 'help after my role ended', matter: 'employment_general' }] },
    }) });
    const response = await handleScreenExtraction(request, 'openai');
    expect(response.status).toBe(200);
    const call = vi.mocked(llmExtractServer).mock.calls[0] as unknown as [string, { intake_reading: { turns: unknown[] } }, number, string, unknown, { question: string; asked: unknown[]; firmCriteria: { practiceAreas: unknown[] } }];
    expect(call[1].intake_reading.turns[0]).toMatchObject({ text: 'Not sure', question: 'What was offered?', answersQuestion: false });
    expect(call[5]).toMatchObject({ question: 'When is a reply due?', asked: [{ id: 'written_goal', answer: 'Not sure' }] });
    expect(call[5]).toMatchObject({ priorRequests: [{ quote: 'help after my role ended', matter: 'employment_general' }] });
    expect(call[5].firmCriteria.practiceAreas).toHaveLength(5);
    expect(llmMapOptionReply).not.toHaveBeenCalled();
  });
});
