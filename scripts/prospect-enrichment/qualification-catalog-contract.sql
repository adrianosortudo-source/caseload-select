WITH expected(table_name) AS (
  VALUES
    ('prospect_advertising_observations'),
    ('prospect_decision_maker_contacts'),
    ('prospect_diagnostic_ready_profiles'),
    ('prospect_diagnostic_reservations'),
    ('prospect_export_runs'),
    ('prospect_firm_affiliations'),
    ('prospect_firm_fit_observations'),
    ('prospect_lso_licensees'),
    ('prospect_opportunity_observations'),
    ('prospect_qualification_decisions'),
    ('prospect_research_attempts'),
    ('prospect_service_observations'),
    ('prospect_source_captures'),
    ('prospect_source_record_map')
), actual AS (
  SELECT e.table_name, c.oid, pg_get_userbyid(c.relowner) AS owner,
    c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
  FROM expected e
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name AND c.relkind IN ('r', 'p')
)
SELECT jsonb_build_object('tables', (
  SELECT jsonb_agg(jsonb_build_object(
    'name', a.table_name, 'present', a.oid IS NOT NULL, 'owner', a.owner,
    'rlsEnabled', COALESCE(a.rls_enabled, false), 'forceRls', COALESCE(a.force_rls, false),
    'columns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('ordinal', col.attnum, 'name', col.attname,
        'type', format_type(col.atttypid, col.atttypmod), 'nullable', NOT col.attnotnull,
        'default', pg_get_expr(def.adbin, def.adrelid),
        'anonPrivileges', jsonb_build_object(
          'select', COALESCE(has_column_privilege('anon', a.oid, col.attnum, 'SELECT'), false),
          'insert', COALESCE(has_column_privilege('anon', a.oid, col.attnum, 'INSERT'), false),
          'update', COALESCE(has_column_privilege('anon', a.oid, col.attnum, 'UPDATE'), false),
          'references', COALESCE(has_column_privilege('anon', a.oid, col.attnum, 'REFERENCES'), false)),
        'authenticatedPrivileges', jsonb_build_object(
          'select', COALESCE(has_column_privilege('authenticated', a.oid, col.attnum, 'SELECT'), false),
          'insert', COALESCE(has_column_privilege('authenticated', a.oid, col.attnum, 'INSERT'), false),
          'update', COALESCE(has_column_privilege('authenticated', a.oid, col.attnum, 'UPDATE'), false),
          'references', COALESCE(has_column_privilege('authenticated', a.oid, col.attnum, 'REFERENCES'), false)),
        'serviceRolePrivileges', jsonb_build_object(
          'select', COALESCE(has_column_privilege('service_role', a.oid, col.attnum, 'SELECT'), false),
          'insert', COALESCE(has_column_privilege('service_role', a.oid, col.attnum, 'INSERT'), false),
          'update', COALESCE(has_column_privilege('service_role', a.oid, col.attnum, 'UPDATE'), false),
          'references', COALESCE(has_column_privilege('service_role', a.oid, col.attnum, 'REFERENCES'), false))) ORDER BY col.attnum)
      FROM pg_attribute col
      LEFT JOIN pg_attrdef def ON def.adrelid = col.attrelid AND def.adnum = col.attnum
      WHERE col.attrelid = a.oid AND col.attnum > 0 AND NOT col.attisdropped
    ), '[]'::jsonb),
    'constraints', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', con.conname, 'type', con.contype,
        'definition', pg_get_constraintdef(con.oid, true))
        ORDER BY con.conname, con.contype, pg_get_constraintdef(con.oid, true))
      FROM pg_constraint con WHERE con.conrelid = a.oid
    ), '[]'::jsonb),
    'indexes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', ic.relname, 'unique', ix.indisunique, 'primary', ix.indisprimary,
        'definition', pg_get_indexdef(ix.indexrelid))
        ORDER BY ic.relname, ix.indisunique DESC, ix.indisprimary DESC, pg_get_indexdef(ix.indexrelid))
      FROM pg_index ix
      JOIN pg_class ic ON ic.oid = ix.indexrelid
      WHERE ix.indrelid = a.oid
    ), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', pol.policyname, 'command', pol.cmd,
        'roles', pol.roles, 'using', pol.qual, 'check', pol.with_check) ORDER BY pol.policyname)
      FROM pg_policies pol WHERE pol.schemaname = 'public' AND pol.tablename = a.table_name
    ), '[]'::jsonb),
    'triggers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', trg.tgname,
        'definition', pg_get_triggerdef(trg.oid, true)) ORDER BY trg.tgname)
      FROM pg_trigger trg WHERE trg.tgrelid = a.oid AND NOT trg.tgisinternal
    ), '[]'::jsonb),
    'anon', jsonb_build_object(
      'tablePrivileges', jsonb_build_object(
        'select', COALESCE(has_table_privilege('anon', a.oid, 'SELECT'), false),
        'insert', COALESCE(has_table_privilege('anon', a.oid, 'INSERT'), false),
        'update', COALESCE(has_table_privilege('anon', a.oid, 'UPDATE'), false),
        'delete', COALESCE(has_table_privilege('anon', a.oid, 'DELETE'), false),
        'truncate', COALESCE(has_table_privilege('anon', a.oid, 'TRUNCATE'), false),
        'references', COALESCE(has_table_privilege('anon', a.oid, 'REFERENCES'), false),
        'trigger', COALESCE(has_table_privilege('anon', a.oid, 'TRIGGER'), false)),
      'anyColumnPrivileges', jsonb_build_object(
        'select', COALESCE(has_any_column_privilege('anon', a.oid, 'SELECT'), false),
        'insert', COALESCE(has_any_column_privilege('anon', a.oid, 'INSERT'), false),
        'update', COALESCE(has_any_column_privilege('anon', a.oid, 'UPDATE'), false),
        'references', COALESCE(has_any_column_privilege('anon', a.oid, 'REFERENCES'), false))),
    'authenticated', jsonb_build_object(
      'tablePrivileges', jsonb_build_object(
        'select', COALESCE(has_table_privilege('authenticated', a.oid, 'SELECT'), false),
        'insert', COALESCE(has_table_privilege('authenticated', a.oid, 'INSERT'), false),
        'update', COALESCE(has_table_privilege('authenticated', a.oid, 'UPDATE'), false),
        'delete', COALESCE(has_table_privilege('authenticated', a.oid, 'DELETE'), false),
        'truncate', COALESCE(has_table_privilege('authenticated', a.oid, 'TRUNCATE'), false),
        'references', COALESCE(has_table_privilege('authenticated', a.oid, 'REFERENCES'), false),
        'trigger', COALESCE(has_table_privilege('authenticated', a.oid, 'TRIGGER'), false)),
      'anyColumnPrivileges', jsonb_build_object(
        'select', COALESCE(has_any_column_privilege('authenticated', a.oid, 'SELECT'), false),
        'insert', COALESCE(has_any_column_privilege('authenticated', a.oid, 'INSERT'), false),
        'update', COALESCE(has_any_column_privilege('authenticated', a.oid, 'UPDATE'), false),
        'references', COALESCE(has_any_column_privilege('authenticated', a.oid, 'REFERENCES'), false))),
    'serviceRole', jsonb_build_object('tablePrivileges', jsonb_build_object(
      'select', COALESCE(has_table_privilege('service_role', a.oid, 'SELECT'), false),
      'insert', COALESCE(has_table_privilege('service_role', a.oid, 'INSERT'), false),
      'update', COALESCE(has_table_privilege('service_role', a.oid, 'UPDATE'), false),
      'delete', COALESCE(has_table_privilege('service_role', a.oid, 'DELETE'), false),
      'truncate', COALESCE(has_table_privilege('service_role', a.oid, 'TRUNCATE'), false),
      'references', COALESCE(has_table_privilege('service_role', a.oid, 'REFERENCES'), false),
      'trigger', COALESCE(has_table_privilege('service_role', a.oid, 'TRIGGER'), false)),
      'anyColumnPrivileges', jsonb_build_object(
        'select', COALESCE(has_any_column_privilege('service_role', a.oid, 'SELECT'), false),
        'insert', COALESCE(has_any_column_privilege('service_role', a.oid, 'INSERT'), false),
        'update', COALESCE(has_any_column_privilege('service_role', a.oid, 'UPDATE'), false),
        'references', COALESCE(has_any_column_privilege('service_role', a.oid, 'REFERENCES'), false)))
  ) ORDER BY a.table_name) FROM actual a
)) AS catalog_contract;
