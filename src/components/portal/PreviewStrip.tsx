/**
 * Operator preview strip (DR-084). The one deliberate visual difference between
 * a preview and the real target view: a slim top bar naming who the operator is
 * viewing as, flagging read-only, and offering the exit. Everything below it is
 * the target's interface unchanged.
 */
export default function PreviewStrip({
  firmId,
  label,
}: {
  firmId: string;
  label: string;
}) {
  return (
    <div className="bg-navy text-white px-4 sm:px-6 py-2 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3">
      <span>
        <span className="uppercase tracking-wider font-bold mr-2">Preview</span>
        Viewing as {label}. Read-only.
      </span>
      <a
        href={`/api/portal/${firmId}/preview/exit`}
        className="uppercase tracking-wider font-semibold underline underline-offset-2 whitespace-nowrap hover:text-gold"
      >
        Exit preview
      </a>
    </div>
  );
}
