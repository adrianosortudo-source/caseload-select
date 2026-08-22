-- DRG manifest placement accepts only the exact, versioned CSB authority
-- pairs. Retain 4.22 for deterministic replay of prior review packages.
do $migration$
declare
  v_signature regprocedure := 'public.apply_drg_content_deployment(jsonb,text,text,jsonb,text,jsonb)'::regprocedure;
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(v_signature) into v_definition;

  v_old := 'if p_bundle#>>''{authority,releaseId}'' <> ''DRG-LAW-CSB-4.22'' then raise exception ''deployment bundle authority mismatch''; end if;';
  v_new := 'if (p_bundle#>>''{authority,releaseId}'' = ''DRG-LAW-CSB-4.26'' and p_bundle#>>''{authority,sha256}'' = ''817dc22c9480a6a74051b7a36c1b616dc1eff7ef9d43265c15110167d58ece2c'') or (p_bundle#>>''{authority,releaseId}'' = ''DRG-LAW-CSB-4.22'' and p_bundle#>>''{authority,sha256}'' = ''0ea34d352d875e030458e96fdd73b23053f32067477b250ac1895d378bbd6ed3'') then null; else raise exception ''deployment bundle authority mismatch''; end if;';
  if position(v_old in v_definition) = 0 then
    raise exception 'DRG deployment authority guard changed; migration requires review';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  execute v_definition;
end;
$migration$;

notify pgrst, 'reload schema';
