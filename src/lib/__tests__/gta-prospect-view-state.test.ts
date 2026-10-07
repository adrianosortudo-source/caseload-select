import { describe, expect, it } from "vitest";
import { readUnifiedProspectView, writeUnifiedProspectView } from "../gta-prospect-view-state";

describe("existing unified prospect filters in browser history", () => {
  it("round-trips selection, advanced fields, explicit false values and page while preserving candidate parameters", () => {
    const initial=new URLSearchParams("cr_text=Adil+Law&cr_coverageRevision=60004&zareiProfile=1");
    const state={...readUnifiedProspectView(initial),query:"Walker Law",city:"Mississauga",practiceArea:"Notary availability",profileField:"/qualification/eligible",profileValue:"false",showAdvanced:true,hasOwner:false as const,hasPublicEmail:true as const,page:1};
    const encoded=writeUnifiedProspectView(initial,state);
    expect(readUnifiedProspectView(encoded)).toEqual(state);
    expect(encoded.get("cr_text")).toBe("Adil Law");
    expect(encoded.get("cr_coverageRevision")).toBe("60004");
    expect(encoded.get("zareiProfile")).toBe("1");
  });
  it("clears only owned state and retains unrelated navigation context", () => {
    const search=new URLSearchParams("up_query=Walker&up_page=2&up_hasOwner=false&cr_text=Adil");
    const defaults=readUnifiedProspectView(new URLSearchParams());
    expect(writeUnifiedProspectView(search,defaults).toString()).toBe("cr_text=Adil");
  });
  it.each(["-1","NaN","Infinity","2junk","9007199254740992"])("refuses invalid page %s", page => {
    expect(readUnifiedProspectView(new URLSearchParams({up_page:page})).page).toBe(0);
  });
  it("rejects unsupported enum/boolean choices and ignores foreign property names", () => {
    const state=readUnifiedProspectView(new URLSearchParams("up_identity=guessed&up_downtownGeography=guessed&up_qualification=accepted&up_hasOwner=maybe&up_showAdvanced=no&up___proto__=polluted"));
    expect(state).toMatchObject({identity:"",downtownGeography:"",qualification:"",hasOwner:"",showAdvanced:false});
    expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
  });
});
