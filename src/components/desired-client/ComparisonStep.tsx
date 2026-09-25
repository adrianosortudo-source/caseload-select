"use client";
import { COMPARISON_CAPACITY_LABELS, COMPARISON_EVIDENCE_LABELS, COMPARISON_FEE_LABELS, COMPARISON_TEAM_LABELS, getWorkLabel, getWorkOptions } from "@/lib/desired-client/catalog";
import { COMPARISON_STEPS } from "@/lib/desired-client/screens";
import type { AreaId, PendingWorkComparison, WorkId } from "@/lib/desired-client/types";
import { ChoiceGroup } from "./ChoiceGroup";
const fields = [
  { key:"fee_effort", legend:"Fee compared with effort", options:COMPARISON_FEE_LABELS },
  { key:"team_fit", legend:"Fit with the team", options:COMPARISON_TEAM_LABELS },
  { key:"capacity", legend:"Capacity now", options:COMPARISON_CAPACITY_LABELS },
  { key:"evidence", legend:"Basis for this view", options:COMPARISON_EVIDENCE_LABELS },
] as const;
export function ComparisonStep({ area, draft, step, onDraft, onStep, onBack, onCommit }: { area:AreaId; draft:PendingWorkComparison|null; step:1|2|3; onDraft:(d:PendingWorkComparison)=>void; onStep:(s:1|2|3)=>void; onBack:()=>void; onCommit:(side:"a"|"b",certainty:"chosen"|"provisional")=>void }) {
  const options = getWorkOptions(area).filter(x=>x.id!=="other");
  const selected = draft ? [draft.a?.work,draft.b?.work].filter((x):x is WorkId=>!!x) : [];
  const blank=(work:WorkId)=>({work,fee_effort:null,team_fit:null,capacity:null,evidence:null} as const);
  function changeSelected(values:string[]) {
    const kept=values.slice(0,2) as WorkId[];
    if(kept.length<2){ onDraft({a:kept[0]?(draft?.a?.work===kept[0]?draft.a:draft?.b?.work===kept[0]?draft.b:blank(kept[0])):null,b:null,selected:"a"}); return; }
    const a=draft?.a?.work===kept[0]?draft.a:draft?.b?.work===kept[0]?draft.b:blank(kept[0]);
    const b=draft?.a?.work===kept[1]?draft.a:draft?.b?.work===kept[1]?draft.b:blank(kept[1]);
    onDraft({a,b,selected:draft?.selected??"a"});
  }
  function rate(side:"a"|"b", key:typeof fields[number]["key"], value:string) {
    const current=draft;
    if(!current?.a||!current.b) return;
    const candidate=current[side];
    if(!candidate) return;
    onDraft({...current,[side]:{...candidate,[key]:value}} as PendingWorkComparison);
  }
  const pair=draft?.a&&draft.b?{a:draft.a,b:draft.b,selected:draft.selected}:null;
  const complete=!!pair&&fields.every(f=>!!pair.a[f.key]&&!!pair.b[f.key]);
  return <section className="dc-comparison" data-ui-component-content="desired-client-comparison">
    <h1 data-ui-copy="heading">{COMPARISON_STEPS[step-1].heading}</h1>
    {step===1&&<><p data-ui-copy="body">Choose exactly two types of work to compare.</p><ChoiceGroup idPrefix="dc-compare-works" name="comparison-works" legend="Which two types of work are you considering?" options={options} type="checkbox" value={selected} maximum={2} onChange={v=>changeSelected(v as string[])}/></>}
    {step===2&&pair&&<div className="dc-comparison-grid">{(["a","b"] as const).map(side=><article key={side} className="dc-candidate"><h2 data-ui-copy="heading">{getWorkLabel(area,pair[side].work)}</h2>{fields.map(f=><ChoiceGroup key={f.key} idPrefix={`dc-${side}-${f.key}`} name={`${side}-${f.key}`} legend={f.legend} type="radio" value={pair[side][f.key]} options={Object.entries(f.options).map(([id,label])=>({id,label}))} required onChange={value=>rate(side,f.key,value as string)}/>)}</article>)}</div>}
    {step===3&&pair&&<><p data-ui-copy="body">Which work should this profile explore? You can choose a direction to test even when the evidence is incomplete.</p><div className="dc-comparison-grid">{(["a","b"] as const).map(side=><article key={side} className="dc-candidate"><h2 data-ui-copy="heading">{getWorkLabel(area,pair[side].work)}</h2><dl>{fields.map(f=><div key={f.key}><dt data-ui-copy="supporting">{f.legend}</dt><dd data-ui-copy="supporting">{f.options[pair[side][f.key] as keyof typeof f.options]??"Not established"}</dd></div>)}</dl><button type="button" className="dc-button dc-button--primary" onClick={()=>onCommit(side,"chosen")}>Choose {getWorkLabel(area,pair[side].work)}</button><button type="button" className="dc-button dc-button--secondary" onClick={()=>onCommit(side,"provisional")}>Explore {getWorkLabel(area,pair[side].work)} provisionally</button></article>)}</div></>}
    <div className="dc-actions"><button type="button" className="dc-button dc-button--secondary" onClick={step===1?onBack:()=>onStep((step-1) as 1|2|3)}>Back</button>{step===1&&<button type="button" className="dc-button dc-button--primary" disabled={selected.length!==2} onClick={()=>onStep(2)}>Continue</button>}{step===2&&<button type="button" className="dc-button dc-button--primary" disabled={!complete} onClick={()=>onStep(3)}>Continue</button>}</div>
  </section>;
}