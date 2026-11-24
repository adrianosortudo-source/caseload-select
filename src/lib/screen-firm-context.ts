import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ttl = 2 * 60 * 60 * 1000;

/** A separate capability for the public intake interpreter, not telemetry. */
export function mintScreenFirmContext(firmId: string, secret: string, now = Date.now()): string | undefined {
  if (!uuid.test(firmId) || secret.length < 32) return;
  const payload = Buffer.from(JSON.stringify({ scope: 'screen-intake-criteria', firmId, exp: now + ttl })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyScreenFirmContext(token: string, secret: string, now = Date.now()): string | undefined {
  if (secret.length < 32 || token.length > 1024) return;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return;
  const expected = createHmac('sha256', secret).update(parts[0]).digest('base64url');
  if (parts[1].length !== expected.length || !timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (data.scope !== 'screen-intake-criteria' || typeof data.firmId !== 'string' || !uuid.test(data.firmId)
      || !Number.isSafeInteger(data.exp) || data.exp <= now || data.exp > now + ttl) return;
    return data.firmId;
  } catch { return; }
}

export interface PublicIntakeCriteria {
  practiceAreas: { label: string; classification: string }[];
  questions: { area: string; text: string }[];
}

/** Project only question text intended for visitors and practice-area labels.
 * Internal scoring, signals and arbitrary custom instructions stay server-side. */
export function projectPublicIntakeCriteria(row: { practice_areas?: unknown; question_sets?: unknown }): PublicIntakeCriteria {
  const practiceAreas = Array.isArray(row.practice_areas) ? row.practice_areas.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const area = item as Record<string, unknown>;
    return typeof area.label === 'string' && area.label.length <= 160 && typeof area.classification === 'string'
      ? [{ label: area.label, classification: area.classification }] : [];
  }).slice(0, 30) : [];
  const sets = row.question_sets && typeof row.question_sets === 'object' && !Array.isArray(row.question_sets)
    ? Object.entries(row.question_sets as Record<string, unknown>) : [];
  const questions = sets.flatMap(([area, value]) => {
    if (area.length > 100 || !value || typeof value !== 'object') return [];
    const entries = (value as { questions?: unknown }).questions;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return [];
      const question = entry as { text?: unknown; type?: unknown };
      return typeof question.text === 'string' && question.text.trim() && question.text.length <= 300 && question.type !== 'info'
        ? [{ area, text: question.text.trim() }] : [];
    });
  }).slice(0, 80);
  return { practiceAreas, questions };
}

export async function readFirmIntakeCriteria(token: string): Promise<PublicIntakeCriteria | undefined> {
  const secret = process.env.SCREEN_INTAKE_CONTEXT_SECRET ?? '';
  const firmId = verifyScreenFirmContext(token, secret);
  if (!firmId) return;
  const { supabaseAdmin } = await import('./supabase-admin');
  const { data, error } = await supabaseAdmin.from('intake_firms')
    .select('practice_areas, question_sets').eq('id', firmId).maybeSingle();
  if (error || !data) return;
  return projectPublicIntakeCriteria(data);
}

export const fictionalIntakeCriteria: PublicIntakeCriteria = {
  practiceAreas: ['Business and corporate', 'Real estate', 'Employment', 'Wills and estates', 'Family']
    .map(label => ({ label, classification: 'primary' })),
  questions: [
    { area: 'all', text: 'What would you like the lawyer to help you with?' },
    { area: 'all', text: 'Is there a date or deadline the lawyer should know about?' },
  ],
};
