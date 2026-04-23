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

async function main() {
  console.log('='.repeat(70));
  console.log('Hartwell demo firm inspection');
  console.log('='.repeat(70));

  const { data: firms, error: firmsErr } = await supabase
    .from('intake_firms')
    .select('id, name, created_at')
    .eq('name', DEMO_NAME)
    .order('created_at', { ascending: true });

  if (firmsErr) {
    console.error('Error fetching firms:', firmsErr);
    process.exit(1);
  }

  console.log(`\nTotal rows named "${DEMO_NAME}": ${firms.length}`);
  if (firms.length === 0) return;

  const oldest = firms[0];
  const duplicates = firms.slice(1);
  console.log(`Oldest (keeper): ${oldest.id}  created_at=${oldest.created_at}`);
  console.log(`Duplicates to remove: ${duplicates.length}`);
  console.log(`\nFirst 3 duplicate ids: ${duplicates.slice(0, 3).map(f => f.id).join(', ')}`);
  console.log(`Last 3 duplicate ids: ${duplicates.slice(-3).map(f => f.id).join(', ')}`);

  const allIds = firms.map(f => f.id);
  const dupIds = duplicates.map(f => f.id);

  // FK dependency check — count rows in each referencing table that point to any duplicate firm
  console.log('\n--- FK dependency counts on DUPLICATE firm ids ---');

  const tables = [
    { table: 'intake_sessions', col: 'firm_id' },
    { table: 'matter_routing', col: 'firm_id' },
    { table: 'retainer_agreements', col: 'firm_id' },
    { table: 'sub_type_conflicts', col: 'firm_id' },
  ];

  for (const { table, col } of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in(col, dupIds);
    if (error) {
      console.log(`  ${table}.${col}: ERROR ${error.message} (code ${error.code})`);
    } else {
      console.log(`  ${table}.${col}: ${count ?? 0} rows referencing duplicates`);
    }
  }

  console.log('\n--- FK dependency counts on KEEPER firm id ---');
  for (const { table, col } of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(col, oldest.id);
    if (error) {
      console.log(`  ${table}.${col}: ERROR ${error.message}`);
    } else {
      console.log(`  ${table}.${col}: ${count ?? 0} rows`);
    }
  }

  // Safety: confirm Sakuraba Law id is untouched
  console.log('\n--- Sakuraba sanity check ---');
  const { data: sak } = await supabase
    .from('intake_firms')
    .select('id, name')
    .ilike('name', '%Sakuraba%');
  console.log(`Sakuraba rows: ${(sak ?? []).length}`);
  (sak ?? []).forEach(r => console.log(`  ${r.id}  ${r.name}`));

  // Total intake_firms row count, for sanity
  const { count: totalCount } = await supabase
    .from('intake_firms')
    .select('*', { count: 'exact', head: true });
  console.log(`\nTotal intake_firms rows in DB: ${totalCount}`);
  console.log(`Of which duplicates to be removed: ${dupIds.length} (${((dupIds.length / (totalCount ?? 1)) * 100).toFixed(1)}%)`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
