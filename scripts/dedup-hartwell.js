/**
 * Dedup Hartwell [DEMO] firm rows.
 *
 * Keeps the oldest row by created_at, reparents all intake_sessions pointing
 * at duplicate firm ids onto the keeper, then deletes the duplicates.
 *
 * Usage:
 *   node scripts/dedup-hartwell.js            # dry run, no writes
 *   node scripts/dedup-hartwell.js --sample   # write-mode, only 3 duplicate rows (verification)
 *   node scripts/dedup-hartwell.js --live     # write-mode, full run
 *
 * Safety rails:
 *   - Keeper must be the oldest row named "Hartwell Law PC [DEMO]"
 *   - Sakuraba Law (id a1b2c3d4-...) is never touched
 *   - matter_routing / retainer_agreements / sub_type_conflicts dependents
 *     would cause the script to abort — those tables should be empty on dupes
 */

require('./_load-env');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEMO_NAME = 'Hartwell Law PC [DEMO]';
const EXPECTED_KEEPER_ID = '1f5a2391-85d8-45a2-b427-90441e78a93c';
const SAKURABA_PREFIX = 'a1b2c3d4'; // must never be affected

const MODE =
  process.argv.includes('--live') ? 'live'
  : process.argv.includes('--sample') ? 'sample'
  : 'dry-run';

const BATCH_SIZE = 100;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log(`Mode: ${MODE}`);
  console.log('='.repeat(70));

  // Step 1: fetch all Hartwell rows ordered oldest-first
  const { data: firms, error: firmsErr } = await supabase
    .from('intake_firms')
    .select('id, name, created_at')
    .eq('name', DEMO_NAME)
    .order('created_at', { ascending: true });
  if (firmsErr) throw firmsErr;

  if (firms.length === 0) {
    console.log('No Hartwell rows found. Nothing to do.');
    return;
  }

  const keeper = firms[0];
  let duplicates = firms.slice(1);

  if (keeper.id !== EXPECTED_KEEPER_ID) {
    console.error(`ABORT: expected keeper id ${EXPECTED_KEEPER_ID}, got ${keeper.id}`);
    console.error('The keeper shifted. Verify manually before proceeding.');
    process.exit(1);
  }

  console.log(`Keeper: ${keeper.id}  (created ${keeper.created_at})`);
  console.log(`Duplicates: ${duplicates.length}`);

  if (MODE === 'sample') {
    duplicates = duplicates.slice(0, 3);
    console.log(`SAMPLE MODE — operating on ${duplicates.length} rows only: ${duplicates.map(f => f.id).join(', ')}`);
  }

  // Safety: none of our targets is the keeper or a Sakuraba prefix row
  for (const dup of duplicates) {
    if (dup.id === keeper.id) {
      console.error(`ABORT: duplicate list contains keeper id`);
      process.exit(1);
    }
    if (dup.id.startsWith(SAKURABA_PREFIX)) {
      console.error(`ABORT: duplicate id ${dup.id} starts with Sakuraba prefix`);
      process.exit(1);
    }
  }

  const dupIds = duplicates.map(d => d.id);

  // Step 2: preflight — check non-cascading FK tables are empty on duplicates
  const strictTables = [
    { table: 'matter_routing', col: 'firm_id' },
    { table: 'retainer_agreements', col: 'firm_id' },
  ];
  for (const { table, col } of strictTables) {
    const { count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in(col, dupIds);
    if ((count ?? 0) > 0) {
      console.error(`ABORT: ${table} has ${count} rows referencing duplicates. Handle manually.`);
      process.exit(1);
    }
  }

  // Count intake_sessions that need reparenting
  const { count: sessionsCount } = await supabase
    .from('intake_sessions')
    .select('*', { count: 'exact', head: true })
    .in('firm_id', dupIds);
  console.log(`intake_sessions to reparent: ${sessionsCount ?? 0}`);

  // Count sub_type_conflicts (will be SET NULL, no action needed)
  const { count: subTypeCount } = await supabase
    .from('sub_type_conflicts')
    .select('*', { count: 'exact', head: true })
    .in('firm_id', dupIds);
  console.log(`sub_type_conflicts pointing at dupes (will SET NULL on delete): ${subTypeCount ?? 0}`);

  if (MODE === 'dry-run') {
    console.log('\nDry run. No changes made. Re-run with --sample or --live to write.');
    return;
  }

  // Step 3: reparent intake_sessions in batches
  console.log('\n[write] Reparenting intake_sessions to keeper...');
  let totalReparented = 0;
  for (const batch of chunk(dupIds, BATCH_SIZE)) {
    const { error, count } = await supabase
      .from('intake_sessions')
      .update({ firm_id: keeper.id }, { count: 'exact' })
      .in('firm_id', batch);
    if (error) {
      console.error('Reparent error:', error);
      process.exit(1);
    }
    totalReparented += count ?? 0;
    process.stdout.write(`  reparented ${totalReparented} / ${sessionsCount ?? 0}\r`);
  }
  console.log(`\n  done. reparented ${totalReparented} intake_sessions.`);

  // Step 4: verify no stray sessions
  const { count: leftover } = await supabase
    .from('intake_sessions')
    .select('*', { count: 'exact', head: true })
    .in('firm_id', dupIds);
  if ((leftover ?? 0) > 0) {
    console.error(`ABORT before delete: ${leftover} intake_sessions still reference duplicates`);
    process.exit(1);
  }

  // Step 5: delete duplicate intake_firms rows in batches
  console.log('\n[write] Deleting duplicate intake_firms rows...');
  let totalDeleted = 0;
  for (const batch of chunk(dupIds, BATCH_SIZE)) {
    const { error, count } = await supabase
      .from('intake_firms')
      .delete({ count: 'exact' })
      .in('id', batch);
    if (error) {
      console.error('Delete error:', error);
      process.exit(1);
    }
    totalDeleted += count ?? 0;
    process.stdout.write(`  deleted ${totalDeleted} / ${dupIds.length}\r`);
  }
  console.log(`\n  done. deleted ${totalDeleted} duplicate firm rows.`);

  // Step 6: final verification
  const { count: remainingCount } = await supabase
    .from('intake_firms')
    .select('*', { count: 'exact', head: true })
    .eq('name', DEMO_NAME);
  console.log(`\nFinal Hartwell row count: ${remainingCount}`);
  if (MODE === 'live' && remainingCount !== 1) {
    console.log(`WARNING: expected 1 Hartwell row after --live, got ${remainingCount}`);
  }

  const { data: sak } = await supabase
    .from('intake_firms')
    .select('id, name')
    .eq('id', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    .maybeSingle();
  console.log(`Sakuraba Law: ${sak ? 'intact' : 'MISSING — investigate'}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
