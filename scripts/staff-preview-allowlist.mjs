import { appendFileSync } from 'node:fs';
const base=globalThis.fetch;
let attempts=0;
globalThis.fetch=async(resource,init)=>{
  const url=new URL(typeof resource==='string'||resource instanceof URL?resource:resource.url);
  const kind=process.env.STAFF_ENDPOINT;
  if(!['responses','embeddings'].includes(kind)||url.href!=='https://api.openai.com/v1/'+kind||init?.method!=='POST') throw Error('Unexpected staff replay destination.');
  if(++attempts>Number(process.env.STAFF_CALL_LIMIT))throw Error('Fixed staff call limit reached.');
  const req=JSON.parse(init.body);
  if(kind==='responses'&&(req.model!=='gpt-6-luna'||req.max_output_tokens>4096||!Number.isInteger(req.max_output_tokens))) throw Error('Unexpected staff generation settings.');
  if(kind==='embeddings'&&(req.model!=='text-embedding-3-small'||req.dimensions!==768)) throw Error('Unexpected staff embedding settings.');
  const response=await base(resource,{...init,redirect:'error'});
  const value=await response.clone().json().catch(()=>({}));
  const u=value.usage??{};
  const details=u.input_tokens_details??{};
  const safe=n=>Number.isSafeInteger(n)&&n>=0?n:null;
  appendFileSync(process.env.STAFF_USAGE_FILE,JSON.stringify({attempt:attempts,http:response.status,model:req.model,
    input:safe(u.input_tokens??u.prompt_tokens),output:safe(u.output_tokens),cached:safe(details.cached_tokens),cacheWrite:safe(details.cache_write_tokens)})+'\n',{mode:0o600});
  return response;
};
