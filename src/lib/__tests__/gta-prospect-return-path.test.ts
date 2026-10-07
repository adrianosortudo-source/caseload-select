import { describe, expect, it } from "vitest";
import { prospectFirmResearchHref, prospectListReturnPath, validatedProspectListReturnPath } from "../gta-prospect-return-path";

describe("firm detail return target", () => {
  it("preserves existing list state, candidate cursor and hash through the exact firm link", () => {
    const list = prospectListReturnPath("?up_city=Mississauga&up_page=1&cr_cursor=frozen%2F60004&cr_text=Adil+Law","#retained-context");
    const href = new URL(prospectFirmResearchHref("firm/uuid",list),"https://local.invalid");
    expect(href.pathname).toBe("/admin/prospects/firms/firm%2Fuuid");
    expect(href.searchParams.get("returnTo")).toBe(list);
    expect(validatedProspectListReturnPath(href.searchParams.get("returnTo"))).toBe(list);
  });
  it.each([undefined,null,[],["/admin/prospects"],"https://evil.invalid/admin/prospects","//evil.invalid/admin/prospects","javascript:alert(1)","/admin/prospects/firms/id","/admin/prospects/../settings","/admin/prospects%2F..%2Fsettings","/admin/prospects\\evil","/admin/prospects?x=\nunsafe","/admin/prospects?x="+"a".repeat(8192)])("refuses unsafe or unbounded return targets: %j", value => {
    expect(validatedProspectListReturnPath(value)).toBe("/admin/prospects");
  });
  it("keeps direct firm links working without a saved list view", () => {
    expect(prospectFirmResearchHref("uuid")).toBe("/admin/prospects/firms/uuid");
    expect(prospectFirmResearchHref("uuid","https://evil.invalid/")).toBe("/admin/prospects/firms/uuid");
  });
});
