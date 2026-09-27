import type { DraftPreview as Preview } from "@/lib/desired-client/brief";
export function DraftPreview({ preview }: { preview: Preview }) {
  return <aside className="dc-preview" data-ui-component-content="desired-client-preview" aria-label={preview.label}>
    <div className="dc-preview__top"><span data-ui-copy="supporting">{preview.label}</span><span className="dc-badge" data-ui-copy="supporting">{preview.badge}</span></div>
    <dl>{preview.rows.map(row => <div className="dc-preview__row" key={row.label}><dt data-ui-copy="supporting">{row.label}</dt><dd data-ui-copy="supporting">{row.value}</dd></div>)}</dl>
    {preview.notes.map(note => <p key={note} data-ui-copy="supporting">{note}</p>)}
  </aside>;
}