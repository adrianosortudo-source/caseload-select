import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260903144312_privacy_deletion_registry_saga_hardening.sql'),
  'utf8',
);

describe('privacy deletion registry migration ACL contract', () => {
  it('keeps recovery and coordinator RPCs service-only', () => {
    for (const name of [
      'set_privacy_recovery_state',
      'list_privacy_recovery_candidates',
      'list_pending_screened_lead_privacy_cleanups',
      'complete_screened_lead_external_cleanup',
    ]) {
      expect(migration).toContain(`revoke all on function public.${name}`);
      expect(migration).toContain(`from public, anon, authenticated, service_role`);
      expect(migration).toContain(`grant execute on function public.${name}`);
      expect(migration).toContain('to service_role');
    }
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
});
