require('./_load-env');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const DEMO_FIRM_ID = '1f5a2391-85d8-45a2-b427-90441e78a93c';
const DEMO_NAME = 'Hartwell Law PC [DEMO]';

(async () => {
  const { count: hartwell } = await supabase
    .from('intake_firms')
    .select('*', { count: 'exact', head: true })
    .eq('name', DEMO_NAME);

  const { data: keeper } = await supabase
    .from('intake_firms')
    .select('id, name, created_at')
    .eq('id', DEMO_FIRM_ID)
    .maybeSingle();

  const { count: sessionsOnKeeper } = await supabase
    .from('intake_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('firm_id', DEMO_FIRM_ID);

  const { count: orphaned } = await supabase
    .from('intake_sessions')
    .select('id, firm_id, intake_firms!inner(id)', { count: 'exact', head: true })
    .is('firm_id', null);

  const { data: sakuraba } = await supabase
    .from('intake_firms')
    .select('id, name')
    .eq('id', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    .maybeSingle();

  const { count: total } = await supabase
    .from('intake_firms')
    .select('*', { count: 'exact', head: true });

  console.log('Final state:');
  console.log(`  Hartwell [DEMO] rows: ${hartwell}`);
  console.log(`  Keeper row: ${keeper ? `${keeper.id} (created ${keeper.created_at})` : 'MISSING'}`);
  console.log(`  intake_sessions on keeper: ${sessionsOnKeeper}`);
  console.log(`  intake_sessions with null firm_id: ${orphaned ?? 0}`);
  console.log(`  Sakuraba: ${sakuraba ? 'intact' : 'MISSING'}`);
  console.log(`  Total intake_firms rows: ${total}`);
})();
