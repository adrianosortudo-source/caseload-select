/**
 * One-off: re-render `screened_leads.brief_html` from the stored `brief_json`
 * for a given row id. Used after a renderer change ships and existing rows
 * need to pick up the new layout without re-running the engine pipeline.
 *
 * Usage:
 *   npx tsx scripts/regen-brief-html.ts <row-id> [<channel>] [<intake-language>]
 *
 * Default channel: voice. Default language: en.
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env (.env.local already
 * carries them in the dev environment).
 */
import { readFileSync } from 'fs';
// Inline minimal dotenv parser — handles quoted values, unquoted values with
// special chars (angle brackets, spaces), comments, and blank lines. Avoids
// adding a dependency for a one-off operator script.
try {
  const raw = readFileSync('.env.local', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
} catch (err) {
  console.error('Could not read .env.local:', (err as Error).message);
}

import { createClient } from '@supabase/supabase-js';
import { renderBriefHtmlServer } from '../src/lib/screen-brief-html';
import type { Channel, LawyerReport } from '../src/lib/screen-engine/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const [, , rowId, channelArg, langArg] = process.argv;
if (!rowId) {
  console.error('Usage: npx tsx scripts/regen-brief-html.ts <row-id> [channel] [language]');
  process.exit(1);
}
const channel = (channelArg ?? 'voice') as Channel;
const language = langArg ?? 'en';

const supabase = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  const { data, error } = await supabase
    .from('screened_leads')
    .select('id, brief_json')
    .eq('id', rowId)
    .maybeSingle();
  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }
  if (!data) {
    console.error('Row not found:', rowId);
    process.exit(1);
  }
  const report = data.brief_json as LawyerReport;
  if (!report || !report.axis_reasoning) {
    console.error('brief_json missing axis_reasoning; cannot re-render four-axis section.');
    process.exit(1);
  }
  const html = renderBriefHtmlServer(report, channel, language);
  const { error: updErr } = await supabase
    .from('screened_leads')
    .update({ brief_html: html, updated_at: new Date().toISOString() })
    .eq('id', rowId);
  if (updErr) {
    console.error('Update failed:', updErr.message);
    process.exit(1);
  }
  console.log(`✓ Re-rendered brief_html for ${rowId}`);
  console.log(`  length: ${html.length} chars`);
  console.log(`  has axis-breakdown: ${html.includes('axis-breakdown')}`);
  console.log(`  has "Why this is Band": ${html.includes('Why this is Band')}`);
})();
