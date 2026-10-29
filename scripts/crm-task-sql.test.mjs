/** Actual PostgreSQL 17 in memory, no network/services/production connection. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
if (!process.env.CRM_AGENT_TEST_PGLITE_MODULE) throw Error('Set CRM_AGENT_TEST_PGLITE_MODULE to an isolated @electric-sql/pglite@0.3.14 module directory.');
const { PGlite } = await import(pathToFileURL(process.env.CRM_AGENT_TEST_PGLITE_MODULE.replace(/\\/g,'/') + '/dist/index.js').href);
const db = new PGlite();
const sql = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.firm_lawyers(id uuid PRIMARY KEY);');
// Simulate permissive provider defaults; the draft must explicitly close them.
await db.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;');
await db.exec(await sql('supabase/migrations/20260625000001_agency_crm.sql'));
const followup = await sql('supabase/migrations/20261013173327_agency_followup_journeys.sql');
await db.exec(followup.slice(followup.indexOf('CREATE TABLE public.agency_followup_template_versions'), followup.indexOf('CREATE TABLE public.agency_followup_steps')));
// Load the actual existing prospect lock helpers/triggers, not the whole provider schema.
const handoff = (await sql('supabase/migrations/20261024171116_agency_followup_serialized_provider_handoff_gate.sql')).replace(/\r\n/g,'\n');
for (const name of ['lock_agency_followup_mapping_catalog','lock_agency_followup_mapping_catalog_before_statement','lock_agency_followup_identity','lock_agency_followup_identity_set','lock_agency_followup_prospect_before_write']) {
 const start=handoff.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
 assert.ok(start>=0); await db.exec(handoff.slice(start,handoff.indexOf('$$;',start)+3));
}
for (const name of ['agency_prospects_00_lock_agency_identity','agency_prospects_00_lock_agency_catalog']) {
 const start=handoff.indexOf(`CREATE TRIGGER ${name}\n`);
 assert.ok(start>=0); await db.exec(handoff.slice(start,handoff.indexOf(';',start)+1));
}
const draftSql=await sql('docs/schema/crm-agent-task-writes.sql');
await db.exec(draftSql);
after(() => db.close());
const origin = 'http://127.0.0.1:55439', sha = 'a'.repeat(40), hash = () => createHash('sha256').update(randomUUID()).digest('hex');
const q = async (statement, params=[]) => (await db.query(statement,params)).rows;
const actor = randomUUID();
await q("INSERT INTO crm_agent_identities(id,project_key,enabled) VALUES($1,'caseload-select',true)",[actor]);
async function task(requests, opts={}) {
  const id=randomUUID(), token=hash(), operations=requests.map(request => ({id:randomUUID(),request}));
  const mode=opts.mode ?? 'synthetic', target=mode==='production'?'https://admin.caseloadselect.ca':origin;
  await q(`INSERT INTO crm_agent_tasks(id,agent_id,mode,origin,workflow_sha,approval_ref,version,enabled,plan,expires_at)
    VALUES($1,$2,$3,$4,$5,'synthetic-local-fixture',$6,$7,$8,clock_timestamp()+interval '50 minutes')`,[id,actor,mode,target,sha,hash().slice(0,32),opts.enabled??true,JSON.stringify(operations)]);
  const ctx={id,token,operations,mode,origin:target};
  if (opts.issue!==false) await issue(ctx);
  return ctx;
}
async function issue(t, previous=null, token=t.token, jti=hash(), changes={}) {
  return (await q('SELECT crm_agent_task_issue($1,$2,$3,$4,$5,$6,$7,$8,$9) result', [t.id,token,previous,changes.sha??sha,changes.run??'12345',changes.attempt??'1',jti,t.origin,t.mode]))[0].result;
}
async function execute(t,index=0,body=t.operations[index].request, changes={}) {
  return (await q('SELECT crm_agent_task_execute($1,$2,$3,$4,$5,$6) result',[changes.id??t.id,changes.token??t.token,t.operations[index].id,JSON.stringify(body),changes.origin??t.origin,changes.mode??t.mode]))[0].result;
}
async function verify(t,token=t.token) { return q('SELECT crm_agent_task_verify($1,$2,$3,$4)',[t.id,token,t.origin,t.mode]); }
const prospect = (id,action,values,expected) => ({resource:'prospect',action,id,...(values?{values}:{}),...(expected?{expected}:{})});
const base = {firm_name:'Synthetic fixture only',contact_name:null,contact_email:null,contact_phone:null,city:null,practice_area:null,source:null,stage:'new',fit_score:null,notes:null};

test('disabled task and identity never issue a session; flags require no schema seed', async () => {
 const t=await task([prospect(randomUUID(),'read')],{enabled:false,issue:false});
 await assert.rejects(issue(t),/crm_task_denied/);
 await q('UPDATE crm_agent_tasks SET enabled=true WHERE id=$1',[t.id]);
 await q('UPDATE crm_agent_identities SET enabled=false WHERE id=$1',[actor]);
 await assert.rejects(issue(t),/crm_task_denied/);
 await q('UPDATE crm_agent_identities SET enabled=true WHERE id=$1',[actor]);
});
test('isolated synthetic CRUD, idempotent execution, ordered operations and exact audit', async () => {
 const id=randomUUID();
 const t=await task([prospect(id,'create',{firm_name:base.firm_name}),prospect(id,'read'),prospect(id,'update',{notes:'Synthetic revised note'},{notes:null}),prospect(id,'delete',undefined,{...base,notes:'Synthetic revised note'})]);
 await assert.rejects(execute(t,1),/operation_order/);
 assert.deepEqual(await execute(t),{ok:true,id});
 assert.deepEqual(await execute(t),{ok:true,id});
 assert.equal((await execute(t,1)).record.firm_name,base.firm_name);
 await execute(t,2); await execute(t,3);
 assert.equal((await q('SELECT * FROM agency_prospects WHERE id=$1',[id])).length,0);
 const audit=await q('SELECT * FROM crm_agent_task_audit WHERE task_id=$1 ORDER BY id',[t.id]);
 assert.equal(audit.length,5); assert.ok(audit.every(a=>a.agent_id===actor));
 assert.ok(!JSON.stringify(audit).includes('Synthetic revised note'));
 assert.ok(!JSON.stringify(audit).includes(t.token));
});
test('foreign task ownership, FK reassignment and cascade deletion are denied',async()=>{
 const p=randomUUID(),d=randomUUID(),r=randomUUID();
 const requests=[prospect(p,'create',{firm_name:base.firm_name}),
  {resource:'deal',action:'create',id:d,values:{prospect_id:p,title:'Synthetic deal'}},
  {resource:'reminder',action:'create',id:r,values:{prospect_id:p,deal_id:d,due_at:'2030-01-01T00:00:00Z',note:'Synthetic reminder'}},
  prospect(p,'delete',undefined,base)];
 const t=await task(requests); await execute(t); await execute(t,1); await execute(t,2);
 await assert.rejects(execute(t,3),/dependency_denied/);
 const other=await task([prospect(p,'read')]); await assert.rejects(execute(other),/ownership_denied/);
 const link=await task([{resource:'deal',action:'create',id:randomUUID(),values:{prospect_id:p,title:'Other task'}}]);
 await assert.rejects(execute(link),/ownership_denied/);
 assert.equal((await q('SELECT * FROM agency_reminders WHERE id=$1',[r])).length,1);
});
test('synthetic deal/reminder CRUD and production updates obey field comparisons and FK immutability',async()=>{
 const p=randomUUID(),d=randomUUID(),r=randomUUID();
 const t=await task([
  prospect(p,'create',{firm_name:base.firm_name}),
  {resource:'deal',action:'create',id:d,values:{prospect_id:p,title:'Synthetic deal'}},
  {resource:'reminder',action:'create',id:r,values:{prospect_id:p,deal_id:d,due_at:'2030-01-01T00:00:00Z',note:'Synthetic reminder'}},
  {resource:'reminder',action:'read',id:r},
  {resource:'reminder',action:'update',id:r,values:{done:true},expected:{done:false}},
  {resource:'reminder',action:'delete',id:r,expected:{prospect_id:p,deal_id:d,due_at:'2030-01-01T00:00:00+00:00',note:'Synthetic reminder',done:true}},
  {resource:'deal',action:'read',id:d},
  {resource:'deal',action:'update',id:d,values:{title:'Revised deal'},expected:{title:'Synthetic deal'}},
  {resource:'deal',action:'delete',id:d,expected:{prospect_id:p,title:'Revised deal',stage:'proposal',monthly_value:null,expected_close:null,notes:null}},
  prospect(p,'delete',undefined,base),
 ]);
 for(let i=0;i<t.operations.length;i++) assert.equal((await execute(t,i)).ok,true);
 assert.equal((await q('SELECT * FROM agency_deals WHERE id=$1',[d])).length,0);
 const p2=randomUUID(),d2=randomUUID(),r2=randomUUID();
 await q('INSERT INTO agency_prospects(id,firm_name) VALUES($1,$2)',[p2,'Synthetic production update fixture']);
 await q('INSERT INTO agency_deals(id,prospect_id,title) VALUES($1,$2,$3)',[d2,p2,'Before']);
 await q("INSERT INTO agency_reminders(id,deal_id,due_at,note) VALUES($1,$2,'2030-01-01','Before')",[r2,d2]);
 const prod=await task([
  {resource:'deal',action:'update',id:d2,values:{title:'After',monthly_value:100},expected:{title:'Before',monthly_value:null}},
  {resource:'reminder',action:'update',id:r2,values:{note:'After',done:true},expected:{note:'Before',done:false}},
 ],{mode:'production'});
 await execute(prod);await execute(prod,1);
 assert.equal((await q('SELECT monthly_value FROM agency_deals WHERE id=$1',[d2]))[0].monthly_value,'100');
 assert.equal((await q('SELECT done FROM agency_reminders WHERE id=$1',[r2]))[0].done,true);
 const bad=await task([{resource:'deal',action:'update',id:d2,values:{prospect_id:p2},expected:{prospect_id:p2}}]);
 await assert.rejects(execute(bad),/field_denied/);
});
test('approved production field updates preserve human data and avoid identity-sync triggers',async()=>{
 const id=randomUUID(); await q('INSERT INTO agency_prospects(id,firm_name,notes) VALUES($1,$2,$3)',[id,'Synthetic production-mode fixture','Before']);
 await db.exec(`CREATE FUNCTION public.test_identity_sync() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'identity_columns_touched'; END $$;
 CREATE TRIGGER test_identity_sync AFTER UPDATE OF firm_name,contact_name,contact_email,contact_phone,city,source,stage ON agency_prospects FOR EACH ROW EXECUTE FUNCTION test_identity_sync();`);
 const t=await task([prospect(id,'update',{notes:'After',fit_score:70},{notes:'Before',fit_score:null})],{mode:'production'});
 assert.deepEqual(await execute(t),{id,ok:true});
 await db.exec('DROP TRIGGER test_identity_sync ON agency_prospects; DROP FUNCTION test_identity_sync();');
 const row=(await q('SELECT * FROM agency_prospects WHERE id=$1',[id]))[0]; assert.equal(row.notes,'After'); assert.equal(row.fit_score,70); assert.equal(row.firm_name,'Synthetic production-mode fixture');
});
test('prospect pre-read lock order matches the real catalog/identity triggers',async()=>{
 const body=(await q("SELECT pg_get_functiondef('crm_agent_task_execute(uuid,text,uuid,jsonb,text,text)'::regprocedure) body"))[0].body;
 const before=body.indexOf('PERFORM public.lock_agency_followup_identity(record_id)');
 const rowLock=body.indexOf('SELECT to_jsonb(a) INTO row_data FROM public.agency_prospects');
 assert.ok(before>=0 && before<rowLock,'catalog/identity helper must precede the prospect tuple lock');
 const id=randomUUID();await q('INSERT INTO agency_prospects(id,firm_name) VALUES($1,$2)',[id,'Synthetic lock-order fixture']);
 const t=await task([prospect(id,'update',{notes:'Revised'},{notes:null})],{mode:'production'});
 await db.transaction(async tx=>{
  const applied=await tx.query('SELECT crm_agent_task_execute($1,$2,$3,$4,$5,$6) result',[t.id,t.token,t.operations[0].id,JSON.stringify(t.operations[0].request),t.origin,t.mode]);
  assert.equal(applied.rows[0].result.ok,true);
  const helper=(await tx.query("SELECT pg_get_functiondef('lock_agency_followup_identity(uuid)'::regprocedure) body")).rows[0].body;
  const catalog=helper.indexOf('PERFORM public.lock_agency_followup_mapping_catalog()');
  const identity=helper.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock(');
  assert.ok(catalog>=0 && identity>=0 && catalog<identity);
  // This embedded engine has a single backend. Its lock rows do not match the
  // pg_backend_pid() predicate used by a normal multi-backend server.
  const locks=await tx.query("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND granted");
  assert.ok(locks.rows[0].n>=2,'catalog and identity advisory locks must be held');
  assert.equal((await tx.query('SELECT notes FROM agency_prospects WHERE id=$1',[id])).rows[0].notes,'Revised');
  // This checks the applied ordering and held locks, not concurrent behavior.
 });
});
test('task cannot expand payload or operation; CAS conflicts and invalid values leave no receipt/audit/write',async()=>{
 const id=randomUUID(); await q('INSERT INTO agency_prospects(id,firm_name,notes) VALUES($1,$2,$3)',[id,'Synthetic CAS','Newer']);
 const t=await task([prospect(id,'update',{notes:'After'},{notes:'Before'})],{mode:'production'});
 await assert.rejects(execute(t,0,prospect(id,'update',{notes:'Different'},{notes:'Before'})),/manifest_mismatch/);
 await assert.rejects(execute(t),/conflict/);
 const bad=await task([prospect(id,'update',{fit_score:200},{fit_score:null})],{mode:'production'});
 await assert.rejects(execute(bad),error=>{assert.equal(error.message,'crm_task_rejected');assert.ok(!error.detail);return true;});
 assert.equal((await q('SELECT notes FROM agency_prospects WHERE id=$1',[id]))[0].notes,'Newer');
 assert.equal((await q('SELECT * FROM crm_agent_task_receipts WHERE task_id=ANY($1::uuid[])',[[t.id,bad.id]])).length,0);
 assert.equal((await q("SELECT * FROM crm_agent_task_audit WHERE task_id=ANY($1::uuid[]) AND event='operation_completed'",[[t.id,bad.id]])).length,0);
});
test('protected actions remain denied even if mistakenly placed in an approved manifest',async()=>{
 for(const req of [
  prospect(randomUUID(),'delete',undefined,base),prospect(randomUUID(),'create',{firm_name:'x'}),prospect(randomUUID(),'read'),
  prospect(randomUUID(),'update',{contact_email:'synthetic@example.invalid'},{contact_email:null}),
  prospect(randomUUID(),'update',{stage:'won'},{stage:'new'}),
  {resource:'template_draft',action:'approve',id:randomUUID()},
  {resource:'send',action:'create',id:randomUUID()}, {resource:'enrollment',action:'create',id:randomUUID()},
  {resource:'provider',action:'update',id:randomUUID()}, {resource:'client_matter',action:'update',id:randomUUID()},
  {resource:'grant',action:'update',id:randomUUID()},
  {resource:'template_draft',action:'create',id:randomUUID(),values:{template_key:'bad-null-version',subject:'subject',body:'body',expected_version:null}},
 ]) { const t=await task([req],{mode:'production'}); await assert.rejects(execute(t),/crm_task_/); }
});
test('an audit failure rolls back the business update and receipt in the same transaction',async()=>{
 const id=randomUUID(); await q('INSERT INTO agency_prospects(id,firm_name,notes) VALUES($1,$2,$3)',[id,'Synthetic rollback fixture','Before']);
 const t=await task([prospect(id,'update',{notes:'After'},{notes:'Before'})],{mode:'production'});
 await db.exec(`CREATE FUNCTION public.test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='operation_completed' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER test_audit_failure BEFORE INSERT ON crm_agent_task_audit FOR EACH ROW EXECUTE FUNCTION test_audit_failure();`);
 await assert.rejects(execute(t),/crm_task_rejected/);
 assert.equal((await q('SELECT notes FROM agency_prospects WHERE id=$1',[id]))[0].notes,'Before');
 assert.equal((await q('SELECT * FROM crm_agent_task_receipts WHERE task_id=$1',[t.id])).length,0);
 await db.exec('DROP TRIGGER test_audit_failure ON crm_agent_task_audit; DROP FUNCTION test_audit_failure();');
 await execute(t); assert.equal((await q('SELECT notes FROM agency_prospects WHERE id=$1',[id]))[0].notes,'After');
});
test('agent authored follow-up stays draft, distinct creator, compatible content hash and human inserts',async()=>{
 const id=randomUUID(),subject='\u00a0 Synthetic\u2000 \t subject \ufeff',body='\u2009 Line one\r\nLine two "quoted" \\ path \u3000';
 const t=await task([{resource:'template_draft',action:'create',id,values:{template_key:'synthetic-local-template',expected_version:0,subject,body}}],{mode:'production'});
 await execute(t);
 const row=(await q('SELECT * FROM agency_followup_template_versions WHERE id=$1',[id]))[0];
 assert.equal(row.state,'draft'); assert.equal(row.created_by_agent_id,actor); assert.equal(row.created_by_operator_id,null); assert.equal(row.approved_by_operator_id,null);
 const canonical=JSON.stringify({body:body.replace(/\r\n/g,'\n').trim(),channel:'email',subject:subject.trim().replace(/\s+/g,' ')});
 assert.equal(row.content_sha256,createHash('sha256').update(canonical).digest('hex'));
 const op=randomUUID(); await q('INSERT INTO firm_lawyers VALUES($1)',[op]);
 await q("INSERT INTO agency_followup_template_versions(template_key,version,subject,body,content_sha256,created_by_operator_id) VALUES('synthetic-human',1,'subject','body',$1,$2)",[hash(),op]);
 const stale=await task([{resource:'template_draft',action:'create',id:randomUUID(),values:{template_key:'synthetic-local-template',expected_version:0,subject:'another',body:'draft'}}]);
 await assert.rejects(execute(stale),/conflict/);
});
test('expiry, task/identity revocation, wrong origin/mode/task and immutable scope',async()=>{
 const t=await task([prospect(randomUUID(),'read')]);
 await assert.rejects(execute(t,0,undefined,{origin:'https://evil.invalid'}),/denied/);
 await assert.rejects(execute(t,0,undefined,{mode:'production'}),/denied/);
 const other=await task([prospect(randomUUID(),'read')]); await assert.rejects(execute(t,0,undefined,{id:other.id}),/denied/);
 await assert.rejects(q('UPDATE crm_agent_tasks SET plan=$1 WHERE id=$2',['[]',t.id]),/immutable|check constraint/);
 await q('UPDATE crm_agent_tasks SET enabled=false WHERE id=$1',[t.id]); await assert.rejects(verify(t),/denied/);
 await q('UPDATE crm_agent_tasks SET enabled=true WHERE id=$1',[t.id]);
 await assert.rejects(verify(t),/denied/); // Re-enabling must not resurrect the prior session.
 await q('UPDATE crm_agent_identities SET enabled=false WHERE id=$1',[actor]); await assert.rejects(verify(t),/denied/);
 await q('UPDATE crm_agent_identities SET enabled=true WHERE id=$1',[actor]);
 const expired=await task([prospect(randomUUID(),'read')]); await verify(expired);
 assert.equal((await q('SELECT revoked FROM crm_agent_task_sessions WHERE token_hash=$1',[expired.token]))[0].revoked,false);
 await q("UPDATE crm_agent_task_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[expired.token]);
 await assert.rejects(verify(expired),/denied/); // Fresh enabled task/identity; only expiry changed.
});
test('identity revoke invalidates all sessions permanently; null trust fields and operation budgets fail closed',async()=>{
 const t=await task([prospect(randomUUID(),'read')]);
 await q('UPDATE crm_agent_identities SET enabled=false WHERE id=$1',[actor]);
 await q('UPDATE crm_agent_identities SET enabled=true WHERE id=$1',[actor]);
 await assert.rejects(verify(t),/denied/);
 const fresh=await task([prospect(randomUUID(),'read')],{issue:false});
 await assert.rejects(q('SELECT crm_agent_task_issue($1,$2,NULL,NULL,$3,$4,$5,$6,$7)',[fresh.id,fresh.token,'123','1',hash(),origin,'synthetic']),/denied/);
 await issue(fresh);
 await assert.rejects(q('SELECT crm_agent_task_verify($1,$2,NULL,$3)',[fresh.id,fresh.token,'synthetic']),/denied/);
 await assert.rejects(q('SELECT crm_agent_task_verify($1,$2,$3,NULL)',[fresh.id,fresh.token,origin]),/denied/);
 await assert.rejects(task(Array.from({length:11},()=>prospect(randomUUID(),'read')),{mode:'production'}),/check constraint/);
 const audit=await q("SELECT event FROM crm_agent_task_audit WHERE task_id=$1 AND event IN('identity_revoked','identity_enabled') ORDER BY id",[t.id]);
 assert.deepEqual(audit.map(x=>x.event),['identity_revoked','identity_enabled']);
});
test('SHA binding, one bootstrap/run, rotation delay, JTI replay, old token invalidation and absolute cap',async()=>{
 const t=await task([prospect(randomUUID(),'read')],{issue:false});
 await assert.rejects(issue(t,null,t.token,hash(),{sha:'b'.repeat(40)}),/denied/);
 const jti=hash(); await issue(t,null,t.token,jti);
 await assert.rejects(issue(t),/already_bound/);
 await assert.rejects(issue(t,t.token,hash()),/rotation_denied/);
 await q("UPDATE crm_agent_task_sessions SET issued_at=clock_timestamp()-interval '11 minutes' WHERE token_hash=$1",[t.token]);
 const next=hash(); await assert.rejects(issue(t,t.token,next,jti),/unique constraint/); await verify(t);
 await assert.rejects(issue(t,t.token,next,hash(),{run:'999'}),/rotation_denied/);
 await q("UPDATE crm_agent_tasks SET job_deadline=clock_timestamp()+interval '30 seconds' WHERE id=$1",[t.id]);
 const result=await issue(t,t.token,next); assert.ok(result.expiresAt<=Date.now()+31000);
 await assert.rejects(verify(t),/denied/); await verify(t,next);
 await q("UPDATE crm_agent_tasks SET job_deadline=clock_timestamp()-interval '1 second' WHERE id=$1",[t.id]); await assert.rejects(verify(t,next),/denied/);
});
test('service role can call fixed RPCs, public/authenticated cannot execute or read control tables',async()=>{
 for(const role of ['anon','authenticated']) {
  await db.exec(`SET ROLE ${role}`);
  await assert.rejects(q('SELECT * FROM crm_agent_tasks'),/permission denied/);
  await assert.rejects(q('SELECT crm_agent_task_verify($1,$2,$3,$4)',[randomUUID(),hash(),origin,'synthetic']),/permission denied/);
  await db.exec('RESET ROLE');
 }
 const serviceTask=await task([prospect(randomUUID(),'create',{firm_name:'Synthetic service role fixture'})]);
 await db.exec('SET ROLE service_role');
 await assert.rejects(q('SELECT * FROM crm_agent_tasks'),/permission denied/);
 await assert.rejects(q("SELECT nextval('crm_agent_task_audit_id_seq')"),/permission denied/);
 await assert.rejects(q('SELECT crm_agent_task_authorize($1,$2,$3,$4)',[randomUUID(),hash(),origin,'synthetic']),/permission denied/);
 await assert.rejects(q('SELECT crm_agent_task_verify($1,$2,$3,$4)',[randomUUID(),hash(),origin,'synthetic']),/crm_task_denied/);
 await verify(serviceTask); assert.equal((await execute(serviceTask)).ok,true);
 await db.exec('RESET ROLE');
});
