"use client";
import { useMemo, useState } from "react";
import { buildWebsitePresentation, websiteReviewCta } from "./website-presentation";
import { buildSeoReportModel, checkObservationDisplayText, getDisplayedCategoryWeights, type ReportAction, type ReportDecision, type SeoReportModel } from "@/app/api/tools/seo-check/report-model";

type Severity = "critical" | "high" | "medium" | "low" | "info";
interface CheckItem { label:string; status:"pass"|"warn"|"fail"; detail:string; fix?:string; scored?:boolean; checkId?:string; sourceIds?:string[]; disposition?:"scored"|"unscored"|"pending-review"; basis?:string; predicate?:string; scoringRationale?:string; evidence?:{kind:string;assessedUrl?:string;applicability:"applicable"|"not-applicable"|"unknown";coverage:"observed"|"not-observed"|"not-assessed";detail:string}; applicability?:"applicable"|"not-applicable"|"unknown" }
interface CategoryResult { name:string; score:number; maxScore:number; items:CheckItem[]; counts?:{fail:number;warn:number;applicable:number;notAssessed:number;notApplicable:number} }
interface PageResult { url:string; title:string|null; pageType:string; pageScore:number|null; pageGrade:string; aiVisibilityScore:number|null; categories:CategoryResult[]; failCount:number; warnCount:number; httpStatus:number; indexable:boolean|null; robotsAccess?:{google:boolean|null;bing:boolean|null;scanner:boolean|null}; indexability:{metaNoindex:boolean|null;headerNoindex:boolean|null;indexable:boolean|null;googleDirectives?:{noindex:"observed"|"not-observed"|"unknown";nofollow:"observed"|"not-observed"|"unknown";observations:Array<{source:"meta"|"x-robots-tag";scope:string;crawlerToken:string|null;rawValue:string;googleApplicability:"applicable"|"not-applicable"|"unknown";limitation?:string}>};inSitemap?:boolean|null;sitemapComplete?:boolean}; schema?:{types:string[];fields?:{name?:boolean;telephone?:boolean;address?:boolean;areaServed?:boolean;sameAs?:boolean}}; lawFirm?:{phoneVisible:boolean;contactFormPresent:boolean;consultationCta:boolean;practiceAreaIntent:boolean;trust?:{credentials:boolean}}; wordCount?:number; keyWarnings?:string[]; pageAudit?:{metaDescription?:string|null;h1s?:string[]|null;h2s?:string[]|null;ctaEvidence?:string[]|null;phoneEvidence?:string[]|null}|null }
interface Issue { id:string; category:string; severity:Severity; status:"pass"|"warn"|"fail"; title:string; detail:string; fix?:string; evidence?:string; affectedUrls:string[]; affectedCount:number; totalPages:number; pageTypeImpact?:string[]; confidence:"high"|"medium"|"low"; effort:"low"|"medium"|"high"; priority:number; internalNote?:string; prospectingAngle?:string }
type AiBotPurpose="search"|"grounding"|"training"|"product-indexing"|"open-dataset"|"user-initiated"|"unknown";
interface AiBotStatus { token?:string; name:string; blocked:boolean|null; category?:"search"|"training"|"user-initiated"; purposes?:AiBotPurpose[]; isControlToken?:boolean; robotsSemantics?:"respects"|"may-not-apply"|"generally-ignores"|"controls-specified-uses"|"unknown"; policyObservation?:"blocking-rule-observed"|"no-blocking-rule-observed"|"not-assessed"; actualFetchAccess?:"not-verified"; sourceUrl?:string|null; reviewedAt?:string|null; sourceVerification?:"verified"|"unavailable" }
interface InternalSummary { prospectFitScore:number; websiteMaturity:"poor"|"basic"|"decent"|"strong"|"unassessed"; urgencyLevel:"low"|"medium"|"high"|"urgent"; likelyPainPoints:string[]; strongestOutreachHooks:string[]; recommendedOpeningAngle:string; topRevenueOpportunities:string[]; technicalBlockers:string[]; aiVisibilityBlockers:string[]; localSeoOpportunities:string[]; trustAndConversionGaps:string[] }
export interface SeoCheckResult { domain:string; scanMode?:string; pagesScanned?:number; pages?:PageResult[]; categories:CategoryResult[]; overallScore:number|null; grade:string; methodologyVersion?:number; aiSearchScore:number|null; aiSearchGrade:string|null; aiPolicyScore?:number|null; aiPolicyGrade?:string|null; scoring?:{methodologyVersion?:number;label?:string;assessed?:boolean;categoryWeights?:Record<string,number>;unscoredLabels?:string[];note?:string}; coverage?:{requestedLimit:number;attemptedPages:number;successfulPages:number;failedPages:number;skippedPages:number;discoveredCandidateUrls:number;totalSitePages:number|null;stopReason:"page-limit"|"time-budget"|"discovery-exhausted"|"fetch-failure"|"blocked"|"other";skippedReasons:Record<string,number>;sitemapIncomplete:boolean;partial:boolean;pageSetHash?:string;pageSetHashBasis:"normalized-url-identities"}; aiBots:AiBotStatus[]; topFixes?:Array<{label:string;category:string;status:"warn"|"fail";fix?:string;pagesAffected:number;totalPages:number}>; issues?:Issue[]; internalSummary?:InternalSummary; severityBreakdown?:Record<string,number>; partial?:boolean; checkedAt:string }

const EMPTY_PAGES: PageResult[] = [];

