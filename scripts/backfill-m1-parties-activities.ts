/**
 * M1 Backfill: seed `parties` and `activities` from existing production data.
 *
 * USAGE (dry-run, default):
 *   npx tsx scripts/backfill-m1-parties-activities.ts
 *
 * USAGE (commit):
 *   DRY_RUN=false npx tsx scripts/backfill-m1-parties-activities.ts
 *
 * IDEMPOTENCY:
 *   - parties:    skips matter if a primary party already exists.
 *   - activities: skips if an activity row already has metadata->>'source_id'
 *                 matching the source event id.
 *
 * SOURCES:
 *   1. parties   <- client_matters.primary_{name,email,phone} per matter
 *   2. activities <- screened_leads.submitted_at  (intake event, via matter)
 *   3. activities <- matter_promotion_events       (take/create/fail/skip)
 *   4. activities <- matter_stage_events           (stage transitions)
 *   5. activities <- matter_messages               (lawyer/client messages)
 *
 * PARITY REPORT: printed at the end regardless of dry-run mode.
 */

import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN      = process.env.DRY_RUN !== 'false';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Counters ──────────────────────────────────────────────────────────────────

const counts = {
  matters_found:           0,
  parties_inserted:        0,
  parties_skipped:         0,
  activities_inserted:     0,
  activities_skipped:      0,
  errors:                  0,
  ambiguous:               0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`[m1-backfill] ${msg}`); }

async function activityExists(matterId: string, sourceId: string): Promise<boolean> {
  const { data } = await supabase
    .from('activities')
    .select('id')
    .eq('matter_id', matterId)
    .eq('metadata->>source_id', sourceId)
    .maybeSingle();
  return Boolean(data);
}

async function insertActivity(row: {
  matter_id:     string;
  firm_id:       string;
  activity_type: string;
  title:         string;
  body:          string | null;
  actor_role:    string;
  occurred_at:   string;
  metadata:      Record<string, unknown>;
}): Promise<'inserted' | 'skipped' | 'error'> {
  const sourceId = String(row.metadata['source_id'] ?? '');
  if (await activityExists(row.matter_id, sourceId)) {
    counts.activities_skipped++;
    return 'skipped';
  }
  if (DRY_RUN) {
    counts.activities_inserted++;
    return 'inserted';
  }
  const { error } = await supabase.from('activities').insert(row);
  if (error) {
    log(`ERROR activity insert matter=${row.matter_id}: ${error.message}`);
    counts.errors++;
    return 'error';
  }
  counts.activities_inserted++;
  return 'inserted';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT (writing to prod)'}`);
  log('');

  // ── Fetch all matters ──────────────────────────────────────────────────────
  const { data: matters, error: mErr } = await supabase
    .from('client_matters')
    .select('id, firm_id, primary_name, primary_email, primary_phone, source_screened_lead_id, created_at')
    .order('created_at', { ascending: true });

  if (mErr) {
    log(`ERROR fetching client_matters: ${mErr.message}`);
    process.exit(1);
  }

  counts.matters_found = (matters ?? []).length;

  if (counts.matters_found === 0) {
    log('No client_matters rows found. Nothing to seed parties or activities from.');
    log('Re-run after the first lead is taken via the triage portal.');
    log('');
    await printParityReport();
    return;
  }

  log(`Found ${counts.matters_found} matter(s). Processing...`);
  log('');

  for (const m of matters ?? []) {
    await processMatter(m);
  }

  log('');
  await printParityReport();
}

