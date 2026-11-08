import { describe, expect, it } from "vitest";
import { isSiteCapture } from "../capture";
describe("renderer capture origin",()=>{
  const source=new URL("https://example.com/about");
  it("accepts same-site final captures",()=>{expect(isSiteCapture(source,"https://www.example.com/")).toBe(true);});
  it("rejects external, insecure, and malformed destinations",()=>{for(const url of ["https://other.example/","https://example.com.attacker.test/","http://example.com/","bad url"])expect(isSiteCapture(source,url)).toBe(false);});
});
