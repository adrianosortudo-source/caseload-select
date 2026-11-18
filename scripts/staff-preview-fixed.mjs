import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const env = process.env;
const project = 'prj_nsulX2POrn1tSwTze8KwrvRsIecn';
const branch = 'codex/openai-tools-migration';
const title = 'Capture corrected Best Case staff fixtures 2026-11-18-B';
if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== branch ||
    !env.VERCEL_GIT_COMMIT_MESSAGE?.startsWith(title)) {
  console.info('Staff capture inactive on this build.');
  process.exit(0);
}
let claim = {};
try { claim = JSON.parse(Buffer.from((env.VERCEL_OIDC_TOKEN ?? '').split('.')[1], 'base64url').toString()); } catch {}
const ids = [env.VERCEL_PROJECT_ID, claim.project_id].filter(Boolean);
if (!ids.length || !ids.every(id => id === project) || (claim.environment && claim.environment !== 'preview') ||
    !/^[0-9a-f]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '')) throw new Error('Staff replay project binding unavailable.');
if (!env.CASELOAD_OPENAI_API_KEY?.trim()) throw new Error('Staff preview model access unavailable.');
const work = await mkdtemp(join(tmpdir(),'caseload-staff-fixed-'));
const destination = 'public/staff-best-20261118b';
await mkdir(destination);
const status = [];
const baseEnv = Object.fromEntries(['PATH','HOME','TMPDIR','VERCEL_GIT_COMMIT_SHA','CASELOAD_OPENAI_API_KEY'].filter(k => env[k]).map(k => [k,env[k]]));
Object.assign(baseEnv,{ VERCEL_ENV:'preview', SCREEN_OPENAI_MODEL:'gpt-6-luna', DESIRED_CLIENT_OPENAI_MODEL:'gpt-6-luna' });
async function run(label, args, callLimit, endpoint) {
  const started = new Date().toISOString();
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath,['--import','./scripts/staff-preview-allowlist.mjs',...args],{
      env:{...baseEnv, STAFF_CALL_LIMIT:String(callLimit), STAFF_ENDPOINT:endpoint, STAFF_USAGE_FILE:join(work,label+'-usage.ndjson')},
      stdio:'ignore',timeout:12*60*1000,
    });
    child.on('error',()=>resolve(1));child.on('close',v=>resolve(v??1));
  });
  status.push({label,code,started,finished:new Date().toISOString()});
  console.log('Synthetic replay '+label+' '+(code===0?'completed':'partial'));
}
const react=['--conditions=react-server','--import','tsx'];
async function best(first,last) {
  for(let id=first;id<=last;id++) await run('best-'+id,[...react,'scripts/evaluate-assisted-writing/run.cjs','capture','openai','best',join(work,'best-'+id),String(id),String(id)],6,'responses');
}
await Promise.all([best(1,10),best(11,20),best(21,30)]);
const files={};
async function collect(directory) {
  for(const x of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,x.name);
    if(x.isDirectory()) await collect(path);
    else if(x.isFile() && /\.(?:json|ndjson)$/.test(x.name)) files[relative(work,path)]=await readFile(path,'utf8');
  }
}
await collect(work);
const payload=Buffer.from(JSON.stringify({status,files}));
const packed=gzipSync(payload);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const chunks=[];
for(let offset=0;offset<packed.length;offset+=6000){
  const bytes=packed.subarray(offset,offset+6000);
  const name='part-'+String(chunks.length).padStart(4,'0')+'.txt';
  await writeFile(join(destination,name),bytes.toString('base64'));
  chunks.push({name,bytes:bytes.length,sha256:digest(bytes)});
}
await writeFile(join(destination,'manifest.json'),JSON.stringify({version:1,project,branch,commit:env.VERCEL_GIT_COMMIT_SHA,
  status,files:Object.keys(files).length,sha256:digest(packed),uncompressedSha256:digest(payload),chunks}));
console.log('Fixed staff replay packed '+Object.keys(files).length+' synthetic artifacts.');
