import 'server-only';
import { getProvider, hasOpenAIKey } from '../ai/openai';

export const openaiAnswerOption = {
  consentVersion: 'firm-assist-openai-answer-v1',
  disclosure: 'Google processes your question to search this firm’s approved pages. If you choose OpenAI, your question and relevant excerpts from those pages go to OpenAI to generate an answer. You can also use the existing Google answer service.',
} as const;

export function offersOpenAIAnswers(firmId: string): boolean {
  if (getProvider('FIRM_ASSIST_ANSWER_AI_PROVIDER') !== 'openai' || !hasOpenAIKey()) return false;
  return (process.env.FIRM_ASSIST_OPENAI_FIRM_IDS ?? '').split(',').some(id => id.trim() === firmId);
}
