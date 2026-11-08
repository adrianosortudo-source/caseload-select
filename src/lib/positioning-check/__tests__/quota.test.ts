import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({set:vi.fn(),eval:vi.fn(),limit:vi.fn()}));
vi.mock("@upstash/redis",()=>({Redis:class {set=mock.set;eval=mock.eval;}}));
vi.mock("@upstash/ratelimit",()=>({Ratelimit:class { static slidingWindow(){return {};} static fixedWindow(){return {};} limit=mock.limit; }}));
import { releaseWithinDeadline, reserveAnalysis } from "../quota";
beforeEach(()=>{vi.stubEnv("UPSTASH_REDIS_REST_URL","https://example.com");vi.stubEnv("UPSTASH_REDIS_REST_TOKEN","test");mock.set.mockReset().mockResolvedValue("OK");mock.eval.mockReset().mockResolvedValue(1);mock.limit.mockReset().mockResolvedValue({success:true});});
afterEach(()=>vi.unstubAllEnvs());
describe("positioning quota",()=>{
 it("fails closed when shared store settings are missing",async()=>{vi.stubEnv("UPSTASH_REDIS_REST_URL","");expect((await reserveAnalysis("a")).status).toBe("unavailable");});
 it("recognizes an active request",async()=>{mock.set.mockResolvedValue(null);expect(await reserveAnalysis("a")).toEqual({status:"limited",reason:"active"});});
 it("distinguishes hourly and daily limits and releases the lock",async()=>{mock.limit.mockResolvedValueOnce({success:false});expect(await reserveAnalysis("a")).toEqual({status:"limited",reason:"hourly"});expect(mock.eval).toHaveBeenCalled();mock.limit.mockResolvedValueOnce({success:true}).mockResolvedValueOnce({success:false});expect(await reserveAnalysis("b")).toEqual({status:"limited",reason:"daily"});});
 it("fails closed and releases the lock on store errors",async()=>{mock.limit.mockRejectedValue(new Error("offline"));expect((await reserveAnalysis("a")).status).toBe("unavailable");expect(mock.eval).toHaveBeenCalled();});
 it("does not hang when lock cleanup stalls",async()=>{const start=Date.now();await releaseWithinDeadline(()=>new Promise<void>(()=>{}),Date.now()+100);expect(Date.now()-start).toBeLessThan(2000);});
 it("only returns a release handle after both reservations succeed",async()=>{const result=await reserveAnalysis("a");expect(result.status).toBe("ok");if(result.status==="ok")await result.release();expect(mock.limit).toHaveBeenCalledTimes(2);expect(mock.eval).toHaveBeenCalled();});
});

