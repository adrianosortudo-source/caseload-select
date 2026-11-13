import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CRM_TASK_COOKIE, CRM_SYNTHETIC_COOKIE, CRM_TASK_ORIGIN, CRM_TASK_EXCHANGE, crmTaskConfig, crmTaskRoute, crmTaskRawCookie } from "../crm-task-policy";
const fixture=vi.hoisted(()=>({cookies:new Map<string,string>(),oidc:vi.fn(),rpc:vi.fn(),writes:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({get:(name:string)=>fixture.cookies.has(name)?{value:fixture.cookies.get(name)}:undefined}),headers:async()=>new Headers({host:'admin.caseloadselect.ca'})}));
vi.mock('../crm-task-github-oidc',()=>({verifyCrmTaskWorkflowToken:(...args:unknown[])=>fixture.oidc(...args)}));
vi.mock('../agency-crm',()=>({updateProspect:fixture.writes,isProspectStage:()=>true,isUuid:()=>true}));
import * as exchange from '@/app/api/operator/crm-task-session/route';
import * as plan from '@/app/api/agent/crm/tasks/[taskId]/route';
import * as operation from '@/app/api/agent/crm/tasks/[taskId]/operations/[operationId]/route';
import * as legacy from '@/app/api/admin/agency-crm/prospects/[id]/route';
import { getCrmTaskSession } from '../crm-task-store';
import { getOperatorSession, getPortalSession } from '../portal-auth';
import { middleware } from '@/middleware';
const id='11111111-1111-4111-8111-111111111111', op='22222222-2222-4222-8222-222222222222', raw='c'.repeat(64);
const base=`/api/agent/crm/tasks/${id}`;
function req(path=base,method='GET',body?:unknown,cookie=`${CRM_TASK_COOKIE}=${raw}`) {
 return new NextRequest(CRM_TASK_ORIGIN+path,{method,headers:{host:'admin.caseloadselect.ca',Origin:CRM_TASK_ORIGIN,'Content-Type':'application/json',cookie},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
beforeEach(()=>{
 vi.clearAllMocks(); fixture.cookies.clear(); fixture.cookies.set(CRM_TASK_COOKIE,raw);
 vi.stubEnv('CRM_AGENT_TASK_WRITES_ENABLED','true'); vi.stubEnv('CRM_AGENT_SYNTHETIC_WRITE_ENABLED','false'); vi.stubEnv('VERCEL_ENV','production');
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://ssxryjxifwiivghglqer.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','synthetic-server-fixture-only'); vi.stubEnv('PRIVACY_DELETION_REGISTRY_ENABLED','false');
 fixture.oidc.mockResolvedValue({sha:'a'.repeat(40),runId:'123',runAttempt:'1',jtiSha256:'b'.repeat(64)});
 fixture.rpc.mockImplementation((url:string)=>({expiresAt:Date.now()+900000,...(url.endsWith('_execute')?{ok:true,id}:{})}));
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>new Response(JSON.stringify(await fixture.rpc(url,JSON.parse(String(init.body)))),{status:200})));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});

describe('disabled and isolated environment policy',()=>{
 const valid={NODE_ENV:'production',VERCEL_ENV:'production',CRM_AGENT_TASK_WRITES_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://ssxryjxifwiivghglqer.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic'};
 it.each([{CRM_AGENT_TASK_WRITES_ENABLED:''},{CRM_AGENT_TASK_WRITES_ENABLED:'TRUE'},{VERCEL_ENV:'preview'},{VERCEL_ENV:''},{NEXT_PUBLIC_SUPABASE_URL:'http://ssxryjxifwiivghglqer.supabase.co'},{NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'},{NEXT_PUBLIC_SUPABASE_URL:'https://ssxryjxifwiivghglqer.supabase.co/path'},{SUPABASE_SERVICE_ROLE_KEY:''}])('fails closed for %j',changed=>{
  expect(crmTaskConfig(CRM_TASK_ORIGIN,{...valid,...changed})).toBeNull();
 });
 it('pins production project and origin; synthetic needs both local DB and local origin',()=>{
  expect(crmTaskConfig(CRM_TASK_ORIGIN,valid)?.mode).toBe('production');
  expect(crmTaskConfig('https://app.caseloadselect.ca',valid)).toBeNull();
  const local={...valid,NODE_ENV:'test',VERCEL_ENV:'development',CRM_AGENT_SYNTHETIC_WRITE_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321'};
  expect(crmTaskConfig('http://127.0.0.1:55439',local)?.cookie).toBe(CRM_SYNTHETIC_COOKIE);
  expect(crmTaskConfig(CRM_TASK_ORIGIN,local)).toBeNull();
  expect(crmTaskConfig('http://127.0.0.1:55439',{...local,NEXT_PUBLIC_SUPABASE_URL:valid.NEXT_PUBLIC_SUPABASE_URL})).toBeNull();
  expect(crmTaskConfig('http://127.0.0.1:55439',{...local,VERCEL_ENV:'production'})).toBeNull();
 });
 it('disabled handlers never fetch OIDC or storage; no HTTP synthetic bootstrap',async()=>{
  vi.stubEnv('CRM_AGENT_TASK_WRITES_ENABLED','false');
  expect((await exchange.POST(req(CRM_TASK_EXCHANGE,'POST',{taskId:id,token:'fixture'},''))).status).toBe(404);
  expect((await plan.GET(req())).status).toBe(403); expect(fixture.rpc).not.toHaveBeenCalled(); expect(fixture.oidc).not.toHaveBeenCalled();
  vi.stubEnv('CRM_AGENT_SYNTHETIC_WRITE_ENABLED','true'); vi.stubEnv('VERCEL_ENV','development'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1:54321');
  const local=new NextRequest('http://127.0.0.1:55439'+CRM_TASK_EXCHANGE,{method:'POST'});
  expect((await exchange.POST(local)).status).toBe(404);
 });
});
describe('separate task identity and route boundary',()=>{
 it('never authenticates as human and denies existing operator mutations',async()=>{
  fixture.cookies.set('portal_session','synthetic-invalid-human');
  expect(await getPortalSession()).toBeNull();expect(await getOperatorSession()).toBeNull();
  expect((await legacy.PATCH(req(`/api/admin/agency-crm/prospects/${id}`,'PATCH',{notes:'x'}),{params:Promise.resolve({id})})).status).toBe(401);
  expect(fixture.writes).not.toHaveBeenCalled();
 });
 it.each(['/admin/clients','/admin/agency-crm','/api/admin/agency-crm/follow-up','/api/operator/crm-agent-session','/api/agent/crm/tasks/nope',base+'/','/_next/static/x.js'])('denies path %s',async path=>{
  expect(crmTaskRoute(path,'GET')).toBeNull();expect((await middleware(req(path))).status).toBe(403);expect(fixture.rpc).not.toHaveBeenCalled();
 });
 it('rejects mixed, duplicate, malformed, old-reader and wrong-mode cookies at route level',async()=>{
  for(const cookie of [`${CRM_TASK_COOKIE}=${raw}; portal_session=x`,`${CRM_TASK_COOKIE}=${raw}; ${CRM_TASK_COOKIE}=${raw}`,`${CRM_TASK_COOKIE}=bad`,`__Host-crm_agent_session=${raw}`,`${CRM_SYNTHETIC_COOKIE}=${raw}`]) expect(await getCrmTaskSession(req(base,'GET',undefined,cookie))).toBeNull();
  expect(crmTaskRawCookie(`${CRM_TASK_COOKIE}=${raw}; ${CRM_TASK_COOKIE}=${raw}`,CRM_TASK_COOKIE)).toBeNull();
  expect(fixture.rpc).not.toHaveBeenCalled();
 });
 it('passes only exact task GET/operation POST after live verification and preserves the privacy gate',async()=>{
  const r=await middleware(req());expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');
  expect(fixture.rpc.mock.calls[0][1]).toMatchObject({p_task_id:id,p_mode:'production',p_origin:CRM_TASK_ORIGIN,p_token_hash:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(JSON.stringify(fixture.rpc.mock.calls)).not.toContain(raw);
  vi.stubEnv('PRIVACY_DELETION_REGISTRY_ENABLED','true');vi.stubEnv('UPSTASH_REDIS_REST_URL','');vi.stubEnv('UPSTASH_REDIS_REST_TOKEN','');
  expect((await middleware(req(`${base}/operations/${op}`,'POST',{}))).status).toBe(503);
 });
 it('propagates only fixed RPC parameters and sanitizes rejected storage errors',async()=>{
  const body={resource:'prospect',action:'update',id,values:{notes:'Synthetic note'},expected:{notes:null}};
  const r=await operation.POST(req(`${base}/operations/${op}`,'POST',body));expect(r.status).toBe(200);
  expect(fixture.rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_task_id:id,p_operation_id:op,p_request:body});
  fixture.rpc.mockRejectedValue(Error('private provider details'));
  const denied=await operation.POST(req(`${base}/operations/${op}`,'POST',body));expect(denied.status).toBe(403);expect(await denied.text()).not.toContain('private');
 });
});
describe('task OIDC exchange and HTTP validation',()=>{
 it('sets an opaque host-only secure session, no raw token in storage or response',async()=>{
  const r=await exchange.POST(req(CRM_TASK_EXCHANGE,'POST',{taskId:id,token:'synthetic-oidc'},''));
  expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true});
  const cookie=r.headers.get('set-cookie')!;expect(cookie).toMatch(/__Host-crm_task_session=[a-f0-9]{64};/);
  for(const flag of ['HttpOnly','Secure','SameSite=strict','Path=/'])expect(cookie).toContain(flag);
  expect(cookie).not.toContain('Domain=');expect(JSON.stringify(fixture.rpc.mock.calls)).not.toContain('synthetic-oidc');
 });
 it.each([{taskId:id,token:'x',grant:{enabled:true}},{taskId:'bad',token:'x'},[],null])('rejects unexpected request %j',async body=>{
  expect((await exchange.POST(req(CRM_TASK_EXCHANGE,'POST',body,''))).status).toBe(403);expect(fixture.oidc).not.toHaveBeenCalled();expect(fixture.rpc).not.toHaveBeenCalled();
 });
 it('rejects cross-origin and oversized chunked bodies before authorizing',async()=>{
  const cross=req(CRM_TASK_EXCHANGE,'POST',{taskId:id,token:'x'},'');cross.headers.set('origin','https://other.invalid');expect((await exchange.POST(cross)).status).toBe(403);
  const large=req(CRM_TASK_EXCHANGE,'POST',{taskId:id,token:'x'.repeat(21000)},'');expect((await exchange.POST(large)).status).toBe(403);
  expect(fixture.oidc).not.toHaveBeenCalled();expect(fixture.rpc).not.toHaveBeenCalled();
 });
});
