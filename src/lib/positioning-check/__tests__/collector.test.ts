import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const fetchOne=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/ssrf-fetch",()=>({ssrfSafeFetchOneHop:fetchOne}));
import { collectSite } from "../collector";
function html(body:string){return new Response(body,{status:200,headers:{"content-type":"text/html"}});}
beforeEach(()=>fetchOne.mockReset());
describe("bounded positioning collection",()=>{
  it("collects nav links but separates block text",async()=>{
    fetchOne.mockResolvedValueOnce(html('<nav><a href="/about">About</a></nav><h1>Family</h1><p>Services</p>')).mockResolvedValueOnce(html("<h1>About the firm</h1><p>Family law work.</p>"));
    const result=await collectSite("https://example.com/",Date.now()+5000);
    expect(result.pages.map(p=>p.url)).toContain("https://example.com/about");
    const first=result.evidence[0]; expect(first.kind).toBe("text");
    if(first.kind!=="text")throw new Error("Expected text evidence");
    expect(first.excerpt).toContain("Family Services");
    expect(first.excerpt).not.toContain("FamilyServices");
  });
  it("does not invent links from anchors without href",async()=>{
    fetchOne.mockResolvedValue(html('<nav><a>About</a><a href="">Contact</a></nav><h1>Example</h1>'));
    const result=await collectSite("https://example.com/",Date.now()+5000);
    expect(result.pages).toHaveLength(1);expect(fetchOne).toHaveBeenCalledTimes(1);
  });
  it("marks HTTP 200 challenge pages unreadable",async()=>{
    fetchOne.mockResolvedValue(html("<title>Just a moment...</title><p>Verify you are human before continuing</p>"));
    const result=await collectSite("https://example.com/",Date.now()+5000);
    expect(result.pages[0].state).toBe("unreadable"); expect(result.evidence).toEqual([]);
  });
  it("returns when a body and its cancellation never complete",async()=>{
    const body=new ReadableStream({pull:()=>new Promise<void>(()=>{}),cancel:()=>new Promise<void>(()=>{})});
    fetchOne.mockResolvedValue(new Response(body,{status:200,headers:{"content-type":"text/html"}}));
    const started=Date.now(); const result=await collectSite("https://example.com/",Date.now()+100);
    expect(Date.now()-started).toBeLessThan(2000);expect(result.pages[0].state).toBe("unreadable");
  });
  it("never follows an external redirect",async()=>{
    fetchOne.mockResolvedValue(new Response(null,{status:302,headers:{location:"https://other.example/"}}));
    const result=await collectSite("https://example.com/",Date.now()+5000);
    expect(fetchOne).toHaveBeenCalledTimes(1);expect(result.pages[0].state).toBe("unreadable");
  });
});




