-- Firm Assist (grounded per-firm website answer surface). DR-100, DR-101, DR-102.
--
-- Three new tables, all born exposed per the Database Access Invariant: RLS is
-- enabled + forced and every grant to anon / authenticated / PUBLIC is revoked
-- in this same file. The app reads and writes through the service role only.
--
-- assist_corpus_pages   operator-curated per-firm page allow-list (DR-101)
-- assist_corpus_chunks  retrieval store, one row per chunk, pgvector embedding
-- assist_queries        analytics log of every question asked + how it was answered

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS assist_corpus_pages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  url              text NOT NULL,
  title            text,
  include          boolean NOT NULL DEFAULT true,
  exclude_reason   text,
  last_crawled_at  timestamptz,
  last_crawl_status text,
  content_hash     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firm_id, url)
);

CREATE INDEX IF NOT EXISTS idx_assist_corpus_pages_firm ON assist_corpus_pages (firm_id);
CREATE INDEX IF NOT EXISTS idx_assist_corpus_pages_firm_include ON assist_corpus_pages (firm_id) WHERE include = true;

ALTER TABLE assist_corpus_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE assist_corpus_pages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON assist_corpus_pages FROM anon, authenticated, PUBLIC;

COMMENT ON TABLE assist_corpus_pages IS
  'Per-firm operator-curated page allow-list grounding Firm Assist (DR-101). Service-role access only.';

CREATE TABLE IF NOT EXISTS assist_corpus_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id      uuid NOT NULL REFERENCES assist_corpus_pages(id) ON DELETE CASCADE,
  firm_id      uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  heading      text,
  chunk_text   text NOT NULL,
  embedding    vector(768) NOT NULL,
  chunk_index  int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assist_corpus_chunks_firm ON assist_corpus_chunks (firm_id);
CREATE INDEX IF NOT EXISTS idx_assist_corpus_chunks_page ON assist_corpus_chunks (page_id);
CREATE INDEX IF NOT EXISTS idx_assist_corpus_chunks_embedding_hnsw
  ON assist_corpus_chunks USING hnsw (embedding vector_cosine_ops);

ALTER TABLE assist_corpus_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE assist_corpus_chunks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON assist_corpus_chunks FROM anon, authenticated, PUBLIC;

COMMENT ON TABLE assist_corpus_chunks IS
  'Retrieval store for Firm Assist (DR-100). One row per embedded chunk of an included corpus page. Service-role access only.';

CREATE TABLE IF NOT EXISTS assist_queries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  question         text NOT NULL,
  intent           text CHECK (intent IN ('informational', 'case_specific', 'out_of_corpus')),
  answer_html      text,
  source_page_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  exit_type        text,
  latency_ms       int,
  model            text,
  visitor_hash     text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assist_queries_firm_created ON assist_queries (firm_id, created_at DESC);

ALTER TABLE assist_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE assist_queries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON assist_queries FROM anon, authenticated, PUBLIC;

COMMENT ON TABLE assist_queries IS
  'Analytics log for Firm Assist (DR-102: no lead/contact data, ever). Question text, intent classification, exit type. visitor_hash is a salted hash, never a raw IP. Service-role access only.';

-- Retrieval RPC. supabase-js cannot express the pgvector <=> operator directly,
-- so cosine similarity search runs through this SECURITY DEFINER function,
-- called via supabase.rpc(). Firm-scoped by a required match_firm_id argument
-- (never trust a client-supplied filter without a matching WHERE clause here).
CREATE OR REPLACE FUNCTION match_assist_chunks(
  query_embedding vector(768),
  match_firm_id uuid,
  match_count int DEFAULT 8,
  similarity_floor float DEFAULT 0.55
)
RETURNS TABLE (
  chunk_id uuid,
  page_id uuid,
  heading text,
  chunk_text text,
  similarity float
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS chunk_id,
    c.page_id,
    c.heading,
    c.chunk_text,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM assist_corpus_chunks c
  WHERE c.firm_id = match_firm_id
    AND 1 - (c.embedding <=> query_embedding) >= similarity_floor
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION match_assist_chunks FROM PUBLIC, anon, authenticated;
