/**
 * Simulates the new provisionDemoFirm logic hammered by 20 concurrent callers.
 * Expected: Hartwell [DEMO] count stays at 1 after the storm.
 */

require('./_load-env');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const DEMO_FIRM_ID = '1f5a2391-85d8-45a2-b427-90441e78a93c';
const DEMO_NAME = 'Hartwell Law PC [DEMO]';

async function simulateProvision() {
  const DEMO_BRANDING = {
    accent_color: '#1B3A6B',
    firm_description: 'test',
    tagline: 'test',
    assistant_name: 'Alex',
    phone_number: '(416) 555-2847',
    phone_tel: 'tel:+14165552847',
    booking_url: 'https://example.com',
    privacy_policy_url: '/privacy',
  };

  const { error: upsertError } = await supabase
    .from('intake_firms')
    .upsert(
      {
        id: DEMO_FIRM_ID,
        name: DEMO_NAME,
        location: 'Toronto, Ontario',
        practice_areas: [],
        geographic_config: {},
        question_sets: {},
        branding: DEMO_BRANDING,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );

  if (upsertError) return { error: upsertError.message };

  const { data: before } = await supabase
    .from('intake_firms')
    .select('branding')
    .eq('id', DEMO_FIRM_ID)
    .single();

  await supabase
    .from('intake_firms')
    .update({ question_sets: {}, branding: DEMO_BRANDING })
    .eq('id', DEMO_FIRM_ID);

  return { firmId: DEMO_FIRM_ID, storedBranding: before?.branding };
}

(async () => {
  const { count: before } = await supabase
    .from('intake_firms')
    .select('*', { count: 'exact', head: true })
    .eq('name', DEMO_NAME);
  console.log(`Before storm: ${before} Hartwell rows`);

  console.log('Firing 20 concurrent provision calls...');
  const results = await Promise.all(Array.from({ length: 20 }, () => simulateProvision()));
  const errors = results.filter(r => r.error);
  const ok = results.filter(r => !r.error);
  console.log(`Results: ${ok.length} ok, ${errors.length} errors`);
  if (errors.length) console.log('Errors:', errors.slice(0, 3));

  const { count: after } = await supabase
    .from('intake_firms')
    .select('*', { count: 'exact', head: true })
    .eq('name', DEMO_NAME);
  console.log(`After storm: ${after} Hartwell rows`);
  console.log(after === 1 ? 'PASS — idempotency holds under concurrency' : 'FAIL — dups reappeared');
})();
