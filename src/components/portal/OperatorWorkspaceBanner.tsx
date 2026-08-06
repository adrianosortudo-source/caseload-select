export default function OperatorWorkspaceBanner({ firmName, firmId }: { firmName: string; firmId: string }) {
  return (
    <div className="bg-gold/15 border-b border-gold/30 px-4 sm:px-6 py-3 text-xs text-navy flex flex-col gap-1 sm:gap-2">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3">
        <strong className="uppercase tracking-wider">OPERATOR WORKSPACE</strong>
        <span className="text-navy/80">You are working in {firmName} as CaseLoad Select operator.</span>
        <span className="flex items-center gap-4 whitespace-nowrap">
          <a href={`/admin/firms/${firmId}/support-preview`} className="font-semibold underline underline-offset-2 hover:text-navy">Open support preview</a>
          <a href={`/api/portal/${firmId}/workspace/exit`} className="font-semibold underline underline-offset-2 hover:text-navy">Exit workspace</a>
        </span>
      </div>
      <p className="text-navy/70">You may manage operational content and assets. Lawyer/client approval and authorization actions remain reserved for the firm&apos;s authorized decision-maker.</p>
    </div>
  );
}
