/**
 * Stdin-to-stdout renderer for `renderBriefHtmlServer`.
 *
 * Reads a `brief_json` payload (the LawyerReport) from a file or stdin and
 * emits the rendered HTML string on stdout. Pairs with a separate Supabase
 * write step (e.g. via MCP, the admin reclassify route, or psql) — this
 * script does NOT touch the database. Useful when the local environment
 * is pointed at a different project than the one being patched.
 *
 * Usage:
 *   npx tsx scripts/render-brief-from-json.ts <brief.json> [<channel>] [<lang>]
 *   cat brief.json | npx tsx scripts/render-brief-from-json.ts - [channel] [lang]
 *
 * Default channel: voice. Default language: en.
 */
import { readFileSync } from 'fs';
import { renderBriefHtmlServer } from '../src/lib/screen-brief-html';
import type { Channel, LawyerReport } from '../src/lib/screen-engine/types';

const [, , source, channelArg, langArg] = process.argv;
if (!source) {
  console.error('Usage: npx tsx scripts/render-brief-from-json.ts <brief.json|-> [channel] [language]');
  process.exit(1);
}
const channel = (channelArg ?? 'voice') as Channel;
const language = langArg ?? 'en';

const raw = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
const report = JSON.parse(raw) as LawyerReport;
const html = renderBriefHtmlServer(report, channel, language);
process.stdout.write(html);
