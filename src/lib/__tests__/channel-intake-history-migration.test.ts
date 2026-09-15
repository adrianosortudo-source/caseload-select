import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260915114633_channel_intake_exchange_history.sql',
  ),
  'utf8',
);

describe('channel intake exchange history migration', () => {
  it('adds a non-null, versioned and bounded JSONB envelope', () => {
    expect(migration).toMatch(/add column if not exists intake_exchanges jsonb not null/i);
    expect(migration).toMatch(/jsonb_typeof\(intake_exchanges\) = 'object'/i);
    expect(migration).toMatch(/intake_exchanges -> 'version' = '1'::jsonb/i);
    expect(migration).toMatch(/jsonb_array_length\(intake_exchanges -> 'events'\) <= 64/i);
    expect(migration).toMatch(/pg_column_size\(intake_exchanges\) <= 1048576/i);
    expect(migration).toMatch(/\) is true\)/i);
    expect(migration).toMatch(/set intake_exchanges = '\{"version":1,"events":\[\],"truncated":true\}'::jsonb/i);
  });

  it('clears duplicate bodies when a linked session is privacy-redacted', () => {
    expect(migration).toContain('clear_channel_intake_exchanges_on_redaction');
    expect(migration).toContain(`new.engine_state = '{"anonymized":true}'::jsonb`);
    expect(migration).toMatch(/new\.intake_exchanges\s*:=\s*'\{"version":1,"events":\[\],"truncated":false\}'::jsonb/i);
  });

  it('retains the service-role-only access posture', () => {
    expect(migration).toMatch(/revoke all privileges on table public\.channel_intake_sessions from anon, authenticated/i);
    expect(migration).toMatch(/grant select, insert, update, delete on table public\.channel_intake_sessions to service_role/i);
  });
});
