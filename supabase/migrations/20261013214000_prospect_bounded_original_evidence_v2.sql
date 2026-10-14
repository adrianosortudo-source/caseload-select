-- v2 alone restores ECMAScript formatting of canonical Node-emitted decimal numbers
-- and UTF-16 key order after JSONB storage. Existing v1 canonical identities remain unchanged.
CREATE FUNCTION prospect_candidate_private.utf16_sort_key_v2(p_text text)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $utf16$
DECLARE result bytea:=''::bytea; code integer; i integer;
BEGIN
  FOR i IN 1..char_length(p_text) LOOP
    code:=ascii(substring(p_text FROM i FOR 1));
    IF code>65535 THEN
      result:=result||decode(lpad(to_hex(55296+((code-65536)/1024)),4,'0'),'hex')
        ||decode(lpad(to_hex(56320+((code-65536)%1024)),4,'0'),'hex');
    ELSE result:=result||decode(lpad(to_hex(code),4,'0'),'hex'); END IF;
  END LOOP;
  RETURN result;
END $utf16$;

CREATE FUNCTION prospect_candidate_private.transport_stable_json_v2(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $canonical$
DECLARE item record; result text; number_value numeric; plain text; digits text; exponent integer;
  integer_part text; fraction_part text; negative boolean;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'null' THEN RETURN 'null';
    WHEN 'boolean' THEN RETURN p_value::text;
    WHEN 'string' THEN RETURN p_value::text;
    WHEN 'number' THEN
      -- Do not cast through float8: that can lose the canonical decimal digits or subnormal value.
      number_value:=(p_value::text)::numeric;
      IF number_value=0 THEN RETURN '0'; END IF;
      negative:=number_value<0; number_value:=abs(number_value);
      IF number_value>1.7976931348623157e308::numeric OR number_value<5e-324::numeric THEN RAISE EXCEPTION 'v2_number_outside_canonical_finite_domain'; END IF;
      plain:=number_value::text;
      IF strpos(plain,'.')>0 THEN plain:=rtrim(rtrim(plain,'0'),'.'); END IF;
      IF number_value>=0.000001::numeric AND number_value<1e21::numeric THEN
        RETURN CASE WHEN negative THEN '-' ELSE '' END||plain;
      END IF;
      integer_part:=split_part(plain,'.',1); fraction_part:=split_part(plain,'.',2);
      IF integer_part<>'0' THEN exponent:=char_length(integer_part)-1;
      ELSE exponent:=-(char_length(fraction_part)-char_length(ltrim(fraction_part,'0'))+1); END IF;
      digits:=rtrim(ltrim(integer_part||fraction_part,'0'),'0');
      result:=left(digits,1)||CASE WHEN char_length(digits)>1 THEN '.'||substring(digits FROM 2) ELSE '' END
        ||'e'||CASE WHEN exponent>=0 THEN '+' ELSE '' END||exponent::text;
      RETURN CASE WHEN negative THEN '-' ELSE '' END||result;
    WHEN 'array' THEN
      SELECT '['||coalesce(string_agg(prospect_candidate_private.transport_stable_json_v2(value),',' ORDER BY n),'')||']' INTO result
        FROM jsonb_array_elements(p_value) WITH ORDINALITY x(value,n);
      RETURN result;
    WHEN 'object' THEN
      SELECT '{'||coalesce(string_agg(to_json(key)::text||':'||prospect_candidate_private.transport_stable_json_v2(value),','
        ORDER BY prospect_candidate_private.utf16_sort_key_v2(key)),'')||'}' INTO result FROM jsonb_each(p_value);
      RETURN result;
    ELSE RAISE EXCEPTION 'v2_canonical_json_invalid';
  END CASE;
END $canonical$;

CREATE FUNCTION prospect_candidate_private.transport_hash_v2(p_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $hash$
  SELECT encode(extensions.digest(convert_to(prospect_candidate_private.transport_stable_json_v2(p_value),'UTF8'),'sha256'),'hex')
$hash$;
CREATE FUNCTION prospect_candidate_private.package_stable_json_v1(p_value jsonb,p_schema_version text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $version$
  SELECT CASE WHEN p_schema_version='prospect-enrichment/v2' THEN prospect_candidate_private.transport_stable_json_v2(p_value)
    ELSE public.prospect_enrichment_stable_json_v1(p_value) END
$version$;
REVOKE ALL ON FUNCTION prospect_candidate_private.utf16_sort_key_v2(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION prospect_candidate_private.transport_stable_json_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION prospect_candidate_private.transport_hash_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION prospect_candidate_private.package_stable_json_v1(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

-- Explicit v2 original-evidence transport. No backfill, source rewrite, CRM change or production import.
-- The submitted raw_body/payload/history remain immutable; only logical projection uses reconstruction.
CREATE FUNCTION prospect_candidate_private.decode_original_nodes_v1(p_document jsonb,p_representation_sha256 text,p_original_sha256 text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $decode$
DECLARE
  nodes jsonb; node jsonb; pointer text; tokens text[]; token text; parent_path text[];
  root_value jsonb; parent_value jsonb; child_value jsonb; segment jsonb; joined text;
  ordinal integer:=0; transport_bytes bigint:=0;
BEGIN
  IF jsonb_typeof(p_document) IS DISTINCT FROM 'object' OR coalesce(p_representation_sha256,'') !~ '^[a-f0-9]{64}$'
    OR coalesce(p_original_sha256,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_document) AS keys(k)) IS DISTINCT FROM ARRAY['nodeCount','nodes','schemaVersion']::text[]
    OR p_document->>'schemaVersion' IS DISTINCT FROM 'prospect-original-nodes/v1'
    OR jsonb_typeof(p_document->'nodes') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_document->'nodeCount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
  nodes:=p_document->'nodes';
  IF jsonb_array_length(nodes) NOT BETWEEN 1 AND 10000 OR p_document->>'nodeCount' IS DISTINCT FROM jsonb_array_length(nodes)::text
    THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(nodes) LOOP
    ordinal:=ordinal+1;
    IF jsonb_typeof(node) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(node) AS keys(k)) IS DISTINCT FROM ARRAY['pointer','type','value']::text[]
      OR jsonb_typeof(node->'pointer') IS DISTINCT FROM 'string' OR jsonb_typeof(node->'type') IS DISTINCT FROM 'string'
      THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
    pointer:=node->>'pointer';
    IF octet_length(convert_to(pointer,'UTF8'))>2048 OR (ordinal=1 AND pointer<>'') OR (ordinal>1 AND left(pointer,1)<>'/')
      THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
    tokens:=CASE WHEN pointer='' THEN ARRAY[]::text[] WHEN pointer='/' THEN ARRAY['']::text[] ELSE string_to_array(substring(pointer FROM 2),'/') END;
    IF cardinality(tokens)>32 THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(tokens) t WHERE t~'~([^01]|$)') THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
    SELECT coalesce(array_agg(replace(replace(t,'~1','/'),'~0','~') ORDER BY n),ARRAY[]::text[])
      INTO tokens FROM unnest(tokens) WITH ORDINALITY x(t,n);
    IF EXISTS(SELECT 1 FROM unnest(tokens) t WHERE t IN ('__proto__','constructor','prototype')) THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
    CASE node->>'type'
      WHEN 'object' THEN
        IF node->'value' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
        child_value:='{}'::jsonb;
      WHEN 'array' THEN
        IF node->'value' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
        child_value:='[]'::jsonb;
      WHEN 'null' THEN
        IF node->'value' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
        child_value:='null'::jsonb;
      WHEN 'boolean' THEN
        IF jsonb_typeof(node->'value') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
        child_value:=node->'value';
      WHEN 'number' THEN
        IF jsonb_typeof(node->'value') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
        child_value:=node->'value';
      WHEN 'string' THEN
        IF jsonb_typeof(node->'value') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
        IF octet_length(convert_to(node->>'value','UTF8'))>65536 THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
        child_value:=node->'value';
      WHEN 'string_chunks' THEN
        IF jsonb_typeof(node->'value') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
        IF jsonb_array_length(node->'value') NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
        joined:='';
        FOR segment IN SELECT value FROM jsonb_array_elements(node->'value') LOOP
          IF jsonb_typeof(segment) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
          IF octet_length(convert_to(segment#>>'{}','UTF8')) NOT BETWEEN 1 AND 65536 THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
          joined:=joined||(segment#>>'{}');
          IF octet_length(convert_to(joined,'UTF8'))>2097152 THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
        END LOOP;
        IF octet_length(convert_to(joined,'UTF8'))<=65536 THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
        child_value:=to_jsonb(joined);
      ELSE RAISE EXCEPTION 'original_node_representation_invalid';
    END CASE;
    -- The canonical serializer sees only a validated shallow node, never malformed deep values.
    transport_bytes:=transport_bytes+octet_length(convert_to(prospect_candidate_private.transport_stable_json_v2(node),'UTF8'))+1;
    IF transport_bytes>2097152 THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
    IF ordinal=1 THEN root_value:=child_value;
    ELSE
      parent_path:=CASE WHEN cardinality(tokens)=1 THEN ARRAY[]::text[] ELSE tokens[1:cardinality(tokens)-1] END;
      parent_value:=root_value#>parent_path; token:=tokens[cardinality(tokens)];
      IF jsonb_typeof(parent_value)='object' THEN
        IF parent_value?token THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
      ELSIF jsonb_typeof(parent_value)='array' THEN
        IF token IS DISTINCT FROM jsonb_array_length(parent_value)::text THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
      ELSE RAISE EXCEPTION 'original_node_representation_invalid';
      END IF;
      root_value:=jsonb_set(root_value,tokens,child_value,true);
    END IF;
  END LOOP;
  IF octet_length(convert_to(prospect_candidate_private.transport_stable_json_v2(p_document),'UTF8'))>2097152
    OR octet_length(convert_to(prospect_candidate_private.transport_stable_json_v2(root_value),'UTF8'))>2097152
    THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
  IF prospect_candidate_private.transport_hash_v2(p_document) IS DISTINCT FROM p_representation_sha256
    OR prospect_candidate_private.transport_hash_v2(root_value) IS DISTINCT FROM p_original_sha256
    THEN RAISE EXCEPTION 'original_node_hash_mismatch'; END IF;
  RETURN root_value;
END $decode$;

CREATE FUNCTION prospect_candidate_private.logical_enrichment_payload_v1(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $logical$
DECLARE logical_payload jsonb;
BEGIN
  IF p_payload->>'schemaVersion'='prospect-enrichment/v1' THEN RETURN p_payload; END IF;
  IF p_payload->>'schemaVersion' IS DISTINCT FROM 'prospect-enrichment/v2' THEN RAISE EXCEPTION 'original_research_version_unsupported'; END IF;
  IF jsonb_typeof(p_payload->'originalResearch') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'original_node_representation_invalid'; END IF;
  logical_payload:=jsonb_set(p_payload,ARRAY['originalResearch','content'],
    prospect_candidate_private.decode_original_nodes_v1(p_payload#>'{originalResearch,content}',
      p_payload#>>'{originalResearch,representationSha256}',p_payload#>>'{originalResearch,contentSha256}'),false);
  IF NOT prospect_candidate_private.index_depth_supported(logical_payload) THEN RAISE EXCEPTION 'original_research_logical_depth_unsupported'; END IF;
  IF logical_payload#>'{originalResearch,content}'='null'::jsonb AND p_payload->'observations'='[]'::jsonb AND p_payload->'assessment'='null'::jsonb THEN RAISE EXCEPTION 'empty_original_research_package'; END IF;
  RETURN logical_payload;
END $logical$;
REVOKE ALL ON FUNCTION prospect_candidate_private.decode_original_nodes_v1(jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION prospect_candidate_private.logical_enrichment_payload_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.prospect_enrichment_packages DROP CONSTRAINT prospect_enrichment_packages_schema_version_check;
ALTER TABLE public.prospect_enrichment_packages ADD CONSTRAINT prospect_enrichment_packages_schema_version_check
  CHECK(schema_version IN ('prospect-enrichment/v1','prospect-enrichment/v2'));

-- Guarded edits of the effective definitions preserve existing authorization, ACLs, owner and all SET options.
DO $patch$
DECLARE definition text; updated text; anchor text;
BEGIN
  SELECT pg_get_functiondef('public.stage_prospect_enrichment_package_v1(text,text,text,text,text,text,text,text,jsonb,text,text,text,jsonb,jsonb,text)'::regprocedure) INTO definition;
  anchor:=$anchor$p_payload->>'schemaVersion' IS DISTINCT FROM 'prospect-enrichment/v1'$anchor$;
  IF (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'bounded_stage_version_anchor_changed'; END IF;
  updated:=replace(definition,anchor,$replacement$coalesce(p_payload->>'schemaVersion','') NOT IN ('prospect-enrichment/v1','prospect-enrichment/v2')$replacement$);
  anchor:='  computed_raw_sha256 := encode(';
  IF (length(updated)-length(replace(updated,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'bounded_stage_validation_anchor_changed'; END IF;
  updated:=replace(updated,anchor,E'  PERFORM prospect_candidate_private.logical_enrichment_payload_v1(p_payload);\n'||anchor);
  anchor:=$call0$public.prospect_enrichment_stable_json_v1(p_payload)$call0$;
  IF (length(updated)-length(replace(updated,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'bounded_stage_canonical_anchor_0_changed'; END IF;
  updated:=replace(updated,anchor,$replacement0$prospect_candidate_private.package_stable_json_v1(p_payload,p_payload->>'schemaVersion')$replacement0$);
  anchor:=$call1$public.prospect_enrichment_stable_json_v1(jsonb_build_array(p_research_key,source_input->>'clientItemId'))$call1$;
  IF (length(updated)-length(replace(updated,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'bounded_stage_canonical_anchor_1_changed'; END IF;
  updated:=replace(updated,anchor,$replacement1$prospect_candidate_private.package_stable_json_v1(jsonb_build_array(p_research_key,source_input->>'clientItemId'),p_payload->>'schemaVersion')$replacement1$);
  anchor:=$call2$public.prospect_enrichment_stable_json_v1(
      jsonb_build_object('itemKind','source','researchKey',p_research_key,'semanticContent',semantic_content,'sourceSystem',p_source_system)
    )$call2$;
  IF (length(updated)-length(replace(updated,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'bounded_stage_canonical_anchor_2_changed'; END IF;
  updated:=replace(updated,anchor,$replacement2$prospect_candidate_private.package_stable_json_v1(
      jsonb_build_object('itemKind','source','researchKey',p_research_key,'semanticContent',semantic_content,'sourceSystem',p_source_system)
    ,p_payload->>'schemaVersion')$replacement2$);
  anchor:=$call3$public.prospect_enrichment_stable_json_v1(jsonb_build_array(p_research_key,item_input->>'clientItemId'))$call3$;
  IF (length(updated)-length(replace(updated,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'bounded_stage_canonical_anchor_3_changed'; END IF;
  updated:=replace(updated,anchor,$replacement3$prospect_candidate_private.package_stable_json_v1(jsonb_build_array(p_research_key,item_input->>'clientItemId'),p_payload->>'schemaVersion')$replacement3$);
  anchor:=$call4$public.prospect_enrichment_stable_json_v1(
      jsonb_build_object('itemKind',item_input->>'itemKind','researchKey',p_research_key,'semanticContent',semantic_content,'sourceSystem',p_source_system)
    )$call4$;
  IF (length(updated)-length(replace(updated,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'bounded_stage_canonical_anchor_4_changed'; END IF;
  updated:=replace(updated,anchor,$replacement4$prospect_candidate_private.package_stable_json_v1(
      jsonb_build_object('itemKind',item_input->>'itemKind','researchKey',p_research_key,'semanticContent',semantic_content,'sourceSystem',p_source_system)
    ,p_payload->>'schemaVersion')$replacement4$);
  EXECUTE updated;

  SELECT pg_get_functiondef('prospect_candidate_private.record_history(uuid,bigint,text,text,text,uuid,text,uuid,jsonb,text,jsonb,jsonb,uuid)'::regprocedure) INTO definition;
  anchor:='DECLARE row_id uuid; recorded timestamptz;';
  IF (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'bounded_history_declaration_anchor_changed'; END IF;
  updated:=replace(definition,anchor,anchor||' logical_json jsonb; status_key text;');
  anchor:='  SELECT recorded_at INTO recorded FROM public.prospect_research_candidate_coverage WHERE revision=p_coverage;';
  IF (length(updated)-length(replace(updated,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'bounded_history_metadata_anchor_changed'; END IF;
  updated:=replace(updated,anchor,$metadata$  logical_json:=p_json;
  -- Preserve historical stored JSON; decode only explicitly declared v2 transport.
  IF p_table='prospect_enrichment_packages' AND p_json->>'schemaVersion'='prospect-enrichment/v2' THEN
    logical_json:=prospect_candidate_private.logical_enrichment_payload_v1(p_json);
    IF p_json->>'schemaVersion'='prospect-enrichment/v2' THEN
      p_meta:=p_meta||jsonb_build_object(
        'originalStatus',coalesce(logical_json#>>'{originalResearch,content,originalStatus}',logical_json#>>'{originalResearch,content,status}',
          logical_json#>>'{originalResearch,content,databaseDecision}',logical_json#>>'{originalResearch,content,disposition}',p_meta->>'originalStatus'),
        'qualificationState',coalesce(logical_json#>>'{originalResearch,content,qualificationState}',p_meta->>'qualificationState'));
      FOREACH status_key IN ARRAY ARRAY['originalStatus','qualificationState'] LOOP
        IF jsonb_typeof(p_meta->status_key)='string' AND btrim(p_meta->>status_key)='' THEN
          p_meta:=jsonb_set(p_meta,ARRAY[status_key],'null'); p_warnings:=p_warnings||'["blank_status_retained"]'::jsonb;
        END IF;
      END LOOP;
    END IF;
  END IF;
$metadata$||anchor);
  anchor:=$anchor$prospect_candidate_private.walk_fields(p_json,''$anchor$;
  IF (length(updated)-length(replace(updated,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'bounded_history_fields_anchor_changed'; END IF;
  updated:=replace(updated,anchor,$replacement$prospect_candidate_private.walk_fields(logical_json,''$replacement$);
  anchor:=$history_hash$p_hash,p_json,prospect_candidate_private.hash_json(p_json),$history_hash$;
  IF (length(updated)-length(replace(updated,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'bounded_history_hash_anchor_changed'; END IF;
  updated:=replace(updated,anchor,$history_replacement$p_hash,p_json,CASE WHEN p_table='prospect_enrichment_packages' AND p_json->>'schemaVersion'='prospect-enrichment/v2' THEN prospect_candidate_private.transport_hash_v2(p_json) ELSE prospect_candidate_private.hash_json(p_json) END,$history_replacement$);
  EXECUTE updated;
END $patch$;
