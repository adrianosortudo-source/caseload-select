import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ASSIST_EMBED_BATCH, ASSIST_SHADOW_VERSION, embedAssistShadowTexts } from './openai-embed';

interface Candidate { chunk_id: string; source_hash: string; chunk_text: string }
interface Readiness { included_pages: number; unavailable_pages: number; source_chunks: number; indexed_chunks: number; ready: boolean }

export async function assistShadowReadiness(firmId: string): Promise<Readiness> {
  const { data, error } = await supabaseAdmin.rpc('assist_shadow_readiness', {
    p_firm_id: firmId, p_version: ASSIST_SHADOW_VERSION,
  }).single();
  if (error || !data) throw new Error('Could not read Firm Assist shadow index status.');
  return data as Readiness;
}

/** Explicit operator batches. The normal website crawler and serving routes never start this worker. */
export async function backfillAssistShadow(firmId: string, maxBatches: number) {
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 100) {
    throw new Error('Choose a batch limit from 1 to 100.');
  }
  const scope = { p_firm_id: firmId, p_version: ASSIST_SHADOW_VERSION };
  let batches = 0, offered = 0, saved = 0;
  let unchangedBatch = '';
  while (batches < maxBatches) {
    const { data, error } = await supabaseAdmin.rpc('assist_shadow_pending', { ...scope, p_limit: ASSIST_EMBED_BATCH });
    if (error || !Array.isArray(data)) throw new Error('Could not read pending Firm Assist chunks.');
    const candidates = data as Candidate[];
    if (!candidates.length) break;
    const signature = candidates.map(c => c.chunk_id + ':' + c.source_hash).join(',');
    if (signature === unchangedBatch) break;
    const vectors = await embedAssistShadowTexts(candidates.map(c => c.chunk_text));
    const rows = candidates.map((c, i) => ({
      chunk_id: c.chunk_id, source_hash: c.source_hash, embedding: '[' + vectors[i].join(',') + ']',
    }));
    const write = await supabaseAdmin.rpc('assist_shadow_store', { ...scope, p_rows: rows });
    if (write.error || !Number.isSafeInteger(write.data) || write.data < 0 || write.data > rows.length) {
      throw new Error('Could not confirm the Firm Assist shadow batch.');
    }
    // A concurrent crawl may invalidate every candidate. Re-read once, and
    // stop if the exact work repeats with no progress, avoiding paid replays.
    unchangedBatch = write.data === 0 ? signature : '';
    batches++;
    offered += rows.length;
    saved += write.data;
  }
  return { batches, offered, saved, readiness: await assistShadowReadiness(firmId) };
}
