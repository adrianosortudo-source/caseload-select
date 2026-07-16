/**
 * Retrieval for Firm Assist (DR-100). Wraps the match_assist_chunks RPC
 * (see supabase/migrations/20260716000000_firm_assist_corpus.sql), since
 * supabase-js cannot express the pgvector `<=>` operator directly.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { RetrievedChunk } from './answer-prompt';

const DEFAULT_MATCH_COUNT = 8;
const DEFAULT_SIMILARITY_FLOOR = 0.55;

interface MatchRow {
  chunk_id: string;
  page_id: string;
  heading: string | null;
  chunk_text: string;
  similarity: number;
}

/**
 * Cosine-similarity top-k over a firm's corpus chunks. queryEmbedding is a
 * 768-float vector (see gemini-embed.ts embedQuery). Returns an empty array
 * (never throws) on an RPC error so the caller can degrade to
 * intent=out_of_corpus rather than 500ing the visitor's question.
 */
export async function retrieveChunks(
  firmId: string,
  queryEmbedding: number[],
  opts?: { matchCount?: number; similarityFloor?: number },
): Promise<RetrievedChunk[]> {
  const { data, error } = await supabase.rpc('match_assist_chunks', {
    query_embedding: `[${queryEmbedding.join(',')}]`,
    match_firm_id: firmId,
    match_count: opts?.matchCount ?? DEFAULT_MATCH_COUNT,
    similarity_floor: opts?.similarityFloor ?? DEFAULT_SIMILARITY_FLOOR,
  });

  if (error) {
    console.warn('[assist/retrieve] match_assist_chunks RPC error:', error.message);
    return [];
  }

  return ((data ?? []) as MatchRow[]).map((row) => ({
    page_id: row.page_id,
    heading: row.heading,
    chunk_text: row.chunk_text,
  }));
}
