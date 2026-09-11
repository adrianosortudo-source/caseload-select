import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260909231858_prospect_operations_core.sql'),
  'utf8',
);
const rowShapeFix = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260910042530_fix_prospect_history_trigger_row_shape.sql'),
  'utf8',
);

describe('prospect operations migration contract', () => {
  it('makes identity resolution explicit, append-only, and source-preserving', () => {
    expect(migration).toContain('CREATE TABLE public.prospect_identity_adjudications');
    expect(migration).toContain("decision IN ('confirmed_link', 'rejected')");
    expect(migration).toContain('identity adjudication history is append-only');
    expect(migration).toContain('a source link with contact history cannot change canonical identity');
    expect(migration).toContain('Shared names, email addresses, domains, and locations cannot merge identities.');
  });

  it('provides only an audited fresh-identity provisioning path and service API grants', () => {
    expect(migration).toContain('CREATE TABLE public.prospect_source_provisioning_events');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.provision_prospect_source_record');
    expect(migration).toContain('contains no name/email/domain/address');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.provision_prospect_source_record');
    expect(migration).toContain('TO service_role;');
  });

  it('keeps suppression provenance once it takes effect', () => {
    expect(migration).toContain('suppressed_by_operator_id uuid');
    expect(migration).toContain('active suppression provenance is immutable');
    expect(migration).toContain('lifting suppression must preserve its provenance');
  });

  it('dispatches the shared history trigger before accessing table-specific row fields', () => {
    expect(rowShapeFix).toContain("CASE TG_TABLE_NAME");
    expect(rowShapeFix).toContain("WHEN 'prospect_conversations' THEN");
    expect(rowShapeFix).toContain("WHEN 'prospect_source_links' THEN");

    const conversationBranch = rowShapeFix.slice(
      rowShapeFix.indexOf("WHEN 'prospect_conversations' THEN"),
      rowShapeFix.indexOf("WHEN 'prospect_source_links' THEN"),
    );
    expect(conversationBranch).not.toContain('OLD.source_system');
    expect(conversationBranch).not.toContain('NEW.source_system');
    expect(conversationBranch).not.toContain('OLD.source_record_key');
    expect(conversationBranch).not.toContain('NEW.source_record_key');
    expect(rowShapeFix).toContain(
      'REVOKE ALL ON FUNCTION public.prevent_prospect_history_reassignment()',
    );
  });
});