function dateLabel(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"}).format(d)}
function pagePath(url:string){try{const u=new URL(url);return u.pathname+u.search||"/"}catch{return url}}
function evidenceHref(url:string){try{const parsed=new URL(url);return parsed.protocol==="http:"||parsed.protocol==="https:"?parsed.href:null}catch{return null}}
function coverageText(result:SeoCheckResult){const c=result.coverage;if(!c)return `Pages inspected: ${result.pagesScanned??result.pages?.length??0} (initial HTML).`;const stopReason=c.stopReason==="discovery-exhausted"?"discovery exhausted within the scan's crawl limits":c.stopReason.replace(/-/g," ");return `Coverage: ${c.successfulPages} usable pages from ${c.attemptedPages} attempts; ${c.failedPages} attempts returned no usable page; ${c.skippedPages} candidate URLs were skipped. ${c.discoveredCandidateUrls} candidate URLs were observed beyond the homepage; total site pages are unknown.${c.sitemapIncomplete?" Sitemap discovery was incomplete.":""} Stop reason: ${stopReason}.`}
function homepageInstructionText(model:SeoReportModel){const state=model.accessSummary.homepageIndexDirective;if(model.methodology.version===5)return state==="observed"?"A noindex instruction addressed to Google was observed. Google can act on it only if it retrieves that response.":state==="not-observed"?"No noindex instruction addressed to Google was observed in the inspected page settings.":state==="not-assessed"?"Google applicability of page-level indexing instructions was not assessed.":"The homepage was not checked in this scan.";return state==="observed"?"A noindex instruction was observed.":state==="not-observed"?"No noindex instruction was observed in the inspected page settings.":state==="not-assessed"?"Indexing instructions were not assessed.":"The homepage was not checked in this scan."}
function methodologyDisplayLabel(model:SeoReportModel){return model.methodology.label==="Method not recorded"?model.methodology.label:model.methodology.label+" v"+model.methodology.version}
function methodologyDisclosureText(model:SeoReportModel){return model.methodology.label==="Method not recorded"?model.methodology.label:model.methodology.label+", version "+model.methodology.version}
function indexabilitySummaryText(model:SeoReportModel){if(model.methodology.version===5)return `Page-level Google scope: ${model.accessSummary.noindexCount} noindex instruction(s) addressed to Google observed; ${model.accessSummary.indexabilityNotAssessedCount} not assessed. Google can act on an instruction only if it retrieves that response.`;if(model.methodology.label==="Historical score")return `Legacy page-level noindex instructions observed: ${model.accessSummary.noindexCount}. The saved scan used its original method.`;return "Page-level indexing scope was not interpreted for this saved result."}
function stateLabel(state:ReportDecision["state"]){return state==="Observed mismatch"?"Resolve first":state==="Confirm intended use"?"Confirm intent":state}
function decisionText(finding:ReportDecision,index:number){const relatedPages=finding.relatedPages??[];return `${index+1}. ${finding.title}
Evidence state: ${stateLabel(finding.state)}
What we found: ${finding.observed}
Pages:
${finding.pages.map(page=>`${page.title}: ${page.url}
${page.evidence}`).join("\n")}
${relatedPages.length?`Related pages to compare:\n${relatedPages.map(page=>`${page.title}: ${page.url}\n${page.evidence}`).join("\n")}`:""}
Why it matters: ${finding.whyItMatters}
Recommended decision: ${finding.nextStep}
Who should act: ${finding.owner}
How to verify: ${finding.verification}`}
function summaryText(model:SeoReportModel,result:SeoCheckResult){
 const overview=model.overview;
 const presentation=buildWebsitePresentation({...result,pagesScanned:result.pagesScanned??result.pages?.length??0},model);
 if(overview)return [
  `${methodologyDisplayLabel(model)}: ${model.headline.domain}`,
  `Original scan date: ${dateLabel(result.checkedAt)} UTC. Pages inspected: ${model.coverage.pagesScanned}. ${presentation.stopLabel}.`,presentation.coverageNote,
  presentation.title,presentation.introduction,presentation.interpretation,presentation.direction,
  ...(overview.focusLinks.length?["Where to focus first",...overview.focusLinks.map((item,index)=>`${index+1}. ${item.title} (${item.pageCount} page${item.pageCount===1?"":"s"})`)]:[]),
  ...(overview.findings.length?["Decisions and recommended work",...overview.findings.map(decisionText)]:[]),
  "Basic check results",...presentation.checks.map(check=>`${check.title}: ${check.passed} of ${check.total} passed; ${check.review} to review; ${check.unknown} not assessed. ${check.detail}${check.followUp?` ${check.followUp}`:""}`),
  ...(overview.positiveExamples.length?["Useful content to keep",...overview.positiveExamples.map(item=>`${item.text} ${item.pageTitle}: ${item.url}`)]:[]),
  presentation.aiIntro,...presentation.aiSearch.map(bot=>`${bot.name} (${bot.token}): ${bot.result}`),`AI mentions and citations: ${overview.aiVisibility}`,overview.aiNextStep,"Access observations",...model.aiObservations,
  "Your next steps",...presentation.nextSteps.map((step,index)=>`${index+1}. ${step.title}: ${step.detail}`),
  "Scope",presentation.coverageNote,...model.limitations.filter(text=>!text.startsWith("The scan is incomplete.")),
  presentation.helpDeliverable,`${websiteReviewCta.linkLabel}: ${model.cta.href}`,
 ].join("\n\n");
 return [
  `${methodologyDisplayLabel(model)}: ${model.headline.domain}`,model.headline.interpretation,
  `Pages inspected: ${model.coverage.pagesScanned} (initial HTML).${model.coverage.partial?" Scan incomplete.":""}`,
  model.scoreExplanation.score===null?`${model.scoreExplanation.label}: Not assessed.`:`${model.scoreExplanation.label}: ${model.scoreExplanation.score}/100.`,model.scoreExplanation.note,
  coverageText(result),indexabilitySummaryText(model),model.methodology.notice??"", "Priority findings:",
  ...model.priorityActions.map((a,i)=>`${i+1}. ${a.title}\n${a.observed}\nWhy it matters: ${a.whyItMatters}\nWhat to do next: ${a.nextStep}`),
  "What worked:",...model.strengths,"AI and page content:",...model.aiObservations,...model.limitations,
 ].filter(Boolean).join("\n");
}
function findingsText(model:SeoReportModel){
 if(model.overview)return [methodologyDisplayLabel(model),"Decisions and recommended work",...model.overview.findings.map(decisionText),...model.limitations].join("\n\n");
 return [methodologyDisplayLabel(model),indexabilitySummaryText(model),"Priority findings:",...model.priorityActions.map((a,i)=>`${i+1}. ${a.title}\n${a.observed}\nWhy it matters: ${a.whyItMatters}\nWhat to do next: ${a.nextStep}\nPages: ${a.affectedUrls.join(", ")}`),...model.limitations].join("\n");
}
function DecisionFinding({finding,index,copied,onCopy}:{finding:ReportDecision;index:number;copied:boolean;onCopy:(id:string,text:string)=>void}){
 const relatedPages=finding.relatedPages??[];
 const preservesSourceFieldEvidence=["R1","R2","R3","R4"].includes(finding.ruleId??"");
 return <article className="cls-decision" id={finding.id} data-ui-component-content="decision-finding">
  <h3 data-ui-copy="heading">{finding.title}</h3>
  <p className="cls-decision-state" data-ui-copy="supporting">{stateLabel(finding.state)}</p>
  <div className="cls-decision-block"><h4 data-ui-copy="heading">What we found</h4><p data-ui-copy="body">{finding.observed}</p></div>
  {/* Saved page titles are source labels, not explanatory copy. */}
  <details className="cls-evidence cls-decision-evidence"><summary>View evidence for {finding.pages.length} affected page{finding.pages.length===1?"":"s"}{relatedPages.length?` and ${relatedPages.length} related page to compare`:""}</summary><ul className="cls-decision-pages" aria-label={`Evidence pages for ${finding.title}`}>{finding.pages.map(page=><li key={page.url} data-ui-component-content="decision-page">{evidenceHref(page.url)?<a href={evidenceHref(page.url)!} target="_blank" rel="noopener noreferrer" >{page.title}</a>:<span>{page.title}</span>}{preservesSourceFieldEvidence?<pre className="cls-decision-source-record">{page.evidence}</pre>:<p data-ui-copy="supporting">{page.evidence}</p>}</li>)}</ul>{relatedPages.length>0&&<div className="cls-decision-related"><h4>Related page to compare</h4><ul className="cls-decision-pages">{relatedPages.map(page=><li key={page.url}>{evidenceHref(page.url)?<a href={evidenceHref(page.url)!} target="_blank" rel="noopener noreferrer">{page.title}</a>:<span>{page.title}</span>}<p>{page.evidence}</p></li>)}</ul></div>}</details>
  <div className="cls-decision-block"><h4 data-ui-copy="heading">Why it matters</h4><p data-ui-copy="body">{finding.whyItMatters}</p></div>
  <div className="cls-decision-block"><h4 data-ui-copy="heading">Recommended decision</h4><p data-ui-copy="body">{finding.nextStep}</p></div>
  <div className="cls-decision-block"><h4 data-ui-copy="heading">Who should act</h4><p data-ui-copy="body">{finding.owner}</p></div>
  <div className="cls-decision-block"><h4 data-ui-copy="heading">How to verify</h4><p data-ui-copy="body">{finding.verification}</p></div>
  <div className="cls-card-action"><button type="button" onClick={()=>onCopy(finding.id,decisionText(finding,index))}>{copied?"Copied":"Copy finding"}</button><span className="cls-copy-status" aria-live="polite">{copied?"Finding copied.":""}</span></div>
 </article>;
}
function Metric({value,label}:{value:number|string;label:string}){return <div className="cls-metric"><span className="cls-metric-value">{value}</span><span className="cls-metric-label">{label}</span></div>}
function CategoryWeightSummary({version,weights}:{version:number;weights:Array<[string,number]>}){
 if(!weights.length)return <p data-ui-copy="body">{version===4||version===5?"No scored category was assessed, so no category weights contributed to this score.":"Category weights were not recorded for this scan."}</p>;
 return <><p data-ui-copy="body">{version===4||version===5?"Relative weight units for categories that contributed to this limited score:":"Category weights recorded for this scan:"}</p><ul className="cls-weight-list">{weights.map(([name,weight])=><li key={name}>{name}: {weight} relative units</li>)}</ul></>;
}
function FindingCard({action,index,copied,onCopy}:{action:ReportAction;index:number;copied:boolean;onCopy:(id:string,text:string)=>void}){
 const evidenceCopy=[action.observed,action.whyItMatters,action.nextStep,...action.technicalEvidence,...action.affectedUrls].join("\n");
 return <article className="cls-finding" data-ui-component-content="finding"><div className="cls-finding-meta"><span className="cls-priority">{index+1} · {action.priorityLabel}</span><span className="cls-count">{action.affectedCount} of {action.checkedPageCount} checked page{action.checkedPageCount===1?"":"s"}</span></div><h3 data-ui-copy="heading">{action.title}</h3><div className="cls-finding-copy"><div className="cls-copy-block"><h4>What we found</h4><p data-ui-copy="body">{action.observed}</p><span className="cls-evidence-label">{action.evidenceLabel}</span></div><div className="cls-copy-block"><h4>Why it matters</h4><p data-ui-copy="body">{action.whyItMatters}</p></div><div className="cls-copy-block"><h4>What to do next</h4><p data-ui-copy="body">{action.nextStep}</p></div></div><details className="cls-evidence"><summary>View pages and supporting evidence</summary>{action.affectedUrls.length>0&&<ul className="cls-url-list">{action.affectedUrls.map(url=><li key={url}>{evidenceHref(url)?<a href={evidenceHref(url)!} target="_blank" rel="noopener noreferrer">{url}</a>:<span>{url}</span>}</li>)}</ul>}{action.technicalEvidence.length>0&&<ul className="cls-technical-list">{action.technicalEvidence.map((line,i)=><li key={`${i}-${line}`}>{line}</li>)}</ul>}</details><div className="cls-card-action"><button type="button" onClick={()=>onCopy(action.id,evidenceCopy)}>{copied?"Copied":"Copy finding"}</button><span className="cls-copy-status" aria-live="polite">{copied?"Finding copied.":""}</span></div></article>
}
export default function SeoReport({result,onReset,hideCta=false,showInternal=false}:{result:SeoCheckResult;onReset:()=>void;hideCta?:boolean;showInternal?:boolean}){
 const [copied,setCopied]=useState<string|null>(null);
 const pages=result.pages??EMPTY_PAGES;
 const pagesScanned=result.pagesScanned??pages.length;
 const model=useMemo(()=>buildSeoReportModel({domain:result.domain,methodologyVersion:result.methodologyVersion,pagesScanned,overallScore:result.overallScore,pages,categories:result.categories,issues:(result.issues??[]).map(({id,category,status,title,detail,fix,evidence,affectedUrls,affectedCount,totalPages,confidence})=>({id,category,status,title,detail,fix,evidence,affectedUrls,affectedCount,totalPages,confidence})),aiBots:result.aiBots,coverage:result.coverage,partial:result.partial,checkedAt:result.checkedAt}),[result,pages,pagesScanned]);
 const presentation=buildWebsitePresentation({...result,pagesScanned},model);
 const displayedCategoryWeights=getDisplayedCategoryWeights(result.categories,result.scoring?.categoryWeights??{},model.methodology.version);
 const displayCategories=useMemo(()=>result.methodologyVersion===5?result.categories.map(category=>category.items.some(item=>item.label==="Authoritative citations")?{...category,items:category.items.filter(item=>item.label!=="Authoritative citations"),counts:undefined}:category):result.categories,[result.categories,result.methodologyVersion]);
 const categoryGroups=useMemo(()=>{const groups=new Map<string,typeof model.findingGroups>();for(const finding of model.findingGroups){const list=groups.get(finding.category)??[];list.push(finding);groups.set(finding.category,list)}return [...groups.entries()]},[model]);
 async function copy(key:string,text:string){try{await navigator.clipboard.writeText(text);setCopied(key);window.setTimeout(()=>setCopied(v=>v===key?null:v),1600)}catch{setCopied(null)}}
 const reportActions=<> <div className="cls-intro-actions"><button type="button" className="cls-button cls-button-solid" onClick={()=>copy("summary",summaryText(model,result))}>{copied==="summary"?"Summary copied":"Copy report summary"}</button>{(!model.overview||model.overview.findings.length>0)&&<button type="button" className="cls-button cls-button-outline" onClick={()=>copy("findings",findingsText(model))}>{copied==="findings"?"Findings copied":"Copy findings"}</button>}
    </div><span className="cls-copy-status" role="status" aria-live="polite">{copied==="summary"?"Report summary copied.":copied==="findings"?"Findings copied.":""}</span> </>;
 return <div className={`cls-report ${model.overview?"cls-report-current":""}`}><style>{reportStyles}</style>
  <header className="cls-brandbar"><div className="cls-wrap cls-brandbar-inner"><img className="cls-logo" src={model.overview?"/brand/logos/lockup-horizontal-dark-transparent.png":"/brand/logos/lockup-horizontal-light-transparent.png"} alt="CaseLoad Select"/><span className="cls-report-type">SEO and AEO website review</span></div></header>
  <main className="cls-wrap cls-main" data-ui-component-content="website-report">
   <section className="cls-intro" data-ui-component-content="report-heading">{!model.overview&&<span className="cls-eyebrow">{model.methodology.label}</span>}<h1 data-ui-copy="heading">{model.headline.domain}</h1>{!model.overview&&<p className="cls-lead" data-ui-copy="body">{model.headline.interpretation}</p>}
    <div className="cls-meta" aria-label="Report coverage"><span>{pagesScanned} page{pagesScanned===1?"":"s"} checked</span><span>{model.overview?"Public pages":"Initial HTML"}</span><span>Original scan date {dateLabel(result.checkedAt)} UTC</span>{model.overview?<span className="cls-state">{presentation.stopLabel}</span>:model.coverage.partial&&<span className="cls-state">Partial scan</span>}</div>
    {model.overview&&<p className="cls-coverage-note" data-ui-copy="supporting">{presentation.coverageNote}</p>}
    {model.methodology.notice&&<p className="cls-history-note" data-ui-copy="supporting">{model.methodology.notice}</p>}
    {!model.overview&&reportActions}
   </section>
   {model.overview?<section className="cls-overview" aria-labelledby="cls-overview-title" data-ui-component-content="report-overview">
    <h2 id="cls-overview-title" data-ui-copy="heading">{presentation.title}</h2>
    <p data-ui-copy="body">{presentation.introduction}</p>
    <p data-ui-copy="body">{presentation.interpretation}</p>
    <p className="cls-next-direction" data-ui-copy="body">{presentation.direction}</p>
    {reportActions}
   </section>:<section className="cls-score-row" aria-label="Website checks score" data-ui-component-content="score-disclosure"><div className="cls-score-value"><span className="cls-score-label">{model.scoreExplanation.label}</span><strong>{model.scoreExplanation.score===null?"Not assessed":`${model.scoreExplanation.score}/100`}</strong></div><p className="cls-score-note" data-ui-copy="body">{model.scoreExplanation.note}</p></section>}
   {(!model.overview||model.overview.findings.length>0)&&<section className="cls-section" aria-labelledby="cls-actions-title" data-ui-component-content="priority-findings"><div className="cls-section-head">{!model.overview&&<span className="cls-eyebrow">Review in this order</span>}<h2 id="cls-actions-title" data-ui-copy="heading">Findings and decisions</h2></div>{model.overview&&model.overview.focusLinks.length>0&&<nav className="cls-focus-first" aria-label="Where to focus first"><h3 data-ui-copy="heading">Where to focus first</h3><ol>{model.overview.focusLinks.map((item,index)=><li key={item.id}><a href={`#${item.id}`}>{index+1}. {item.title} · {item.pageCount} page{item.pageCount===1?"":"s"}</a></li>)}</ol></nav>}{model.overview?(model.overview.findings.length?<ol className="cls-decision-order" aria-label="All findings and decisions">{model.overview.findings.map((finding,index)=><li key={finding.id}><DecisionFinding finding={finding} index={index} copied={copied===finding.id} onCopy={copy}/></li>)}</ol>:<p className="cls-empty" data-ui-copy="body">No specific repair was identified in this sample. Use the optional service-page review below if the firm wants to compare its public wording with search and enquiry records.</p>):model.priorityActions.length?model.priorityActions.map((action,index)=><FindingCard key={action.id} action={action} index={index} copied={copied===action.id} onCopy={copy}/>):<p className="cls-empty" data-ui-copy="body">No priority action was identified by these checks. This limited scan does not confirm that the whole website is free of problems.</p>}</section>}

   {model.overview&&model.overview.positiveExamples.length>0&&<section className="cls-section cls-useful-content" aria-labelledby="cls-useful-title" data-ui-component-content="useful-content"><h2 id="cls-useful-title" data-ui-copy="heading">Useful content to keep</h2><ul>{model.overview.positiveExamples.map((item,index)=><li key={`${item.url}-${index}`}><p data-ui-copy="body">{item.text}</p>{evidenceHref(item.url)?<a href={evidenceHref(item.url)!} target="_blank" rel="noopener noreferrer">{item.pageTitle}</a>:<span>{item.pageTitle}</span>}</li>)}</ul></section>}
   {!model.overview&&model.strengths.length>0&&<section className="cls-section cls-strengths" aria-labelledby="cls-strengths-title"><h2 id="cls-strengths-title" data-ui-copy="heading">What worked</h2><ul>{model.strengths.map(text=><li key={text} data-ui-copy="body">{text}</li>)}</ul></section>}   <section className="cls-section cls-ai" aria-labelledby="cls-ai-title" data-ui-component-content="ai-observations">{!model.overview&&<span className="cls-eyebrow">Observations only</span>}<h2 id="cls-ai-title" data-ui-copy="heading">{model.overview?"AI search observations":"AI and page content"}</h2>{model.overview?<><p data-ui-copy="body">{presentation.aiIntro}</p><table className="cls-ai-search-table"><caption>Published rules for search crawlers</caption><thead><tr><th scope="col">AI service</th><th scope="col">Observed result</th></tr></thead><tbody>{presentation.aiSearch.map(bot=><tr key={bot.token}><th scope="row">{bot.name}<small>{bot.token}</small></th><td>{bot.result}</td></tr>)}</tbody></table><div className="cls-ai-assessment" data-ui-component-content="ai-visibility-assessment"><h3 data-ui-copy="heading">Review actual AI answers</h3><p data-ui-copy="body">AI mentions and citations were not measured in this scan.</p><p data-ui-copy="body">A separate review can test questions prospective clients ask about named services. Record whether the firm appears, whether its description is accurate and which pages the answers cite.</p></div><details className="cls-evidence"><summary>Access observations from this scan</summary><div>{model.aiObservations.map((text,index)=><p data-ui-copy="body" key={index}>{text}</p>)}</div></details></>:model.aiObservations.map((text,index)=><p key={index} data-ui-copy="body">{text}</p>)}{model.aiPageObservations.length>0&&<details className="cls-ai-page-observations"><summary>Page-level AEO and AI observations ({model.aiPageObservations.length} observation {model.aiPageObservations.length===1?"group":"groups"})</summary><div><p data-ui-copy="body">These patterns are unscored. They do not prove a problem or measure AI visibility.</p><p data-ui-copy="body">Question-style headings are optional. Sentence counts are broad wording-pattern matches; answer quality was not assessed. AI use, identities and credentials in page code were not verified.</p><ul>{model.aiPageObservations.map((observation)=><li data-ui-component-content="ai-page-observation" key={`${observation.label}-${observation.detail}`}><h3 data-ui-copy="heading">{observation.label}</h3><p data-ui-copy="body">{observation.detail}</p><div className="cls-ai-page-links"><span data-ui-copy="supporting">Pages observed:</span><div>{observation.pageUrls.map((url,index)=><span key={url}>{index>0?", ":""}<a href={url} target="_blank" rel="noopener noreferrer">{pagePath(url)}</a></span>)}</div></div></li>)}</ul><p data-ui-copy="body">Discuss these pages with a human reviewer and your web provider. Check whether they answer client questions, identify the firm or author, and link to useful sources. Provider or account reports may add evidence about AI access or use.</p></div></details>}{!model.overview&&<p data-ui-copy="body">This report does not assign an AI visibility grade. Website checks cannot establish whether an AI service will read or cite a firm.</p>}</section>
   {model.crawlerPolicies.length>0&&<details className="cls-disclosure"><summary>Robots.txt crawler policy observations ({model.crawlerPolicies.length})</summary><div className="cls-disclosure-content"><p data-ui-copy="body">The list below describes crawler purposes, robots.txt rules and documented behavior. A rule does not prove access or use.</p>{model.crawlerPolicies.map(bot=><section className="cls-crawler-policy" data-ui-component-content="crawler-policy-observation" key={bot.token}><h3 data-ui-copy="heading">{bot.name}{bot.name===bot.token?"":<span> ({bot.token})</span>}</h3><p data-ui-copy="body"><strong>Documented purposes:</strong> {bot.purposes.join(", ")}{bot.isControlToken?". This is a policy control token, not a separate crawler":""}. <strong>Published robots.txt rule:</strong> {bot.policyObservation==="blocking-rule-observed"?"Blocking rule observed.":bot.policyObservation==="no-blocking-rule-observed"?"No blocking rule observed.":"Rules not assessed."} <strong>Documented behavior:</strong> {bot.robotsSemantics==="respects"?"The provider says this token follows robots.txt directives.":bot.robotsSemantics==="may-not-apply"?"The provider says robots.txt may not apply to this user-initiated request.":bot.robotsSemantics==="generally-ignores"?"The provider says this user-initiated fetch generally ignores robots.txt.":bot.robotsSemantics==="controls-specified-uses"?"This is a control token for specified uses, not a separate crawler.":"Provider behavior is unknown."} <strong>Actual fetch access:</strong> not verified. {bot.sourceUrl?<><a href={bot.sourceUrl} target="_blank" rel="noopener noreferrer">Provider documentation</a>{bot.reviewedAt&&<> · Reviewed {dateLabel(bot.reviewedAt)} UTC.</>}</>:"Documentation source not verified for this token."}</p></section>)}</div></details>}
   {model.overview&&<section className="cls-section cls-sequence" aria-labelledby="cls-sequence-title" data-ui-component-content="improvement-sequence"><h2 id="cls-sequence-title" data-ui-copy="heading">Your next steps</h2><p data-ui-copy="body">Prioritise the services and types of matters you want to attract. Use the steps below to agree a focused plan.</p><ol aria-label="Recommended next steps">{presentation.nextSteps.map(step=><li key={step.title} data-ui-component-content="improvement-step"><h3 data-ui-copy="heading">{step.title}</h3><p data-ui-copy="body">{step.detail}</p></li>)}</ol>{presentation.serviceExamples.length>0&&<div className="cls-service-examples" data-ui-component-content="service-examples"><p data-ui-copy="body">Service pages in this sample include the following. Choose which deserve attention based on your firm’s priorities.</p><ul>{presentation.serviceExamples.map(page=><li key={page.url}><a href={page.url} target="_blank" rel="noopener noreferrer">{page.title}</a></li>)}</ul><p data-ui-copy="body">The next review needs search-performance data and enquiry records. This public scan did not read those accounts.</p></div>}</section>}

   {!hideCta&&<section className="cls-cta" data-ui-component-content="report-cta"><h2 data-ui-copy="heading">{model.overview?websiteReviewCta.heading:model.cta.heading}</h2><p data-ui-copy="body">{model.overview?presentation.helpDeliverable:model.cta.body}</p><a className="cls-button cls-button-light" href={model.cta.href} target="_blank" rel="noopener noreferrer">{model.overview?websiteReviewCta.linkLabel:model.cta.linkLabel}</a></section>}
   <details className="cls-method" open={model.overview?undefined:true}><summary>{model.overview?"How this check works":"Method and supporting evidence"}</summary>
   <section className="cls-limits" aria-labelledby="cls-limits-title" data-ui-component-content="scope-limitations"><h2 id="cls-limits-title" data-ui-copy="heading">Scan limits</h2>{model.limitations.filter(text=>!model.overview||!text.startsWith("The scan is incomplete.")).map((text,index)=><p key={index} data-ui-copy="body">{text}</p>)}</section>
   <section className="cls-section cls-support" aria-labelledby="cls-support-title" data-ui-component-content="supporting-evidence"><h2 id="cls-support-title" data-ui-copy="heading">Supporting evidence</h2>
       {model.overview&&<details className="cls-disclosure cls-page-inventory"><summary>See the {pages.length} {pages.length===1?"page":"pages"} reviewed</summary><ul className="cls-reviewed-pages">{pages.map(page=><li key={page.url}>{evidenceHref(page.url)?<a href={evidenceHref(page.url)!} target="_blank" rel="noopener noreferrer">{page.title?.trim()||page.url}</a>:<span>{page.title?.trim()||page.url}</span>}<span>{pagePath(page.url)}</span><span>{page.indexability?.googleDirectives?.noindex==="observed"?"Asks Google to exclude this page":page.indexability?.googleDirectives?.noindex==="not-observed"?"No Google exclusion recorded":"Google exclusion settings not assessed"}</span></li>)}</ul></details>}
    {model.overview&&<details className="cls-disclosure cls-basics" data-ui-component-content="basic-checks"><summary>Five basic checks and counts</summary><div className="cls-disclosure-content"><p data-ui-copy="body">These counts show what the five checks found in the reviewed pages. Unassessed checks are separate from passes.</p><ul className="cls-basic-list">{presentation.checks.map(check=><li data-check-id={check.id} key={check.id} data-ui-component-content="basic-check"><h3 data-ui-copy="heading">{check.title}</h3><p data-ui-copy="body"><strong>{check.passed} of {check.total} passed.</strong>{check.review>0?` ${check.review} to review.`:""}{check.unknown>0?` ${check.unknown} not assessed.`:""}</p><p data-ui-copy="body">{check.passed>0?check.detail:"This scan did not establish a passed result for this check. Review the page evidence before deciding on changes."}</p>{check.passed>0&&check.followUp&&<p data-ui-copy="body">{check.followUp}</p>}</li>)}</ul><p className="cls-basic-limit" data-ui-copy="supporting">Description and heading observations are separate editorial review prompts, not additional validated ranking tests. Google indexing, search performance and enquiry quality require a separate review.</p></div></details>}
    <section className="cls-access-strip" aria-labelledby="cls-access-title" data-ui-component-content="search-settings"><div className="cls-access-heading"><h2 id="cls-access-title" data-ui-copy="heading">Search settings on checked pages</h2><p data-ui-copy="body">These observations describe page settings and crawl rules. They do not confirm indexing. No observed exclusion does not prove every site page can be crawled or appears in search.</p><p className="cls-access-homepage"><strong>Homepage:</strong> {homepageInstructionText(model)}</p></div><div className={`cls-metrics ${model.methodology.version===5?"cls-metrics-v5":""}`}><Metric value={model.accessSummary.checkedPageCount} label="Pages inspected"/><Metric value={model.accessSummary.noindexCount} label={model.methodology.version===5?"Pages with Google-addressed noindex":"Checked pages with a noindex instruction"}/>{model.methodology.version===5&&<Metric value={model.accessSummary.indexabilityNotAssessedCount} label="Google scope not assessed"/>}<Metric value={model.accessSummary.googleBlockedCount} label={model.accessSummary.googleNotAssessedCount?`Googlebot restrictions · ${model.accessSummary.googleNotAssessedCount} pages not assessed`:"Googlebot restrictions observed"}/><Metric value={model.accessSummary.bingBlockedCount} label={model.accessSummary.bingNotAssessedCount?`Bingbot restrictions · ${model.accessSummary.bingNotAssessedCount} pages not assessed`:"Bingbot restrictions observed"}/></div>{model.directiveObservations.length>0&&<details className="cls-directive-details"><summary>Page-level crawler directives observed</summary><ul>{model.directiveObservations.map((item,index)=><li key={`${item.url}-${item.source}-${index}`}><strong>{item.scope}{item.crawlerToken?` (${item.crawlerToken})`:""}</strong> · {item.source} · <a href={item.url}>{pagePath(item.url)}</a> · <code>{item.rawValue}</code> · Google applicability: {item.googleApplicability}{item.limitation?` · ${item.limitation}`:""}</li>)}</ul><p>These are directive observations only. They do not verify a crawler&apos;s access, indexing, or downstream use.</p></details>}</section>

    <details className="cls-disclosure"><summary>{model.overview?"Checks and coverage":"Score method and coverage"}</summary><div className="cls-disclosure-content"><p data-ui-copy="body">{model.overview?"This report uses observed website signals and does not assign an overall SEO or AI grade.":model.scoreExplanation.note}</p><p data-ui-copy="body">Method: {methodologyDisclosureText(model)}. Pages inspected: {model.coverage.pagesScanned}. The scan used the initial HTML returned for these pages.</p><p data-ui-copy="body">{coverageText(result)}</p>{!model.overview&&<CategoryWeightSummary version={model.methodology.version} weights={displayedCategoryWeights}/>}{result.scoring?.unscoredLabels&&result.scoring.unscoredLabels.length>0&&<p data-ui-copy="body">Unscored observations: {result.scoring.unscoredLabels.filter(label=>result.methodologyVersion!==5||label!=="Authoritative citations").join(", ")}.</p>}</div></details>
    {model.findingGroups.length>0&&<details className="cls-disclosure"><summary>All findings and decisions ({model.findingGroups.length})</summary><div className="cls-disclosure-content">{categoryGroups.map(([category,findings])=><section className="cls-finding-group" data-ui-component-content="finding-group" key={category}><h3 data-ui-copy="heading">{category}</h3><ul>{findings.map((finding,index)=><li data-ui-component-content="finding-group-item" key={`${finding.title}-${index}`}><strong>{finding.title}</strong><p data-ui-copy="body">{finding.detail}</p>{finding.affectedUrls.length>0&&<ul className="cls-url-list">{finding.affectedUrls.map(url=><li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul>}</li>)}</ul></section>)}</div></details>}
    {!model.overview&&<details className="cls-disclosure"><summary>Pages inspected ({pages.length})</summary><div className="cls-table-wrap"><table><thead><tr><th>Page</th><th>Type</th><th>HTTP</th>{!model.overview&&<th>Website checks</th>}<th>{model.methodology.version===5?"Google index instruction":"Index instruction"}</th></tr></thead><tbody>{pages.map((page,index)=><tr key={`${page.url}-${index}`}><td><a href={page.url} target="_blank" rel="noopener noreferrer">{pagePath(page.url)}</a>{page.title&&<span className="cls-page-title">{page.title}</span>}</td><td>{page.pageType??"Not classified"}</td><td>{page.httpStatus??"Not recorded"}</td>{!model.overview&&<td>{page.categories.some(category=>category.maxScore>0)&&page.pageScore!==null?`${page.pageScore}/100`:"Not assessed"}</td>}<td>{result.methodologyVersion===5?(page.indexability?.googleDirectives?.noindex==="observed"?"Google-addressed noindex observed":page.indexability?.googleDirectives?.noindex==="not-observed"?"No Google-addressed noindex observed":"Google scope not assessed"):typeof result.methodologyVersion==="number"&&result.methodologyVersion>5?"Unsupported method; scope not interpreted":(page.indexability?.metaNoindex===true||page.indexability?.headerNoindex===true?"Noindex instruction observed":page.indexability?.metaNoindex===false&&page.indexability?.headerNoindex===false?"No noindex instruction observed":"Historical noindex status not assessed")}</td></tr>)}</tbody></table></div></details>}
    <details className="cls-disclosure"><summary>Check categories</summary><div className="cls-disclosure-content">{displayCategories.map(category=>{const applicable=category.items.filter(item=>item.scored!==false&&item.applicability!=="not-applicable"&&item.applicability!=="unknown");const counts=category.counts??{fail:applicable.filter(item=>item.status==="fail").length,warn:applicable.filter(item=>item.status==="warn").length,applicable:applicable.length,notAssessed:category.items.filter(item=>item.applicability==="unknown"||(item.scored===false&&item.applicability!=="not-applicable")).length,notApplicable:category.items.filter(item=>item.applicability==="not-applicable").length};return <section className="cls-category" data-ui-component-content="check-category" key={category.name}><div className="cls-category-head"><h3>{category.name}</h3><span>{model.overview?(category.maxScore>0?"Checks assessed":"Observations only"):category.maxScore>0?`${Math.round(category.score/category.maxScore*100)}%`:"Not scored"}</span></div><p>{counts.applicable} applicable page checks · {counts.fail} findings · {counts.warn} to review · {counts.notAssessed} unscored or not assessed · {counts.notApplicable} not applicable</p><ul>{category.items.map((item,index)=><li key={`${item.label}-${index}`}><span className="cls-check-state">{item.applicability==="not-applicable"?"Not applicable":item.applicability==="unknown"?"Not assessed":item.scored===false?(item.disposition==="pending-review"?"Under review":"Not scored"):item.status==="pass"?"Observed":item.status==="warn"?"Review":"Finding"}</span><strong>{item.label}</strong><span>{checkObservationDisplayText(item,result.methodologyVersion)}</span>{(result.methodologyVersion===4||result.methodologyVersion===5)&&item.scored!==false&&item.predicate&&<span className="cls-check-rationale"><strong>{model.overview?"Check basis:":"Score predicate:"}</strong> {item.predicate} <strong>Why included:</strong> {item.scoringRationale}</span>}</li>)}</ul></section>})}</div></details>
   </section><p className="cls-method-link"><a href="https://caseloadselect.ca/tools/seo-check.html#seo-methodology" target="_blank" rel="noopener noreferrer">Read the methodology and source guidelines</a></p></details>
   {showInternal&&result.internalSummary&&<details className="cls-section cls-internal"><summary>Operator analysis · internal use</summary><div className="cls-internal-grid"><p>Prospect fit: {result.internalSummary.prospectFitScore}</p><p>Website maturity: {result.internalSummary.websiteMaturity}</p><p>Urgency: {result.internalSummary.urgencyLevel}</p><h3>Recommended opening angle</h3><p>{result.internalSummary.recommendedOpeningAngle}</p><h3>Strongest outreach hooks</h3><ul>{result.internalSummary.strongestOutreachHooks.map(line=><li key={line}>{line}</li>)}</ul><h3>Top revenue opportunities</h3><ul>{result.internalSummary.topRevenueOpportunities.map(line=><li key={line}>{line}</li>)}</ul></div></details>}

   <footer className="cls-footer"><button type="button" className="cls-button cls-button-outline" onClick={onReset}>Run another scan</button><span>Scan date {dateLabel(result.checkedAt)} UTC</span></footer>
  </main>
 </div>
}const reportStyles = `@font-face{font-family:DM Sans;src:url('/brand/fonts/DM-Sans-latin.woff2') format('woff2');font-style:normal;font-weight:400;font-display:swap}
@font-face{font-family:Manrope;src:url('/brand/fonts/Manrope-latin.woff2') format('woff2');font-style:normal;font-weight:800;font-display:swap}
@font-face{font-family:Oxanium;src:url('/brand/fonts/Oxanium-latin.woff2') format('woff2');font-style:normal;font-weight:600;font-display:swap}
.cls-report{--ink:#0D1520;--navy:#1E2F58;--gold:#C4B49A;--paper:#F4F3EF;--white:#FFFFFF;color:var(--ink);background:var(--paper);font:400 16px/1.55 'DM Sans',Arial,sans-serif;min-height:100vh}
.cls-report *{box-sizing:border-box}
.cls-report h1,.cls-report h2,.cls-report h3{font-family:Manrope,Arial,sans-serif;font-weight:800;letter-spacing:-.02em;line-height:1.15;margin:0;overflow-wrap:anywhere}
.cls-report h1{font-size:clamp(2.5rem,6vw,4.25rem)}
.cls-report h2{font-size:clamp(1.65rem,3vw,2.5rem)}
.cls-report h3{font-size:1.45rem}
.cls-report p{margin:.65rem 0 0;max-width:none}
.cls-report [data-ui-copy]{text-wrap:wrap}
.cls-report a{color:var(--navy);text-decoration-thickness:1px;text-underline-offset:3px;overflow-wrap:anywhere}
.cls-wrap{width:min(100% - 64px,1120px);margin-inline:auto}
.cls-brandbar{background:var(--white);border-bottom:1px solid var(--ink)}
.cls-brandbar-inner{min-height:86px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.cls-logo{display:block;width:220px;height:auto;max-height:48px;object-fit:contain;object-position:left center}
.cls-report-type,.cls-eyebrow,.cls-meta,.cls-priority,.cls-count,.cls-evidence-label,.cls-metric-label,.cls-score-label,.cls-footer,.cls-category-head span,.cls-check-state{font:600 .8rem/1.35 Oxanium,monospace;letter-spacing:.045em;text-transform:uppercase}
.cls-report-type,.cls-eyebrow,.cls-state,.cls-priority,.cls-evidence summary,.cls-disclosure summary,.cls-internal summary,.cls-copy-block h4,.cls-score-value strong,.cls-metric-value,.cls-metric-label,.cls-category-head span,.cls-check-state,.cls-footer{color:var(--navy)}
.cls-main{padding-block:clamp(48px,8vw,104px) 56px}
.cls-intro{padding-bottom:40px;border-bottom:1px solid var(--ink)}
.cls-eyebrow{display:block;margin-bottom:16px}
.cls-lead{font-size:clamp(1.2rem,2.3vw,1.65rem);line-height:1.42;margin-top:22px!important}
.cls-meta{display:flex;flex-wrap:wrap;gap:10px 24px;margin-top:24px;color:var(--ink)}
.cls-history-note{padding:12px 16px;background:var(--white);margin-top:24px!important}
.cls-intro-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.cls-button,.cls-card-action button{font:600 .82rem/1.3 Oxanium,monospace;letter-spacing:.02em;border:1px solid var(--navy);padding:13px 18px;background:transparent;color:var(--navy);text-decoration:none;display:inline-flex;align-items:center;justify-content:center;min-height:48px;cursor:pointer}
.cls-button-solid{background:var(--navy);color:var(--white)}
.cls-button:hover,.cls-card-action button:hover{background:var(--navy);color:var(--white)}
.cls-button-light{background:var(--white);color:var(--navy);border-color:var(--white)}
.cls-copy-status{font:400 .84rem/1.4 'DM Sans',Arial,sans-serif;color:var(--ink)}
.cls-report .cls-overview{padding:32px 0 40px}.cls-overview h2{margin-bottom:20px}.cls-overview h3{font-size:clamp(1.25rem,2.2vw,1.65rem);line-height:1.25}.cls-overview .cls-intro-actions{margin-top:24px}
.cls-report .cls-main{padding-inline:0}.cls-decision-order{list-style:decimal inside;margin:0;padding:0}.cls-decision-order>li{border-top:1px solid var(--ink);padding-top:20px}.cls-decision{padding:8px 0 28px}.cls-decision-state{color:var(--navy);font-weight:700}.cls-decision-block{margin-top:20px}.cls-decision-block h4{margin:0;font:800 1rem/1.35 Manrope,Arial,sans-serif;letter-spacing:-.01em}.cls-decision-pages{list-style:none;margin:20px 0;padding:0}.cls-decision-pages li+li{margin-top:14px}.cls-decision-pages a{display:block;font-weight:700}.cls-report .cls-decision-pages p{margin-top:4px}
/* R1-R4 saved field records keep exact values and wrap as functional evidence. */
.cls-decision-source-record{margin:4px 0 0;font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}.cls-focus-first{padding:18px 0 24px}.cls-focus-first h3{font-size:1.15rem}.cls-focus-first ol{margin:12px 0 0;padding-left:24px}.cls-focus-first li{padding:5px 0;overflow-wrap:anywhere}.cls-focus-first a{font-weight:700}.cls-useful-content ul{list-style:none;padding:0;margin:20px 0}.cls-useful-content li{padding:16px 0;border-top:1px solid var(--ink)}.cls-useful-content li p{margin-top:6px}.cls-sequence ol{list-style:decimal inside;margin:24px 0 0;padding:0}.cls-sequence h3{margin-top:8px}.cls-sequence li+li{margin-top:24px}.cls-sequence h3,.cls-ai-assessment h3{font-size:1.2rem;line-height:1.3}.cls-ai-assessment{margin-top:24px}
.cls-report-current .cls-useful-content h2,.cls-report-current .cls-cta h2,.cls-report-current .cls-focus-first h3{ text-wrap:pretty }
.cls-report-current .cls-useful-content [data-ui-copy]{text-wrap:pretty}
.cls-report-current .cls-useful-content p{font-size:18px}

@media(max-width:480px){.cls-report-current .cls-cta h2{font-size:19px}.cls-report-current .cls-useful-content h2{font-size:20px}.cls-report-current .cls-decision h3{font-size:18px}}


.cls-score-row{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start;padding:30px 0;border-bottom:1px solid var(--ink)}
.cls-score-value{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.cls-score-value strong{font:600 1.1rem/1.2 Oxanium,monospace;border:1px solid var(--navy);padding:10px 14px}
.cls-access-strip{margin-top:46px;padding:24px;background:var(--navy);color:var(--white)}
.cls-access-strip h2{font-size:1.35rem;letter-spacing:-.01em;color:var(--white)}
.cls-access-strip p{color:var(--white);font-size:.94rem}
.cls-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin-top:22px;border-top:1px solid var(--white)}.cls-metrics-v5{grid-template-columns:repeat(5,minmax(0,1fr))}
.cls-directive-details{margin-top:22px;border-top:1px solid rgba(255,255,255,.45);padding-top:14px}.cls-directive-details summary{cursor:pointer;font-weight:600}.cls-directive-details ul{padding-left:20px;margin-top:12px}.cls-directive-details li{margin-top:8px;overflow-wrap:anywhere}.cls-directive-details code{white-space:pre-wrap;overflow-wrap:anywhere}
.cls-metric{padding:18px 16px 0 0;min-width:0}
.cls-metric-value{display:block;font:600 clamp(1.5rem,3vw,2.2rem)/1 Oxanium,monospace;color:var(--white)}
.cls-metric-label{display:block;color:var(--white);margin-top:9px;font-size:.7rem;overflow-wrap:anywhere}
.cls-section{padding:56px 0;border-bottom:1px solid var(--ink)}.cls-report .cls-section{padding-inline:0}
.cls-section-head{margin-bottom:24px}
.cls-section-head h2{margin-top:8px}
.cls-finding{padding:24px 0 26px;border-top:1px solid var(--ink)}
.cls-finding-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 18px;margin-bottom:12px}
.cls-count{text-align:right}
.cls-finding h3{max-width:none}
.cls-finding-copy{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;margin-top:22px}
.cls-copy-block h4{font:600 .82rem/1.3 Oxanium,monospace;text-transform:uppercase;letter-spacing:.05em;margin:0}
.cls-copy-block p{margin-top:6px}
.cls-evidence{margin-top:20px}
.cls-evidence summary,.cls-disclosure summary,.cls-internal summary{cursor:pointer;text-decoration:underline;text-underline-offset:4px;padding-block:8px}
.cls-evidence-label{display:inline-block;margin-top:10px;color:var(--ink);font-size:.68rem}
.cls-url-list,.cls-technical-list{padding-left:22px;margin:14px 0 0}
.cls-url-list li,.cls-technical-list li{margin:7px 0;overflow-wrap:anywhere}
.cls-card-action{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-top:16px}
.cls-card-action button{min-height:40px;padding:9px 13px;font-size:.75rem}
.cls-strengths ul{padding-left:22px;margin:20px 0 0}
.cls-strengths li{padding-left:4px;margin:10px 0}
.cls-ai,.cls-limits{padding:38px 0;border-bottom:1px solid var(--ink)}
.cls-ai-page-observations{margin-top:20px;padding-top:14px;border-top:1px solid var(--ink)}.cls-ai-page-observations summary{cursor:pointer;font-weight:700;color:var(--navy)}.cls-ai-page-links{display:block}.cls-ai-page-links>span{display:block;font-size:.875rem}.cls-ai-page-links a{overflow-wrap:anywhere}.cls-ai-page-observations>div{padding-top:12px}.cls-ai-page-observations p{max-width:none}.cls-ai-page-observations ul{padding-left:0;list-style:none}.cls-ai-page-observations li{margin:10px 0;padding:14px 0;border-top:1px solid var(--ink)}
.cls-limits{background:var(--white);padding:30px 28px;margin-top:24px}
.cls-support{padding-top:52px}
.cls-support>h2{margin-bottom:20px}
.cls-disclosure{border-top:1px solid var(--ink);padding:8px 0}
.cls-disclosure:last-child{border-bottom:1px solid var(--ink)}
.cls-disclosure summary,.cls-evidence summary{list-style:none}
.cls-disclosure summary::-webkit-details-marker,.cls-evidence summary::-webkit-details-marker{display:none}
.cls-disclosure summary:before,.cls-evidence summary:before{content:'+';display:inline-block;width:1.5em;color:var(--navy);font:600 1.1rem Oxanium,monospace;text-decoration:none}
.cls-disclosure[open]>summary:before,.cls-evidence[open]>summary:before{content:'−'}
.cls-disclosure-content{padding:12px 0 22px}
.cls-weight-list{display:flex;flex-wrap:wrap;gap:6px 24px;padding:0;list-style:none;font:600 .76rem Oxanium,monospace}
.cls-finding-group{padding:12px 0 20px;border-top:1px solid var(--ink)}
.cls-finding-group h3{font-size:1.15rem}
.cls-finding-group ul{padding-left:20px}
.cls-finding-group li{margin:14px 0}
.cls-table-wrap{overflow-x:auto;padding:12px 0 18px}
.cls-report table{border-collapse:collapse;width:100%;min-width:680px;text-align:left;font-size:.88rem}
.cls-report th,.cls-report td{padding:12px 14px;border-bottom:1px solid var(--ink);vertical-align:top}
.cls-report th{font:600 .72rem Oxanium,monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--navy)}
.cls-page-title{display:block;font-size:.8rem;margin-top:4px}
.cls-category{padding:18px 0;border-top:1px solid var(--ink)}
.cls-crawler-policy{padding:14px 0;border-top:1px solid var(--ink)}
.cls-crawler-policy h3{font-size:1rem}
.cls-category-head{display:flex;justify-content:space-between;gap:18px;align-items:baseline}
.cls-category-head h3{font-size:1.1rem}
.cls-category>p{font-size:.85rem}
.cls-category>ul{list-style:none;padding:0;margin:14px 0 0}
.cls-category>ul>li{display:grid;grid-template-columns:118px minmax(0,1fr);gap:12px;padding:11px 0;border-top:1px solid var(--ink);font-size:.9rem}
.cls-category>ul>li>span:last-child{grid-column:2}
.cls-check-rationale{font-size:.82rem;color:var(--navy)}
.cls-internal{padding:24px 0;border-bottom:1px solid var(--ink)}
.cls-internal-grid{padding:12px 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 28px}
.cls-internal-grid h3{font-size:1rem;margin-top:12px}
.cls-cta{margin-top:54px;background:var(--navy);color:var(--white);padding:36px 32px}
.cls-cta h2{color:var(--white)}
.cls-report .cls-cta p[data-ui-copy]{color:var(--white);margin:14px 0 23px}
.cls-cta a{color:var(--navy)}
.cls-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-top:34px;text-transform:none;letter-spacing:0}
.cls-empty{padding:22px;background:var(--white);max-width:none!important}
@media(max-width:760px){.cls-wrap{width:min(100% - 40px,1120px)}.cls-brandbar-inner{min-height:72px}.cls-logo{width:184px;max-height:42px}.cls-main{padding-top:48px}.cls-score-row{grid-template-columns:minmax(0,1fr);gap:12px}.cls-access-strip{margin-top:32px;padding:20px}.cls-metrics{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:18px}.cls-metric{padding-top:14px}.cls-section{padding:46px 0}.cls-internal-grid{grid-template-columns:1fr}.cls-cta{padding:28px 22px}}
@media(max-width:420px){.cls-report .cls-overview h3{font-size:1.125rem}.cls-report .cls-decision h3{font-size:1.25rem}.cls-wrap{width:calc(100% - 24px)}.cls-brandbar-inner{min-height:66px;gap:12px}.cls-logo{width:158px;max-height:38px}.cls-report-type{font-size:.68rem}.cls-main{padding-top:38px}.cls-intro{padding-bottom:34px}.cls-intro-actions{display:flex;flex-direction:column;align-items:stretch}.cls-button{width:100%;text-align:center}.cls-meta{gap:8px 14px;font-size:.72rem}.cls-metrics{grid-template-columns:minmax(0,1fr);gap:12px}.cls-metric{padding-right:0}.cls-metric-label{font-size:.68rem}.cls-finding-meta{display:flex;flex-direction:column}.cls-count{text-align:left}.cls-category>ul>li{grid-template-columns:minmax(0,1fr);gap:4px}.cls-category>ul>li>span:last-child{grid-column:1}.cls-report h2{font-size:1.3rem}.cls-score-row{padding-inline:12px}.cls-access-strip{padding:12px}.cls-access-strip h2{font-size:1.2rem}.cls-limits{padding:16px 12px}.cls-report .cls-cta{padding:16px 12px}.cls-footer{align-items:flex-start;flex-direction:column}}
@media(max-width:340px){.cls-logo{width:136px}.cls-report-type{font-size:.62rem}.cls-wrap{width:calc(100% - 16px)}.cls-intro h1{font-size:clamp(2rem,10vw,4.25rem);overflow-wrap:normal;word-break:normal;hyphens:none}.cls-metric-value{font-size:1.45rem}}
/* A 320px marketing viewport embeds the report at 294px; keep AEO copy within 16px gutters. */


.cls-report-current{font-size:18px;line-height:1.6}
.cls-report-current .cls-wrap{width:min(100% - 80px,1040px)}
.cls-report-current .cls-brandbar{background:var(--ink);border:0}
.cls-report-current .cls-report-type{color:var(--gold)}
.cls-report-current .cls-logo{width:245px}
.cls-report-current .cls-main{padding-top:40px}
.cls-report-current h1{font-size:clamp(2rem,5vw,3.6rem)}
.cls-report-current h2{font-size:30px;line-height:1.2}
.cls-report-current h3{font-size:21px;line-height:1.3}
.cls-report-current .cls-intro{border:0;padding-bottom:28px}
.cls-report-current .cls-meta{font:400 15px/1.5 'DM Sans',sans-serif;text-transform:none;letter-spacing:0}
.cls-report-current .cls-state{color:var(--ink)}
.cls-report-current .cls-coverage-note{font-size:15px;color:#4a5a72}
.cls-report-current .cls-overview{padding:30px 32px;background:var(--white)}
.cls-report-current .cls-overview h2{font-size:32px;margin-bottom:16px}
.cls-report-current .cls-next-direction{color:var(--navy);font-weight:700;font-size:20px;margin-top:20px}
.cls-report-current .cls-section{padding:32px 0;border:0}
.cls-report-current .cls-basic-list{list-style:none;padding:0;margin:24px 0 0;background:var(--white)}
.cls-report-current .cls-basic-list li{padding:22px 26px;border-bottom:1px solid #d3d1cb}
.cls-report-current .cls-basic-list li:last-child{border:0}
.cls-report-current .cls-basic-list h3{font-size:20px}
.cls-report-current .cls-basic-list p{font-size:17px}
.cls-report-current .cls-basic-limit{font-size:16px;color:#4a5a72;margin-top:20px}
.cls-report-current .cls-ai-search-table{min-width:0;font-size:17px;margin:22px 0}
.cls-ai-search-table caption{text-align:left;font-size:15px;padding-bottom:8px}
.cls-report-current .cls-ai-search-table th,.cls-report-current .cls-ai-search-table td{padding:14px 12px 14px 0;border-bottom:1px solid #d3d1cb}
.cls-report-current .cls-ai-search-table th[scope=row]{width:34%;font:700 17px/1.5 'DM Sans',sans-serif;text-transform:none;letter-spacing:0;color:var(--ink)}
.cls-ai-search-table small{display:block;font:400 13px/1.6 'DM Sans',sans-serif;color:#4a5a72;overflow-wrap:anywhere}
.cls-report-current .cls-ai-page-observations{font-size:16px}
.cls-report-current .cls-sequence ol{list-style:decimal inside}
.cls-report-current .cls-sequence ol>li{border-top:1px solid #d3d1cb;padding-top:18px}
.cls-report-current .cls-service-examples{margin-top:24px;font-size:16px}
.cls-service-examples ul{padding-left:22px}
.cls-report-current .cls-disclosure,.cls-report-current .cls-method{border-top:1px solid #d3d1cb;padding:14px 0}
.cls-method>summary{cursor:pointer;font-weight:700;padding:8px 0}
.cls-report-current .cls-method .cls-limits{margin:0;background:transparent;padding:24px 0}
.cls-report-current .cls-method .cls-support{padding-top:24px}
.cls-report-current .cls-access-strip{margin-top:20px}
.cls-reviewed-pages{list-style:none;margin:12px 0;padding:0}
.cls-reviewed-pages li{padding:16px 0;border-top:1px solid #d3d1cb}
.cls-reviewed-pages a{font-weight:700;display:block}
.cls-reviewed-pages span{display:block;font-size:14px;color:#4a5a72;overflow-wrap:anywhere}
.cls-report-current .cls-cta{margin-top:30px;padding:30px 32px}
.cls-report-current a:focus-visible,.cls-report-current button:focus-visible,.cls-report-current summary:focus-visible{outline:3px solid var(--gold);outline-offset:4px}
.cls-report-current ::selection{background:var(--navy);color:var(--white)}
@media(max-width:768px){.cls-report-current .cls-wrap{width:calc(100% - 48px)}.cls-report-current .cls-brandbar-inner{flex-direction:column;align-items:flex-start;padding:20px 0;gap:12px}.cls-report-current .cls-overview{padding:26px}.cls-report-current .cls-overview h2{font-size:30px}.cls-report-current .cls-section{padding:28px 0}}
@media(max-width:480px){.cls-report-current{font-size:16px}.cls-report-current .cls-wrap{width:calc(100% - 32px)}.cls-report-current h1{font-size:32px}.cls-report-current h2{font-size:24px}.cls-report-current h3{font-size:19px}.cls-report-current .cls-main{padding-top:28px}.cls-report-current .cls-overview{padding:22px 16px}.cls-report-current .cls-overview h2{font-size:26px}.cls-report-current .cls-next-direction{font-size:18px}.cls-report-current .cls-basic-list li{padding:20px 16px}.cls-report-current .cls-basic-list p{font-size:16px}.cls-report-current .cls-basic-list h3{font-size:19px}.cls-report-current .cls-meta{flex-direction:column;gap:6px}.cls-report-current .cls-cta{padding:24px 16px}.cls-report-current .cls-ai-search-table{font-size:15px}.cls-report-current .cls-ai-search-table th[scope=row]{font-size:15px;width:42%}.cls-report-current .cls-ai-search-table small{font-size:12px}.cls-report-current .cls-report-type{font-size:12px}.cls-report-current .cls-logo{width:220px}.cls-report-current .cls-decision h3{font-size:20px}}


.cls-report-current .cls-overview .cls-next-direction,.cls-report-current .cls-decision [data-ui-copy],.cls-report-current .cls-sequence [data-ui-copy]{text-wrap:wrap}

.cls-report-current .cls-sequence ol{list-style:none;counter-reset:report-step}
.cls-report-current .cls-sequence ol>li{counter-increment:report-step}
.cls-report-current .cls-sequence ol>li>h3::before{content:counter(report-step) '. '}
@media(max-width:480px){.cls-report-current .cls-overview h2{font-size:24px}.cls-report-current .cls-basic-list h3{font-size:18px}}
@media(max-width:360px){.cls-report-current .cls-overview h2{font-size:20px}}


.cls-report-current .cls-decision{font-size:16px}

.cls-report-current .cls-sequence{font-size:16px}

.cls-report-current .cls-overview h2[data-ui-copy]{text-wrap:wrap}
@media(max-width:480px){.cls-report-current .cls-wrap{width:calc(100% - 24px)}.cls-report-current .cls-overview,.cls-report-current .cls-basic-list li,.cls-report-current .cls-cta{padding-inline:12px}}
@media(max-width:330px){.cls-report-current .cls-overview h2{font-size:18px}.cls-report-current .cls-useful-content p{font-size:16px}}



.cls-report .cls-overview [data-ui-copy],.cls-report .cls-decision [data-ui-copy],.cls-report .cls-sequence [data-ui-copy],.cls-report .cls-ai-assessment [data-ui-copy],.cls-report .cls-cta [data-ui-copy]{text-wrap:pretty}
.cls-report-current .cls-crawler-policy [data-ui-copy]{text-wrap:pretty}
.cls-report-current .cls-basics p[data-ui-copy],.cls-report-current .cls-ai>p[data-ui-copy],.cls-report-current .cls-coverage-note{ text-wrap:pretty }
.cls-report-current .cls-decision [data-ui-copy]{text-wrap:pretty}
.cls-report-current .cls-sequence [data-ui-copy]{text-wrap:pretty}
@media(max-width:480px){.cls-report-current .cls-sequence h3{font-size:clamp(17px,5vw,19px)}}
.cls-report-current .cls-overview .cls-next-direction{font-size:16px}
.cls-report-current .cls-ai-page-observations>div>p[data-ui-copy]{text-wrap:pretty}
.cls-report-current .cls-ai-page-observations li p[data-ui-copy]{text-wrap:pretty}
.cls-report-current .cls-support .cls-disclosure-content>p[data-ui-copy]{text-wrap:pretty}
.cls-report-current .cls-crawler-policy h3[data-ui-copy]{text-wrap:wrap}




@media print{@page{size:letter;margin:16mm 15mm}.cls-report{background:#FFFFFF!important;color:#0D1520!important;font-size:10pt;min-height:0}.cls-wrap{width:100%;max-width:none}.cls-brandbar{border-bottom:1px solid #0D1520}.cls-brandbar-inner{min-height:58px}.cls-logo{width:175px;max-height:38px}.cls-main{padding:28px 0}.cls-report h1{font-size:30pt}.cls-report h2{font-size:19pt}.cls-report h3{font-size:13pt}.cls-intro{padding-bottom:22px}.cls-lead{font-size:13pt}.cls-intro-actions,.cls-card-action,.cls-copy-status{display:none!important}.cls-disclosure,.cls-evidence{break-inside:avoid}.cls-disclosure>summary,.cls-evidence>summary{display:none}.cls-disclosure:not([open])>.cls-disclosure-content,.cls-evidence:not([open])>.cls-url-list,.cls-evidence:not([open])>.cls-technical-list{display:block!important}.cls-section{padding:26px 0;break-inside:auto}.cls-finding{break-inside:avoid}.cls-score-row,.cls-access-strip,.cls-cta{print-color-adjust:exact;-webkit-print-color-adjust:exact}.cls-access-strip{margin-top:20px}.cls-metrics{grid-template-columns:repeat(4,1fr)}.cls-cta{margin-top:24px;padding:22px}.cls-report a{color:#0D1520;text-decoration:none}.cls-evidence-label{font-size:7pt}}`;
