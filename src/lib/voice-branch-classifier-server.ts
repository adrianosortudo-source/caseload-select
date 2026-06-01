import 'server-only';

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  classifyVoiceBranchHeuristic,
  type VoiceFineBranch,
} from '@/lib/voice-branch-classifier';

const MODEL = 'gemini-2.5-flash';
const MAX_TRANSCRIPT_LENGTH = 6000;

const VALID_BRANCHES: readonly VoiceFineBranch[] = [
  'new_matter',
  'existing_client',
  'admin',
  'court_or_counsel',
  'vendor',
  'wrong_number',
  'unclear',
];

export interface VoiceBranchClassifierResult {
  branch: VoiceFineBranch;
  mode: 'live' | 'disabled' | 'error' | 'heuristic';
  reason?: string;
}

function isValidBranch(value: unknown): value is VoiceFineBranch {
  return typeof value === 'string' && VALID_BRANCHES.includes(value as VoiceFineBranch);
}

function buildPrompt(transcript: string): string {
  return [
    'You classify a Canadian law firm voice-call transcript for routing.',
    '',
    'Return JSON only: {"branch":"..."}',
    '',
    'Allowed branch values:',
    '- new_matter: caller is a potential new client with a new legal matter',
    '- existing_client: caller says they are a current/existing client or asks about an existing file/case',
    '- admin: billing, scheduling, documents, office/admin, callback request, non-legal operations',
    '- court_or_counsel: court staff, judge assistant, opposing counsel, process server, clerk, subpoena/summons/hearing logistics',
    '- vendor: sales, marketing, supplier, vendor, robocall',
    '- wrong_number: caller says wrong number or called by mistake',
    '- unclear: not enough information or marker/classification is ambiguous',
    '',
    'Rules:',
    '- Do not classify as new_matter merely because the firm practices law.',
    '- If the caller mentions an existing file/case/client relationship, choose existing_client unless they clearly describe a new separate matter.',
    '- If the caller is court staff or opposing counsel, choose court_or_counsel.',
    '- If uncertain between new_matter and non-intake, choose unclear.',
    '',
    'Transcript:',
    transcript.slice(0, MAX_TRANSCRIPT_LENGTH),
  ].join('\n');
}

export async function classifyVoiceBranchServer(
  transcript: string,
): Promise<VoiceBranchClassifierResult> {
  const heuristic = classifyVoiceBranchHeuristic(transcript);
  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { branch: heuristic, mode: 'disabled', reason: 'No Gemini API key configured' };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    });
    const result = await model.generateContent(buildPrompt(transcript ?? ''));
    const raw = result.response.text();
    const parsed = JSON.parse(raw) as { branch?: unknown };
    if (!isValidBranch(parsed.branch)) {
      return { branch: heuristic, mode: 'error', reason: `invalid branch: ${String(parsed.branch)}` };
    }
    return { branch: parsed.branch, mode: 'live' };
  } catch (err) {
    return {
      branch: heuristic,
      mode: 'error',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
