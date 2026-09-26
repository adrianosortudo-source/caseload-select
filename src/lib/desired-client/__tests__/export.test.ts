import {describe,expect,it} from "vitest";
import {createMarkdownDownload,createProfileDownload,formatBriefMarkdown,formatBriefText} from "../export";
import {buildStructuredBrief} from "../brief";
import {completeAnswers} from "./blueprint-helpers";
describe("Blueprint exports",()=>{
 const setup=()=>{const answers=completeAnswers(),saved={brief:buildStructuredBrief(answers),sourceBriefRevision:answers.revision,generatedAt:"2026-09-26T12:00:00.000Z",wordingReviewed:false,mode:"structured" as const};return{answers,saved};};
 it("copies the compact profile without dumping the source inventory",()=>{const{answers,saved}=setup(),text=formatBriefText(saved,answers);expect(text).toContain("Desired Client Blueprint");expect(text).toContain(saved.brief.portrait.text);expect(text).not.toContain("What would you like the lawyer to help you with?");});
 it("downloads supporting Markdown with source answers, Screen proposal and clear boundaries",()=>{const{answers,saved}=setup(),markdown=formatBriefMarkdown(saved,answers);expect(markdown).toContain("## Answers and sources");expect(markdown).toContain("What would you like the lawyer to help you with?");expect(markdown).toContain("do not activate scoring");expect(markdown).toContain("firm_preference");});
 it("uses neutral date-stamped filenames",()=>{const{answers,saved}=setup(),date=new Date(2026,8,26);expect(createProfileDownload(saved,answers,date).filename).toBe("desired-client-blueprint-2026-09-26.txt");expect(createMarkdownDownload(saved,answers,date).filename).toBe("desired-client-blueprint-supporting-detail-2026-09-26.md");});
});
