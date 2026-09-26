"use client";
import { STORAGE_COPY } from "@/lib/desired-client/copy";
import type { SavedDraft } from "@/lib/desired-client/types";
export function ResumePanel({ draft,onResume,onNew,onClear,notice,onNoticeDismiss }: { draft:SavedDraft|null;onResume:(mode:"ai"|"structured")=>void;onNew:()=>void;onClear:()=>void;notice:string;onNoticeDismiss:()=>void }) {
  return <section className="dc-resume" data-ui-component-content="desired-client-resume" aria-label="Saved draft">
    {notice&&<div role="status" className="dc-alert"><p data-ui-copy="body">{notice}</p><button className="dc-button dc-button--secondary" onClick={onNoticeDismiss}>Dismiss</button></div>}
    {draft&&<><h2 data-ui-copy="heading">Continue your saved draft</h2><div className="dc-actions"><button className="dc-button dc-button--primary" onClick={()=>onResume("ai")}>{STORAGE_COPY.resumeAI}</button><button className="dc-button dc-button--secondary" onClick={()=>onResume("structured")}>{STORAGE_COPY.resumeStructured}</button><button className="dc-button dc-button--secondary" onClick={onNew}>{STORAGE_COPY.new}</button><button className="dc-button dc-button--secondary" onClick={onClear}>{STORAGE_COPY.clearSaved}</button></div></>}
  </section>;
}