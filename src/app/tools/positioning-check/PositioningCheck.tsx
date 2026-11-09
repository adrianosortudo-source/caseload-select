"use client";
import { useEffect, useRef, useState } from "react";
import { normalizeWebsiteUrl } from "@/lib/positioning-check/website-url";
import type { Direction, PositioningResponse, PositioningResult } from "@/lib/positioning-check/types";
const labels: Record<string, string> = { audience: "Intended audience", practice_focus: "Practice focus", central_promise: "Central promise", practical_benefits: "Practical benefits", emotional_benefits: "Emotional benefits", reasons_to_choose: "Reasons to choose you", supporting_credentials: "Supporting credentials", consistency: "Consistency across pages" };
const statuses: Record<string, string> = { observed: "Observed", inferred: "Interpretation", unclear: "Unclear", not_observed: "Not expressed", not_assessable: "Not assessed" };
function Copy({ children, kind = "body" }: { children: React.ReactNode; kind?: string }) { return <p data-ui-copy={kind}>{children}</p>; }
function Sources({ ids, report, onSource }: { ids: string[]; report: PositioningResult; onSource: (id: string) => void }) {
 return <div className="pc-sources">{ids.map(id => { const e = report.evidence.find(item => item.id === id); return e ? <a key={id} href={"#evidence-" + id} onClick={event => { event.preventDefault(); onSource(id); }}>{e.title || "Website evidence"} · {id}</a> : null; })}</div>;
}
function AssessmentStatus({ element }: { element: PositioningResult["part1"]["elements"][number] }) {
 return <p className="pc-label" data-ui-copy="supporting">{statuses[element.status]} · {element.confidence ? element.confidence + " confidence" : "No confidence rating"}{element.conflict ? " · Conflicting evidence" : ""}</p>;
}
function useNaturalCopy() {
 useEffect(() => {
  const root = document.querySelector<HTMLElement>(".pc-root"); if (!root) return;
  function lines(el: HTMLElement) { const rows: {top:number; left:number; right:number; words:number[]}[] = []; const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT); let node; while((node=walker.nextNode())) for(const m of (node.textContent||"").matchAll(/\S+/g)){const range=document.createRange();range.setStart(node,m.index!);range.setEnd(node,m.index!+m[0].length);for(const r of range.getClientRects()){if(!r.width||!r.height)continue;let row=rows.find(l=>Math.abs(l.top-r.top)<2);if(!row){row={top:r.top,left:r.left,right:r.right,words:[]};rows.push(row);}row.right=r.right;row.words.push(r.width);}} return rows; }
  function passes(el:HTMLElement){const rows=lines(el),width=el.getBoundingClientRect().width;return (rows.length<2||rows.at(-1)!.words.length>1)&&!rows.slice(0,-1).some((l,i)=>l.right-l.left<width*.75&&width-(l.right-l.left)>rows[i+1].words[0]+5);}
  function audit(){for(const el of root!.querySelectorAll<HTMLElement>("[data-ui-copy]")){
   if(!el.getBoundingClientRect().width||el.closest("[hidden]")||el.closest("details:not([open])"))continue;
   el.style.fontSize="";el.style.letterSpacing="";el.style.textWrap="wrap";const natural=lines(el);if(natural.length<2||natural.at(-1)!.words.length!==1)continue;
   const base=parseFloat(getComputedStyle(el).fontSize),spacing=parseFloat(getComputedStyle(el).letterSpacing)||0;let repaired=false;
   for(const style of ["pretty","balance"]){el.style.textWrap=style;if(passes(el)){repaired=true;break;}}
   if(!repaired)for(const delta of [1,2,3,4]){el.style.fontSize=`${base+delta}px`;for(const style of delta<=2?["wrap","pretty","balance"]:["wrap"]){el.style.textWrap=style;if(passes(el)){repaired=true;break;}}if(repaired)break;}
   if(!repaired){el.style.fontSize="";el.style.textWrap="wrap";for(const tightening of [.1,.2]){el.style.letterSpacing=`${spacing-tightening}px`;if(passes(el)){repaired=true;break;}}}
   if(!repaired){el.style.fontSize="";el.style.letterSpacing="";el.style.textWrap="wrap";}
  }}
  let frame=0;const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>requestAnimationFrame(audit));}; let observedWidth=-1;const observer=new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(Math.abs(width-observedWidth)>.5){observedWidth=width;schedule();}});observer.observe(root);root.addEventListener("click",schedule);root.addEventListener("toggle",schedule,true);const mutation=new MutationObserver(schedule);mutation.observe(root,{childList:true,subtree:true,characterData:true});document.fonts.ready.then(schedule);schedule();return()=>{observer.disconnect();mutation.disconnect();cancelAnimationFrame(frame);root.removeEventListener("click",schedule);root.removeEventListener("toggle",schedule,true);};
 }, []);
}
export default function PositioningCheck() {
 useNaturalCopy();
 const [ready, setReady] = useState(false); useEffect(() => setReady(true), []);
 const [url, setUrl] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<{ message: string; retryable: boolean; code?: string } | null>(null); const [report, setReport] = useState<PositioningResult | null>(null); const [view, setView] = useState<"brief" | "evidence" | "next">("brief"); const [sourceTarget, setSourceTarget] = useState<string | null>(null); const [choice, setChoice] = useState("unsure"); const [copied, setCopied] = useState(""); const reportHeading = useRef<HTMLHeadingElement>(null); const pending = useRef(false); const errorHeading = useRef<HTMLHeadingElement>(null); useEffect(() => { if (error) errorHeading.current?.focus(); }, [error]);
 async function run(event?: React.FormEvent) { event?.preventDefault(); if (pending.current) return; let parsed: URL; try { parsed = normalizeWebsiteUrl(url); } catch { setReport(null); setError({ code: "invalid_url", message: "Enter a public website address, such as https://yourfirm.ca.", retryable: false }); return; }
  setUrl(parsed.href); pending.current = true; setBusy(true); setError(null); setReport(null); setCopied(""); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 110_000);
  try { const response = await fetch("/api/tools/positioning-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: parsed.href }), signal: controller.signal }); const data = await response.json() as PositioningResponse; if (data.status === "error") { setError({ code: data.code, message: data.message, retryable: data.retryable }); } else if ((data.status === "success" || data.status === "partial") && data.part1 && data.coverage && Array.isArray(data.evidence)) { setReport(data); setView("brief"); setChoice("unsure"); requestAnimationFrame(() => reportHeading.current?.focus()); } else throw new Error("response"); } catch (e) { setError({ message: e instanceof Error && e.name === "AbortError" ? "The review took too long. Please try again." : "We could not complete the review. Please try again shortly.", retryable: true }); } finally { clearTimeout(timer); pending.current = false; setBusy(false); }
 }
 async function copyBrief() { if (!report) return; const d = report.part2.directions.find(item => item.id === choice); const text = [`Website positioning discussion`, report.metadata.requestedUrl, `Choice: ${d?.label || (choice === "keep" ? "Keep the current direction" : "Unsure; discuss the options")}`, d?.possibleStatement || report.part1.statement, "Questions to discuss:", ...(d?.validationQuestions || ["Which clients and matters would we like more of?", "Does this reading reflect our intended practice?", "What evidence would help us decide?"]).map(q => `• ${q}`), "AI-assisted website interpretation; firm confirmation pending."].join("\n"); try { await navigator.clipboard.writeText(text); setCopied("Discussion brief copied. You can paste it into your own notes."); } catch { setCopied("Copying is unavailable in this browser. Select the report text to save your notes."); } }
 const direction: Direction | undefined = report?.part2.directions.find(d => d.id === choice);
 const viewHeading = useRef<HTMLHeadingElement>(null);
 useEffect(() => {
  if (!report) return;
  const frame = requestAnimationFrame(() => {
   if (view === "evidence" && sourceTarget) { const target = document.getElementById("evidence-" + sourceTarget); target?.focus(); target?.scrollIntoView({ block: "start" }); }
   else if (view === "brief") reportHeading.current?.focus();
   else viewHeading.current?.focus();
  });
  return () => cancelAnimationFrame(frame);
 }, [view, sourceTarget, report]);
 function navigate(next: "brief" | "evidence" | "next", target: string | null = null) {
  if (next === view && target === sourceTarget && target) { const element = document.getElementById("evidence-" + target); element?.focus(); element?.scrollIntoView({ block: "start" }); }
  setSourceTarget(target); setView(next);
 }
 function select(id: string) { setChoice(id); setCopied(""); }
 const central = report?.part1.elements.find(a => a.key === "central_promise");
 const facts = report?.part1.elements.filter(a => a.key === "audience" || a.key === "practice_focus") || [];
 const evidenceLink = (id: string) => navigate("evidence", id);
 return <div className="pc-root"><header className="pc-top"><a href="https://caseloadselect.ca/" aria-label="CaseLoad Select home"><img src="/brand/logos/lockup-horizontal-light-transparent.png" width="794" height="117" alt="CaseLoad Select" /></a><a href="https://caseloadselect.ca/tools.html">All tools</a></header><main className="pc-main">
 <section className="pc-intro" data-ui-component-content="introduction" hidden={!!report}><h1 data-ui-copy="heading">Website positioning</h1><Copy>See the positioning your law firm communicates, its evidence and possible directions. Free, with no account or email.</Copy></section>
 <form onSubmit={run} className="pc-form" data-ui-component-content="website-form" hidden={!!report}><label htmlFor="pc-url">Your firm’s website</label><input id="pc-url" name="website" type="text" inputMode="url" autoComplete="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://yourfirm.ca" required disabled={busy} aria-describedby="pc-privacy" aria-invalid={error?.code === "invalid_url" ? true : undefined} /><button type="submit" disabled={busy || !ready}>{busy ? "Reviewing your website…" : "Review my website"}</button><p id="pc-privacy" data-ui-copy="supporting">Only public website content is reviewed. Your report stays in this browser session; refreshing may require a new review.</p></form>
 {busy && <section className="pc-notice" role="status" data-ui-component-content="processing"><h2 data-ui-copy="heading">Reviewing your website</h2><Copy>We are collecting website evidence and preparing your report. This can take around a minute. Keep this page open.</Copy></section>}
 {error && <section className="pc-notice" role="alert" data-ui-component-content="error"><h2 ref={errorHeading} tabIndex={-1} data-ui-copy="heading">The review could not finish</h2><Copy>{error.message}</Copy>{error.retryable && <button onClick={() => void run()}>Try again</button>}</section>}
 {report && <article className="pc-report">
 {view === "brief" && <>
 <div className="pc-report-heading" data-ui-component-content="report-heading"><h1 ref={reportHeading} tabIndex={-1} data-ui-copy="heading">Your positioning review</h1><a className="pc-url" href={report.metadata.requestedUrl} target="_blank" rel="noopener noreferrer">{report.metadata.requestedUrl}</a><Copy kind="supporting">AI-assisted website interpretation · Firm confirmation pending</Copy></div>
 {report.status === "partial" && <section className="pc-partial-note" data-ui-component-content="partial"><h3 data-ui-copy="heading">This is a partial review</h3><Copy>Some website evidence is incomplete.</Copy><button className="pc-back" onClick={() => navigate("evidence", "coverage")}>View coverage limits</button></section>}
 <section className="pc-today pc-section" aria-labelledby="pc-today-title">
 <div data-ui-component-content="today-heading"><h2 id="pc-today-title" data-ui-copy="heading">Your position today</h2></div>
 {central && <div className="pc-message" data-ui-component-content="website-message"><p className="pc-label">Our reading of the website’s message</p><AssessmentStatus element={central} /><p className="pc-headline" data-ui-copy="body">{central.finding}</p></div>}
 <div className="pc-facts">{facts.map(a => <div key={a.key} data-ui-component-content={"fact-" + a.key}><h3 data-ui-copy="heading">{a.key === "audience" ? "Audience" : "Practice focus"}</h3>{(a.status !== "observed" || a.confidence !== "high" || a.conflict) && <AssessmentStatus element={a} />}<Copy>{a.finding}</Copy></div>)}</div>
 <button className="pc-back" onClick={() => navigate("evidence")}>Why we reached this reading</button>
 </section>
 <section className="pc-possibilities" aria-labelledby="pc-directions-title">
 <div data-ui-component-content="directions-intro"><h2 id="pc-directions-title" data-ui-copy="heading">Possible directions</h2><Copy>Your current direction remains a valid choice. These website-based options need research and validation.</Copy></div>
 <div className="pc-options" aria-label="Direction to discuss">{report.part2.directions.map(d => <button className="pc-direction-card" key={d.id} aria-pressed={choice === d.id} aria-label={d.label} onClick={() => select(d.id)}><span className="pc-card-content" data-ui-component-content={"direction-card-" + d.id}><span className="pc-card-title" data-ui-copy="heading">{d.label}</span><span className="pc-card-body" data-ui-copy="body">{d.audienceSituation}</span></span></button>)}</div>
 <div className="pc-choice-actions"><button className="pc-option" aria-pressed={choice === "keep"} onClick={() => select("keep")}>Keep the current direction</button><button className="pc-option" aria-pressed={choice === "unsure"} onClick={() => select("unsure")}>I’m unsure</button></div>
 <div className="pc-choice-reading" aria-live="polite">
 {direction ? <><div data-ui-component-content="communication"><h3 data-ui-copy="heading">What this could communicate</h3><Copy>{direction.communicationImplication}</Copy></div><div data-ui-component-content="tradeoff"><h3 data-ui-copy="heading">The tradeoff</h3><Copy>{direction.tradeoff}</Copy></div><button className="pc-back" onClick={() => navigate("evidence", "direction-" + direction.id)}>Read this direction’s full reasoning</button></> : <div data-ui-component-content="unselected-choice"><Copy>{choice === "keep" ? "Retaining your present direction is a valid choice. Discuss whether the website expresses it clearly and supports it with evidence." : "You do not need to choose now. Use the evidence and questions to discuss what fits your preferred work."}</Copy></div>}
 </div>
 </section>
 <div className="pc-brief-footer" data-ui-component-content="brief-next"><Copy kind="supporting">Before choosing, confirm your preferred work and test the message.</Copy><div className="pc-actions"><button onClick={() => navigate("next")}>Explore next steps</button><button className="pc-back" onClick={() => navigate("evidence")}>Evidence and references</button></div></div>
 <button className="pc-back" onClick={() => { setReport(null); setCopied(""); requestAnimationFrame(() => document.getElementById("pc-url")?.focus()); }}>Review another website</button>
 </>}
 {view === "next" && <section className="pc-handoff">
 <button className="pc-back" onClick={() => navigate("brief")}>Return to report</button>
 <div className="pc-section" data-ui-component-content="handoff-heading"><h1 ref={viewHeading} tabIndex={-1} data-ui-copy="heading">Next steps with CaseLoad Select</h1><Copy>Turn a possible direction into a supported choice.</Copy></div>
 <div className="pc-selection" data-ui-component-content="handoff-choice"><p className="pc-label">Your discussion choice</p><Copy>{direction?.label || (choice === "keep" ? "Keep the current direction" : "Unsure; discuss the options")}</Copy></div>
 <ol className="pc-next-steps">{[["Confirm your preferred work", "Which clients and matters would you like more of?"], ["Check the market and the proof", "Compare competing messages and substantiate your claims."], ["Test and refine the message", "Check how intended clients understand it."]].map(([heading, text], i) => <li key={heading}><div data-ui-component-content={"next-step-" + i}><h2 data-ui-copy="heading">{heading}</h2><Copy>{text}</Copy></div></li>)}</ol>
 <div data-ui-component-content="handoff-actions"><div className="pc-actions"><button onClick={() => void copyBrief()}>Copy discussion brief</button><a className="pc-button" href="https://caseloadselect.ca/conversation.html" target="_blank" rel="noopener noreferrer">Discuss your positioning</a></div><Copy kind="supporting">Nothing is sent automatically. Any project scope and deliverables are agreed before work begins.</Copy><p role="status" data-ui-copy="supporting">{copied}</p></div>
 <button className="pc-back" onClick={() => navigate("evidence")}>Evidence and references</button>
 </section>}
 {view === "evidence" && <section className="pc-reference">
 <button className="pc-back" onClick={() => navigate("brief")}>Return to report</button><button className="pc-back" onClick={() => navigate("next")}>Explore next steps</button>
 <div className="pc-section" data-ui-component-content="evidence-heading"><h1 ref={viewHeading} tabIndex={-1} data-ui-copy="heading">Evidence and references</h1><Copy>The full website interpretation, possible directions and collected sources.</Copy></div>
 <section className="pc-section" data-ui-component-content="original-statement"><h2 data-ui-copy="heading">Our website interpretation</h2><Copy>{report.part1.statement}</Copy><Copy>{report.part1.rationale}</Copy><Copy kind="supporting">This reading describes website communication. Competitive distinctiveness, legal quality and client attraction have not been assessed.</Copy></section>
 <section className="pc-section" data-ui-component-content="rubric"><h2 data-ui-copy="heading">Clarity ratings and reasons</h2><Copy>Clarity describes how explicitly the website communicates each element. Confidence describes the strength of our interpretation.</Copy><Copy kind="supporting">0 Not expressed · 1 Broad · 2 Identifiable · 3 Explicit and developed. Unavailable evidence is not scored.</Copy></section>
 {report.part1.elements.map(a => <section key={a.key} className="pc-assessment" data-ui-component-content={"assessment-" + a.key}><h3 data-ui-copy="heading">{labels[a.key]}</h3><AssessmentStatus element={a} /><Copy kind="supporting">{a.clarity === null ? "Not assessed" : a.clarity + "/3 clarity"}</Copy><Copy>{a.finding}</Copy><Copy>{a.reason}</Copy>{a.uncertainty && <Copy kind="supporting">Uncertainty: {a.uncertainty}</Copy>}<Sources ids={a.evidenceIds} report={report} onSource={evidenceLink} /></section>)}
 <section className="pc-section" data-ui-component-content="visual-findings"><h2 data-ui-copy="heading">What your images communicate</h2>{report.part1.visualFindings.length ? report.part1.visualFindings.map((v, i) => <div key={i}><Copy>{v.finding}</Copy><Sources ids={v.evidenceIds} report={report} onSource={evidenceLink} /></div>) : <Copy>Visual positioning was not assessed. No image-based conclusions are included.</Copy>}</section>
 <div className="pc-section" data-ui-component-content="direction-reference-heading"><h2 data-ui-copy="heading">Possible directions to validate</h2><Copy>These are hypotheses, including any potential effects on client attraction and expectations. They require testing with your firm and its audience.</Copy></div>
 {report.part2.directions.map(d => <section key={d.id} id={"evidence-direction-" + d.id} tabIndex={-1} className="pc-evidence">
 <div data-ui-component-content={"full-direction-" + d.id}><h3 data-ui-copy="heading">{d.label}</h3><Copy>{d.audienceSituation}</Copy></div>
 {[[ "A possible message", d.possibleStatement ], [ "Communication", d.communicationImplication ], [ "Client expectations", d.clientExpectation ], [ "The tradeoff", d.tradeoff ]].map(([title, text]) => <div className="pc-reference-block" key={title} data-ui-component-content={d.id + "-" + title}><h3 data-ui-copy="heading">{title}</h3><Copy>{text}</Copy></div>)}
 <Sources ids={d.evidenceIds} report={report} onSource={evidenceLink} /><div className="pc-reference-block" data-ui-component-content={d.id + "-validation"}><h3 data-ui-copy="heading">What we would need to validate</h3><ul className="pc-validation-questions" role="list">{d.validationQuestions.map(q => <li key={q} data-ui-copy="body">{q}</li>)}</ul></div></section>)}
 <section className="pc-section" data-ui-component-content="direction-limits"><h2 data-ui-copy="heading">Direction limits</h2>{report.part2.limitations.map((l, i) => <Copy key={i} kind="supporting">{l}</Copy>)}</section>
 <section className="pc-section" id="evidence-coverage" tabIndex={-1} data-ui-component-content="coverage"><h2 data-ui-copy="heading">Sources, coverage and limits</h2><Copy>{report.coverage.pages.length} pages attempted. {report.coverage.pages.filter(p => p.state === "truncated").length} pages truncated.</Copy>{report.coverage.limitations.map((l, i) => <Copy key={i} kind="supporting">{l}</Copy>)}<ul>{report.coverage.pages.map((p, i) => <li key={i}><a href={p.url} target="_blank" rel="noopener noreferrer">{p.title || p.url}</a> · {p.state} · {p.retainedChars} retained characters</li>)}</ul><ul>{report.coverage.screenshots.map(s => <li key={s.id}>{s.viewport} image: {s.state}; {s.analyzed ? "analysed" : "not analysed"}{s.clippedFromPx !== null ? "; clipped from " + s.clippedFromPx + "px" : ""}</li>)}</ul><Copy kind="supporting">Client perceptions, competitors and service delivery require further research. Ratings are qualitative judgments, not measured market advantage.</Copy></section>
 {report.evidence.map(e => <section className="pc-evidence" id={"evidence-" + e.id} key={e.id} tabIndex={-1} data-ui-component-content={"evidence-" + e.id}><h3 data-ui-copy="heading">{e.kind === "screenshot" ? "Website image evidence" : e.title}</h3><p className="pc-label">{e.id}</p>{e.kind === "text" ? <Copy>{e.excerpt}</Copy> : <Copy>{e.visibleRegion}</Copy>}<a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">Read the source</a><Copy kind="supporting">Captured {new Date(e.capturedAt).toLocaleDateString("en-CA")}{e.kind === "text" && e.truncated ? " · Truncated" : ""}</Copy></section>)}
 <div className="pc-section" data-ui-component-content="metadata"><Copy kind="supporting">Model {report.metadata.model} · Rubric {report.metadata.rubricVersion} · Generated {new Date(report.metadata.generatedAt).toLocaleDateString("en-CA")}</Copy></div>
 <button className="pc-back" onClick={() => navigate("brief")}>Return to report</button>
 </section>}
 </article>}
 </main><footer className="pc-footer">CaseLoad Select · Website positioning review</footer></div>;
}