async function processMatter(m: {
  id: string;
  firm_id: string;
  primary_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  source_screened_lead_id: string | null;
  created_at: string;
}) {
  // ── Party: primary contact from client_matters ─────────────────────────────
  const hasContact = m.primary_name || m.primary_email || m.primary_phone;

  const { data: existing } = await supabase
    .from('parties')
    .select('id')
    .eq('matter_id', m.id)
    .eq('firm_id', m.firm_id)
    .eq('is_primary', true)
    .maybeSingle();

  if (existing) {
    counts.parties_skipped++;
  } else if (hasContact) {
    if (!DRY_RUN) {
      const { error } = await supabase.from('parties').insert({
        matter_id:  m.id,
        firm_id:    m.firm_id,
        full_name:  m.primary_name ?? null,
        email:      m.primary_email ?? null,
        phone:      m.primary_phone ?? null,
        party_role: 'client',
        is_primary: true,
      });
      if (error) {
        log(`ERROR party insert matter=${m.id}: ${error.message}`);
        counts.errors++;
      } else {
        counts.parties_inserted++;
      }
    } else {
      counts.parties_inserted++;
    }
  } else {
    log(`AMBIGUOUS matter=${m.id}: no primary contact fields; skipping party seed`);
    counts.ambiguous++;
  }

  // ── Activity: intake event from screened_lead ──────────────────────────────
  if (m.source_screened_lead_id) {
    const { data: sl } = await supabase
      .from('screened_leads')
      .select('id, submitted_at, matter_type, band')
      .eq('id', m.source_screened_lead_id)
      .maybeSingle();

    if (sl?.submitted_at) {
      const mtype = sl.matter_type ? ` (${sl.matter_type}, Band ${sl.band})` : '';
      await insertActivity({
        matter_id:     m.id,
        firm_id:       m.firm_id,
        activity_type: 'intake',
        title:         `Intake submitted${mtype}`,
        body:          null,
        actor_role:    'system',
        occurred_at:   String(sl.submitted_at),
        metadata:      {
          source_id:        `sl:${sl.id}:intake`,
          screened_lead_id: sl.id,
          matter_type:      sl.matter_type,
          band:             sl.band,
        },
      });
    }
  }

  // ── Activity: promotion events ─────────────────────────────────────────────
  const { data: promotions } = await supabase
    .from('matter_promotion_events')
    .select('id, event_type, lawyer_id, error_text, created_at')
    .eq('matter_id', m.id)
    .order('created_at', { ascending: true });

  for (const p of promotions ?? []) {
    const eventType = String(p.event_type ?? '');
    const title =
      eventType === 'matter_created'   ? 'Matter created' :
      eventType === 'take_recorded'    ? 'Lead taken' :
      eventType === 'matter_failed'    ? `Matter creation failed${p.error_text ? ': ' + String(p.error_text) : ''}` :
      eventType === 'matter_skipped'   ? 'Matter creation skipped (duplicate)' :
      eventType;
    await insertActivity({
      matter_id:     m.id,
      firm_id:       m.firm_id,
      activity_type: 'promotion',
      title,
      body:          p.error_text ?? null,
      actor_role:    'system',
      occurred_at:   String(p.created_at),
      metadata:      {
        source_id:   `mpe:${p.id}`,
        event_type:  p.event_type,
        lawyer_id:   p.lawyer_id,
      },
    });
  }

  // ── Activity: stage transition events ──────────────────────────────────────
  const { data: stages } = await supabase
    .from('matter_stage_events')
    .select('id, from_stage, to_stage, actor_role, actor_id, note, created_at')
    .eq('matter_id', m.id)
    .order('created_at', { ascending: true });

  for (const e of stages ?? []) {
    const title = e.from_stage
      ? `Stage: ${e.from_stage} to ${e.to_stage}`
      : `Stage set to ${e.to_stage}`;
    await insertActivity({
      matter_id:     m.id,
      firm_id:       m.firm_id,
      activity_type: 'stage_change',
      title,
      body:          e.note ?? null,
      actor_role:    String(e.actor_role ?? 'system'),
      occurred_at:   String(e.created_at),
      metadata:      {
        source_id:   `mse:${e.id}`,
        from_stage:  e.from_stage,
        to_stage:    e.to_stage,
        actor_id:    e.actor_id,
      },
    });
  }

  // ── Activity: messages ─────────────────────────────────────────────────────
  const { data: messages } = await supabase
    .from('matter_messages')
    .select('id, channel_type, recipient_scope, sender_role, body, created_at')
    .eq('matter_id', m.id)
    .order('created_at', { ascending: true });

  for (const msg of messages ?? []) {
    const channel    = String(msg.channel_type ?? 'unknown');
    const scope      = String(msg.recipient_scope ?? '');
    const senderRole = String(msg.sender_role ?? 'system');
    const label      = scope === 'client' ? 'client message' : 'internal note';
    await insertActivity({
      matter_id:     m.id,
      firm_id:       m.firm_id,
      activity_type: 'message',
      title:         `${senderRole} sent ${label} (${channel})`,
      body:          typeof msg.body === 'string' ? msg.body.slice(0, 500) : null,
      actor_role:    senderRole,
      occurred_at:   String(msg.created_at),
      metadata:      {
        source_id:       `mm:${msg.id}`,
        channel_type:    msg.channel_type,
        recipient_scope: msg.recipient_scope,
      },
    });
  }
}

// ── Parity Report ─────────────────────────────────────────────────────────────

async function printParityReport() {
  const { count: partyCount }    = await supabase.from('parties').select('*', { count: 'exact', head: true });
  const { count: activityCount } = await supabase.from('activities').select('*', { count: 'exact', head: true });
  const { count: matterCount }   = await supabase.from('client_matters').select('*', { count: 'exact', head: true });
  const { count: slCount }       = await supabase.from('screened_leads').select('*', { count: 'exact', head: true });

  log('=================================================================');
  log('PARITY REPORT');
  log('=================================================================');
  log(`client_matters (prod):     ${matterCount ?? 0}`);
  log(`screened_leads (prod):     ${slCount ?? 0}`);
  log(`parties (canonical):       ${partyCount ?? 0}`);
  log(`activities (canonical):    ${activityCount ?? 0}`);
  log('');
  log(`Matters processed this run: ${counts.matters_found}`);
  log(`Parties   inserted: ${counts.parties_inserted}  skipped: ${counts.parties_skipped}  errors: ${counts.errors}  ambiguous: ${counts.ambiguous}`);
  log(`Activities inserted: ${counts.activities_inserted}  skipped: ${counts.activities_skipped}`);
  log('');

  if ((matterCount ?? 0) === 0) {
    log('NOTE: No matters exist yet.');
    log('      Parties and activities are seeded at take time once matters exist.');
    log('      Re-run after the first lead is taken via the triage portal.');
  }

  const parityGap = (matterCount ?? 0) > 0 && (partyCount ?? 0) === 0;
  log(`Parity: ${parityGap ? 'WARN (matters exist but no parties)' : 'OK'}`);
  log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes committed)' : 'COMMIT (writes applied)'}`);
  log('=================================================================');
}

// ── Entry ─────────────────────────────────────────────────────────────────────

run().catch((err) => {
  console.error('[m1-backfill] Fatal error:', err);
  process.exit(1);
});
