import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260903144312_privacy_deletion_registry_saga_hardening.sql'),
  'utf8',
);
const recoveryControl = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260903140551_privacy_external_deletion_registry_recovery_control.sql'),
  'utf8',
);
const operational = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260903183915_privacy_deletion_registry_operational_completeness.sql'),
  'utf8',
);
const openFromLocked = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260904125000_privacy_recovery_open_from_locked.sql'),
  'utf8',
);

describe('privacy deletion registry migration ACL contract', () => {
  it('keeps recovery and coordinator RPCs service-only', () => {
    for (const name of [
      'set_privacy_recovery_state',
      'list_privacy_recovery_candidates',
      'list_pending_screened_lead_privacy_cleanups',
    ]) {
      expect(migration).toContain(`revoke all on function public.${name}`);
      expect(migration).toContain(`from public, anon, authenticated, service_role`);
      expect(migration).toContain(`grant execute on function public.${name}`);
      expect(migration).toContain('to service_role');
    }
  });

  it('does not override provider-evidence completion hardening', () => {
    const providerEvidence = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260903011450_privacy_provider_evidence_required.sql'),
      'utf8',
    );
    // The later registry migration must leave this hardened implementation in
    // force rather than replacing it with a permissive acknowledgement.
    expect(migration).not.toContain('create or replace function private.complete_screened_lead_external_cleanup_impl');
    expect(providerEvidence).toContain('provider_managed is not completion evidence');
    expect(providerEvidence).toContain("not in ('completed', 'not_applicable')");
    expect(providerEvidence).toContain('cleanup_summary status does not satisfy the durable cleanup manifest');
    expect(providerEvidence).toContain("external_cleanup_manifest = '{}'::jsonb");
  });

  it('bounds recovery sources and keeps their public wrappers as invokers', () => {
    expect(migration).toContain("p_limit > 100");
    expect(migration).toContain("recovery replay is not active");
    expect(migration).toContain("security invoker");
  });

  it('preserves the pre-existing transaction-level send/outbox race controls', () => {
    const original = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260902210124_privacy_screened_lead_redaction.sql'),
      'utf8',
    );
    expect(original).toContain('pg_advisory_xact_lock');
    expect(original).toContain('update public.webhook_outbox as outbox');
    expect(original).toContain("consent_block_reason = 'privacy_redacted'");
  });

  it('applies fail-closed and binds recovery evidence to the current DB cycle', () => {
    expect(recoveryControl).toContain("values (true, 'locked'");
    expect(operational).toContain("schema_version = '20260903183915'");
    expect(operational).toContain('v_control.cycle_id is distinct from p_cycle_id');
    expect(operational).toContain('v_control.cycle_started_at is distinct from p_before_or_at');
    expect(operational).toContain("p_operation = 'backfill'");
    expect(operational).toContain('v_control.initial_backfill_started_at is null');
    expect(operational).toContain("'initial registry backfill is not initialized'");
    expect(operational).toContain('cycle_started_at = v_now');
    expect(operational).toContain("p_operation = 'replay' and not p_registry_activated and exists");
    expect(operational).toContain('initial registry backfill is incomplete');
    expect(operational).not.toContain('delete from private.privacy_recovery_firm_completions');
  });

  it('uses stable tenant UUID coordinates and an indexed DB-owned keyset source', () => {
    expect(operational).toContain('references public.intake_firms(id)');
    expect(operational).toContain('privacy_deletion_requests_registry_backfill_keyset_idx');
    expect(operational).toContain('(firm_id, requested_at, id)');
    expect(operational).toContain('redact_screened_lead_subject_by_id_impl');
    expect(operational).toContain('deletion request coordinate mismatch');
    expect(operational).toContain('lead.id = p_screened_lead_id and lead.firm_id = p_firm_id');
    expect(operational).toContain('for update;');
    expect(operational).toContain('list_privacy_deletion_registry_backfill_firms_impl');
    expect(operational).toContain("select distinct request.firm_id");
    expect(operational).toContain("revoke all on function public.list_privacy_deletion_registry_backfill_firms");
  });

  it('permits opening only after a global replay and makes same-cycle retry idempotent', () => {
    expect(openFromLocked).toContain("v_control.required_operation <> 'replay'");
    expect(openFromLocked).toContain("if v_control.state = 'open' then");
    expect(openFromLocked).toContain("v_control.state not in ('locked', 'replaying')");
    expect(openFromLocked).toContain('reconciliation_operation_id is distinct from p_operation_id');
    expect(openFromLocked).toContain('reconciliation_completed_at is null');
    expect(openFromLocked).toContain("schema_version <> '20260903183915'");
    expect(openFromLocked).toContain('revoke all on function public.open_privacy_recovery(uuid, uuid)');
    expect(openFromLocked).toContain('from public, anon, authenticated, service_role');
    expect(openFromLocked).not.toContain('update private.privacy_recovery_control\n   set state = \'locked\'');
  });
});
