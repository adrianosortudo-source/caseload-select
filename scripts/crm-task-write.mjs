/** Fixed API client, no arbitrary URL/script/payload inputs or data output. */
import { request } from '@playwright/test';
const origin = 'https://admin.caseloadselect.ca';
const audience = 'caseload-crm-task-write/v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const allowed = new Set(['prospect:update','deal:update','reminder:update','template_draft:create']);
const taskId = process.env.CRM_TASK_ID ?? '';
let context;
try {
  if (!uuid.test(taskId) || process.env.GITHUB_REPOSITORY !== 'adrianosortudo-source/caseload-select' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw Error();
  const tokenUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? '');
  if (tokenUrl.protocol !== 'https:' || tokenUrl.username || tokenUrl.password || !tokenUrl.hostname.endsWith('.actions.githubusercontent.com')) throw Error();
  tokenUrl.searchParams.set('audience',audience);
  context = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin, 'Content-Type':'application/json' }, timeout:20_000, ignoreHTTPSErrors:false });
  const started=Date.now(); let issued=0;
  const renew=async()=>{
    if (Date.now()-started>=55*60_000) throw Error();
    const oidc=await fetch(tokenUrl,{headers:{Authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? ''}`},redirect:'error',signal:AbortSignal.timeout(10_000)});
    if (!oidc.ok) throw Error();
    const body=await oidc.json();
    if (typeof body.value!=='string' || body.value.length>16_384) throw Error();
    const exchange=await context.post('/api/operator/crm-task-session',{data:{taskId,token:body.value},maxRedirects:0});
    if (!exchange.ok()) throw Error();
    issued=Date.now();
  };
  await renew();
  const response=await context.get(`/api/agent/crm/tasks/${taskId}`,{maxRedirects:0});
  if (!response.ok()) throw Error();
  const bytes=await response.body(); if (bytes.length>1_100_000) throw Error();
  const plan=JSON.parse(bytes.toString('utf8'));
  if (plan.taskId!==taskId || !Array.isArray(plan.operations) || plan.operations.length<1 || plan.operations.length>10) throw Error();
  for(const op of plan.operations) {
    if (!op || !uuid.test(op.id) || !op.request || !allowed.has(`${op.request.resource}:${op.request.action}`)) throw Error();
    if (Date.now()-started>=55*60_000) throw Error();
    if (Date.now()-issued>=10*60_000) await renew();
    const applied=await context.post(`/api/agent/crm/tasks/${taskId}/operations/${op.id}`,{data:op.request,maxRedirects:0});
    if (!applied.ok() || (await applied.json()).ok!==true) throw Error();
  }
} catch { process.exitCode=1; }
finally { if (context) await context.dispose(); }
