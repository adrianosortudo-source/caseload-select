-- Opt-in offline backfill only. The existing Gemini index and match RPC keep serving.
CREATE TABLE public.assist_shadow_embeddings (
  chunk_id uuid NOT NULL REFERENCES public.assist_corpus_chunks(id) ON DELETE CASCADE,
  index_version text NOT NULL CHECK (index_version = 'openai/text-embedding-3-small/768/v1'),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  embedding vector(768) NOT NULL CHECK (vector_norm(embedding) > 0),
  PRIMARY KEY (chunk_id, index_version)
);
ALTER TABLE public.assist_shadow_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assist_shadow_embeddings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.assist_shadow_embeddings FROM PUBLIC, anon, authenticated, service_role;

-- Tenant ownership is inherited from the canonical chunk AND its page. The
-- hash covers the exact UTF-8 bytes the OpenAI adapter embeds. Headings and URLs
-- are read from the canonical records, so they cannot go stale in this index.
CREATE VIEW public.assist_shadow_sources WITH (security_invoker = true) AS
SELECT p.firm_id, p.id AS page_id, c.id AS chunk_id, c.heading, c.chunk_text,
       encode(sha256(convert_to(c.chunk_text, 'UTF8')), 'hex') AS source_hash
FROM public.assist_corpus_pages p
JOIN public.assist_corpus_chunks c ON c.page_id = p.id AND c.firm_id = p.firm_id
WHERE p.include AND p.content_hash IS NOT NULL AND p.last_crawl_status IN ('ok', 'unchanged');
REVOKE ALL ON public.assist_shadow_sources FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.assist_shadow_pending(p_firm_id uuid, p_version text, p_limit integer)
RETURNS TABLE (chunk_id uuid, source_hash text, chunk_text text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, extensions, pg_temp AS $$
  SELECT s.chunk_id, s.source_hash, s.chunk_text
  FROM public.assist_shadow_sources s
  WHERE s.firm_id = p_firm_id AND NOT EXISTS (
    SELECT 1 FROM public.assist_shadow_embeddings e
    WHERE e.chunk_id = s.chunk_id AND e.index_version = p_version AND e.source_hash = s.source_hash
  )
  ORDER BY s.chunk_id LIMIT least(greatest(coalesce(p_limit, 0), 0), 20)
$$;

CREATE FUNCTION public.assist_shadow_store(p_firm_id uuid, p_version text, p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions, pg_temp AS $$
DECLARE saved integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Expected 1 to 20 embedding rows';
  END IF;
  -- A changed chunk, excluded page, or foreign tenant cannot accept an old
  -- batch. Lock the matching source rows until commit to serialize concurrent
  -- crawls and prevent a stale result from replacing a newer embedding.
  WITH current_rows AS MATERIALIZED (
    SELECT s.chunk_id, s.source_hash, r.embedding
    FROM jsonb_to_recordset(p_rows) AS r(chunk_id uuid, source_hash text, embedding text)
    JOIN public.assist_shadow_sources s ON s.chunk_id = r.chunk_id AND s.source_hash = r.source_hash
    WHERE s.firm_id = p_firm_id
    ORDER BY s.page_id, s.chunk_id FOR SHARE OF s
  )
  INSERT INTO public.assist_shadow_embeddings AS e (chunk_id, index_version, source_hash, embedding)
  SELECT chunk_id, p_version, source_hash, embedding::vector(768) FROM current_rows
  ON CONFLICT (chunk_id, index_version) DO UPDATE SET source_hash = excluded.source_hash, embedding = excluded.embedding
  WHERE e.source_hash <> excluded.source_hash;
  GET DIAGNOSTICS saved = ROW_COUNT;
  RETURN saved;
END
$$;

CREATE FUNCTION public.assist_shadow_readiness(p_firm_id uuid, p_version text)
RETURNS TABLE (included_pages bigint, unavailable_pages bigint, source_chunks bigint, indexed_chunks bigint, ready boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, extensions, pg_temp AS $$
  WITH sources AS MATERIALIZED (
    SELECT s.page_id, s.chunk_id, s.source_hash FROM public.assist_shadow_sources s WHERE s.firm_id = p_firm_id
  ), pages AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE NOT EXISTS (
      SELECT 1 FROM sources s WHERE s.page_id = p.id
    )) AS unavailable
    FROM public.assist_corpus_pages p WHERE p.firm_id = p_firm_id AND p.include
  ), chunks AS (
    SELECT count(*) AS total, count(e.chunk_id) AS indexed FROM sources s
    LEFT JOIN public.assist_shadow_embeddings e
      ON e.chunk_id = s.chunk_id AND e.index_version = p_version AND e.source_hash = s.source_hash
  )
  SELECT p.total, p.unavailable, c.total, c.indexed,
         p.total > 0 AND p.unavailable = 0 AND c.total > 0 AND c.indexed = c.total
  FROM pages p CROSS JOIN chunks c
$$;

-- Per-firm exact cosine search for shadow QA. Readiness and matching share
-- one statement snapshot. No serving route calls this function.
CREATE FUNCTION public.match_assist_shadow_chunks(p_firm_id uuid, p_version text, p_query vector, p_limit integer)
RETURNS TABLE (chunk_id uuid, page_id uuid, heading text, chunk_text text, similarity double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, extensions, pg_temp AS $$
  SELECT s.chunk_id, s.page_id, s.heading, s.chunk_text, 1 - (e.embedding <=> p_query)
  FROM public.assist_shadow_sources s
  JOIN public.assist_shadow_embeddings e
    ON e.chunk_id = s.chunk_id AND e.index_version = p_version AND e.source_hash = s.source_hash
  WHERE s.firm_id = p_firm_id AND vector_dims(p_query) = 768 AND vector_norm(p_query) > 0
    AND (SELECT r.ready FROM public.assist_shadow_readiness(p_firm_id, p_version) r)
  ORDER BY e.embedding <=> p_query, s.chunk_id LIMIT least(greatest(coalesce(p_limit, 0), 0), 100)
$$;

REVOKE ALL ON FUNCTION public.assist_shadow_pending(uuid,text,integer),
  public.assist_shadow_store(uuid,text,jsonb), public.assist_shadow_readiness(uuid,text),
  public.match_assist_shadow_chunks(uuid,text,vector,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assist_shadow_pending(uuid,text,integer),
  public.assist_shadow_store(uuid,text,jsonb), public.assist_shadow_readiness(uuid,text),
  public.match_assist_shadow_chunks(uuid,text,vector,integer) TO service_role;
