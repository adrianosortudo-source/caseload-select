import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/** Reserve bounded daily spend before render/model calls. Refuse service on any store failure. */
async function reserveInternal(identity:string):Promise<{status:"ok"; release:()=>Promise<void>}|{status:"limited"|"unavailable"}> {
  const url=process.env.UPSTASH_REDIS_REST_URL, token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token)return {status:"unavailable"};
  const redis=new Redis({url,token}); const hash=createHash("sha256").update(identity).digest("hex"); const lock=`positioning:active:${hash}`, owner=randomUUID();
  let ownsLock=false;
  const release=async()=>{try{await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",[lock],[owner]);}catch{/* lock expires */}};
  try {
    const locked=await redis.set(lock,owner,{nx:true,ex:120}); if(locked!=="OK")return {status:"limited"}; ownsLock=true;
    const individual=new Ratelimit({redis,limiter:Ratelimit.slidingWindow(3,"1 h"),prefix:"positioning:hour",analytics:false});
    const hourly=await individual.limit(hash); if(!hourly.success){await release();return {status:"limited"};}
    const daily=new Ratelimit({redis,limiter:Ratelimit.fixedWindow(100,"1 d"),prefix:"positioning:day",analytics:false});
    const global=await daily.limit("global"); if(!global.success){await release();return {status:"limited"};}
    return {status:"ok",release};
  } catch {if(ownsLock)void release();return {status:"unavailable"};}
}

/** Limit wait on the shared store; no expensive work starts on timeout. */
export async function reserveAnalysis(identity:string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut=false;
  const pending=reserveInternal(identity);
  void pending.then(result=>{if(timedOut && result.status==="ok")void result.release();});
  try { return await Promise.race([pending, new Promise<{status:"unavailable"}>((resolve) => { timer=setTimeout(()=>{timedOut=true;resolve({status:"unavailable"});},8000); })]); }
  finally { if(timer)clearTimeout(timer); }
}


