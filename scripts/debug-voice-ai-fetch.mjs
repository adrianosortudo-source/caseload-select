// One-shot diagnostic: hit the GHL Voice AI Public API for a known call_id
// using the PIT token, print just the status + response shape. Token comes
// from env (VOICE_API_TOKEN) so it's never echoed in source.
//
// Usage:
//   VOICE_API_TOKEN=pit-... node scripts/debug-voice-ai-fetch.mjs <callId>
//
// Output shape:
//   status=200
//   keys=[id, contactId, transcript, ...]
//   sample={...first 300 chars of transcript...}

const callId = process.argv[2];
const token = process.env.VOICE_API_TOKEN;

if (!callId) {
  console.error('usage: node scripts/debug-voice-ai-fetch.mjs <callId>');
  process.exit(2);
}
if (!token) {
  console.error('env VOICE_API_TOKEN missing');
  process.exit(2);
}

const url = `https://services.leadconnectorhq.com/voice-ai/dashboard/call-logs/${encodeURIComponent(callId)}`;

const res = await fetch(url, {
  method: 'GET',
  headers: {
    Authorization: `Bearer ${token}`,
    Version: '2021-04-15',
    Accept: 'application/json',
  },
});

console.log(`status=${res.status}`);
console.log(`content-type=${res.headers.get('content-type')}`);

const text = await res.text();
if (res.status !== 200) {
  console.log(`body (truncated)=${text.slice(0, 800)}`);
  process.exit(res.status >= 400 ? 1 : 0);
}

let body;
try { body = JSON.parse(text); } catch { body = null; }
if (!body || typeof body !== 'object') {
  console.log(`body not JSON. raw (first 400)=${text.slice(0, 400)}`);
  process.exit(0);
}

function describe(obj, depth = 0, prefix = '') {
  if (depth > 2) return;
  const keys = Object.keys(obj);
  for (const k of keys) {
    const v = obj[k];
    const t = Array.isArray(v) ? `array[${v.length}]` : typeof v;
    const sample = typeof v === 'string' ? ` "${v.slice(0, 120).replace(/\n/g, ' ')}"` : '';
    console.log(`${' '.repeat(depth * 2)}${prefix}${k}: ${t}${sample}`);
    if (v && typeof v === 'object' && !Array.isArray(v)) describe(v, depth + 1);
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      console.log(`${' '.repeat((depth + 1) * 2)}[0]:`);
      describe(v[0], depth + 2);
    }
  }
}

console.log('--- response shape ---');
describe(body);
