import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({reserve:vi.fn(),collect:vi.fn(),generate:vi.fn(),release:vi.fn()}));
vi.mock("@/lib/positioning-check/quota",()=>({reserveAnalysis:mocks.reserve,releaseWithinDeadline:async(fn:()=>Promise<void>)=>fn()}));
vi.mock("@/lib/positioning-check/collector",()=>({collectSite:mocks.collect}));
vi.mock("@/lib/positioning-check/gemini",()=>({generateAnalysis:mocks.generate,MODEL:"test",PROMPT_VERSION:"test",RUBRIC_VERSION:"test"}));
vi.mock("@/lib/rate-limit",()=>({ipFromRequest:()=>"test"}));
vi.mock("@/lib/ssrf",()=>({validateOutboundUrl:()=>({ok:true})}));
import { POST } from "../route";
const req=(body:string)=>new Request("https://example.com/api",{method:"POST",headers:{"content-type":"application/json"},body}) as NextRequest;
const site=()=>({requestedUrl:"https://example.com/",resolvedOrigin:"https://example.com",pages:[{url:"https://example.com/",title:"Home",capturedAt:"2026-11-08",state:"readable",retainedChars:200}],evidence:[],limitations:[]});
beforeEach(()=>{vi.stubEnv("POSITIONING_CHECK_ENABLED","true");vi.stubEnv("RENDER_SERVICE_URL","");vi.stubEnv("RENDER_SERVICE_TOKEN","");mocks.reserve.mockReset().mockResolvedValue({status:"ok",release:mocks.release});mocks.release.mockReset().mockResolvedValue(undefined);mocks.collect.mockReset().mockResolvedValue(site());mocks.generate.mockReset().mockResolvedValue({analysis:{part1:{},part2:{}},inputTokens:1,outputTokens:1,calls:1});});
afterEach(()=>vi.unstubAllEnvs());
describe("positioning route errors",()=>{
 it("upgrades pasted HTTP addresses before collection and records the secure URL",async()=>{const result=await (await POST(req('{"url":"http://galelaw.ca/"}'))).json();expect(mocks.collect).toHaveBeenCalledWith("https://galelaw.ca/",expect.any(Number));expect(result.metadata.requestedUrl).toBe("https://galelaw.ca/");});
 it("rejects unsupported schemes and credentials before quota reservation",async()=>{for(const url of ["ftp://galelaw.ca/","https://user:pass@galelaw.ca/"]){expect((await (await POST(req(JSON.stringify({url})))).json()).code).toBe("invalid_url");}expect(mocks.reserve).not.toHaveBeenCalled();});

 it("returns feature_disabled when switched off",async()=>{vi.stubEnv("POSITIONING_CHECK_ENABLED","");expect((await (await POST(req('{}'))).json()).code).toBe("feature_disabled");expect(mocks.reserve).not.toHaveBeenCalled();});
 it("rejects invalid and oversized requests before reserving",async()=>{expect((await (await POST(req('{'))).json()).code).toBe("invalid_url");expect((await (await POST(req(JSON.stringify({url:"x".repeat(5000)})))).json()).code).toBe("invalid_url");expect(mocks.reserve).not.toHaveBeenCalled();});
 it("fails closed when the quota store is unavailable",async()=>{mocks.reserve.mockResolvedValue({status:"unavailable"});expect((await (await POST(req('{"url":"example.com"}'))).json()).code).toBe("provider_unavailable");expect(mocks.collect).not.toHaveBeenCalled();});
 it("reports daily capacity accurately",async()=>{mocks.reserve.mockResolvedValue({status:"limited",reason:"daily"});const response=await POST(req('{"url":"example.com"}'));expect(response.status).toBe(429);expect((await response.json()).message).toContain("daily");expect(mocks.collect).not.toHaveBeenCalled();});
 it("returns blocked_or_unreadable without model call for an empty site",async()=>{const x=site();x.pages[0].retainedChars=0;mocks.collect.mockResolvedValue(x);expect((await (await POST(req('{"url":"example.com"}'))).json()).code).toBe("blocked_or_unreadable");expect(mocks.generate).not.toHaveBeenCalled();});
 it("maps model timeout and releases its lock",async()=>{mocks.generate.mockRejectedValue(new Error("timeout"));expect((await (await POST(req('{"url":"example.com"}'))).json()).code).toBe("timeout");expect(mocks.release).toHaveBeenCalled();});
 it("never allows model extras to replace collector-owned fields",async()=>{mocks.generate.mockResolvedValue({analysis:{status:"success",evidence:[{id:"invented"}],metadata:{model:"invented"},coverage:{},part1:{},part2:{}},inputTokens:1,outputTokens:1,calls:1});const result=await (await POST(req('{"url":"example.com"}'))).json();expect(result.status).toBe("partial");expect(result.evidence).toEqual([]);expect(result.metadata.model).toBe("test");expect(result.coverage.pages).toHaveLength(1);});
 it("returns partial when the renderer is unavailable",async()=>{const result=await (await POST(req('{"url":"example.com"}'))).json();expect(result.status).toBe("partial");expect(result.coverage.screenshots.every((s:{analyzed:boolean})=>!s.analyzed)).toBe(true);});
});

