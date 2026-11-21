-- Run only on a local fictional fixture database after the source and shadow migrations.
BEGIN;
INSERT INTO public.intake_firms(id, name) VALUES
  ('10000000-0000-0000-0000-000000000001','Fictional Shadow A'),
  ('10000000-0000-0000-0000-000000000002','Fictional Shadow B');
DO $test$
DECLARE
  a uuid := '10000000-0000-0000-0000-000000000001';
  b uuid := '10000000-0000-0000-0000-000000000002';
  pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); px uuid := gen_random_uuid();
  ca uuid := gen_random_uuid(); cb uuid := gen_random_uuid(); replacement uuid := gen_random_uuid();
  v text := 'openai/text-embedding-3-small/768/v1';
  vec vector := (ARRAY[1,0]::real[] || array_fill(0::real, ARRAY[766]))::vector;
  saved_a jsonb; saved_b jsonb; fresh jsonb; result record; role_name text;
BEGIN
  ASSERT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.assist_shadow_embeddings'::regclass);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    ASSERT NOT has_table_privilege(role_name, 'public.assist_shadow_embeddings', 'SELECT,INSERT,UPDATE,DELETE');
    ASSERT NOT has_table_privilege(role_name, 'public.assist_shadow_sources', 'SELECT');
    ASSERT has_function_privilege(role_name,'public.assist_shadow_pending(uuid,text,integer)','EXECUTE') = (role_name='service_role');
    ASSERT has_function_privilege(role_name,'public.assist_shadow_store(uuid,text,jsonb)','EXECUTE') = (role_name='service_role');
    ASSERT has_function_privilege(role_name,'public.assist_shadow_readiness(uuid,text)','EXECUTE') = (role_name='service_role');
    ASSERT has_function_privilege(role_name,'public.match_assist_shadow_chunks(uuid,text,vector,integer)','EXECUTE') = (role_name='service_role');
  END LOOP;
  INSERT INTO public.assist_corpus_pages(id, firm_id, url, include, content_hash, last_crawl_status) VALUES
    (pa,a,'https://a.example/a',true,'source-a','ok'),(pb,b,'https://b.example/b',true,'source-b','ok'),
    (px,a,'https://a.example/excluded',false,'source-x','ok');
  INSERT INTO public.assist_corpus_chunks(id,page_id,firm_id,chunk_text,embedding) VALUES
    (ca,pa,a,'Fictional A',vec),(cb,pb,b,'Fictional B',vec),(gen_random_uuid(),px,a,'Excluded',vec),
    (gen_random_uuid(),pa,b,'Mismatched legacy ownership',vec);
  ASSERT (SELECT count(*) FROM public.assist_shadow_pending(a,v,20)) = 1;
  ASSERT (SELECT count(*) FROM public.assist_shadow_pending(b,v,20)) = 1;
  SELECT jsonb_build_array(jsonb_build_object('chunk_id',chunk_id,'source_hash',source_hash,'embedding',vec::text))
    INTO saved_a FROM public.assist_shadow_pending(a,v,20);
  SELECT jsonb_build_array(jsonb_build_object('chunk_id',chunk_id,'source_hash',source_hash,'embedding',vec::text))
    INTO saved_b FROM public.assist_shadow_pending(b,v,20);
  ASSERT public.assist_shadow_store(a,v,saved_b)=0;
  ASSERT public.assist_shadow_store(b,v,saved_a)=0;
  BEGIN
    PERFORM public.assist_shadow_store(a,v,jsonb_set(saved_a,'{0,embedding}',to_jsonb('[1,0]'::text)));
    RAISE EXCEPTION 'Wrong-dimension vector was accepted';
  EXCEPTION WHEN data_exception THEN NULL;
  END;
  BEGIN
    PERFORM public.assist_shadow_store(a,v,jsonb_set(saved_a,'{0,embedding}',to_jsonb((array_fill(0::real, ARRAY[768])::vector)::text)));
    RAISE EXCEPTION 'Zero vector was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT public.assist_shadow_store(a,v,saved_a)=1;
  ASSERT public.assist_shadow_store(a,v,saved_a)=0;
  ASSERT public.assist_shadow_store(b,v,saved_b)=1;
  SELECT * INTO result FROM public.assist_shadow_readiness(a,v);
  ASSERT result.ready AND result.included_pages=1 AND result.indexed_chunks=1 AND result.source_chunks=1;
  ASSERT (SELECT chunk_id FROM public.match_assist_shadow_chunks(a,v,vec,8))=ca;
  ASSERT (SELECT chunk_id FROM public.match_assist_shadow_chunks(b,v,vec,8))=cb;
  ASSERT NOT (SELECT ready FROM public.assist_shadow_readiness(a,'different-model'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.match_assist_shadow_chunks(a,'different-model',vec,8));
  UPDATE public.assist_corpus_pages SET last_crawl_status='unchanged', last_crawled_at=now() WHERE id=pa;
  ASSERT (SELECT ready FROM public.assist_shadow_readiness(a,v));
  ASSERT NOT EXISTS (SELECT 1 FROM public.assist_shadow_pending(a,v,20));
  UPDATE public.assist_corpus_pages SET last_crawl_status='error' WHERE id=pa;
  ASSERT (SELECT unavailable_pages=1 AND NOT ready FROM public.assist_shadow_readiness(a,v));
  ASSERT NOT EXISTS (SELECT 1 FROM public.match_assist_shadow_chunks(a,v,vec,8));
  ASSERT public.assist_shadow_store(a,v,saved_a)=0;
  UPDATE public.assist_corpus_pages SET last_crawl_status='ok' WHERE id=pa;
  UPDATE public.assist_corpus_chunks SET chunk_text='Fictional A revised' WHERE id=ca;
  ASSERT public.assist_shadow_store(a,v,saved_a)=0;
  ASSERT NOT (SELECT ready FROM public.assist_shadow_readiness(a,v));
  SELECT jsonb_build_array(jsonb_build_object('chunk_id',chunk_id,'source_hash',source_hash,'embedding',vec::text))
    INTO fresh FROM public.assist_shadow_pending(a,v,20);
  ASSERT public.assist_shadow_store(a,v,fresh)=1;
  ASSERT (SELECT chunk_text FROM public.match_assist_shadow_chunks(a,v,vec,8))='Fictional A revised';
  UPDATE public.assist_corpus_pages SET include=true WHERE id=px;
  ASSERT NOT (SELECT ready FROM public.assist_shadow_readiness(a,v));
  ASSERT NOT EXISTS (SELECT 1 FROM public.match_assist_shadow_chunks(a,v,vec,8));
  UPDATE public.assist_corpus_pages SET include=false WHERE id=px;
  DELETE FROM public.assist_corpus_chunks WHERE id=ca;
  ASSERT NOT EXISTS (SELECT 1 FROM public.assist_shadow_embeddings WHERE chunk_id=ca);
  ASSERT (SELECT unavailable_pages=1 AND NOT ready FROM public.assist_shadow_readiness(a,v));
  INSERT INTO public.assist_corpus_chunks(id,page_id,firm_id,chunk_text,embedding) VALUES (replacement,pa,a,'Fictional A revised',vec);
  ASSERT public.assist_shadow_store(a,v,fresh)=0;
  SELECT jsonb_build_array(jsonb_build_object('chunk_id',chunk_id,'source_hash',source_hash,'embedding',vec::text))
    INTO fresh FROM public.assist_shadow_pending(a,v,20);
  UPDATE public.assist_corpus_pages SET include=false WHERE id=pa;
  ASSERT public.assist_shadow_store(a,v,fresh)=0;
  ASSERT (SELECT included_pages=0 AND NOT ready FROM public.assist_shadow_readiness(a,v));
  UPDATE public.assist_corpus_pages SET include=true WHERE id=pa;
  ASSERT public.assist_shadow_store(a,v,fresh)=1;
  DELETE FROM public.assist_corpus_pages WHERE id=pa;
  ASSERT NOT EXISTS (SELECT 1 FROM public.assist_shadow_embeddings WHERE chunk_id=replacement);
  ASSERT NOT EXISTS (SELECT 1 FROM public.match_assist_shadow_chunks(a,v,vec,8));
  ASSERT (SELECT ready FROM public.assist_shadow_readiness(b,v));
END
$test$;
SET LOCAL ROLE service_role;
SELECT ready FROM public.assist_shadow_readiness('10000000-0000-0000-0000-000000000002','openai/text-embedding-3-small/768/v1');
RESET ROLE;
ROLLBACK;
