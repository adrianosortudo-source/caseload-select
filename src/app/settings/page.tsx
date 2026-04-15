import PageHeader from "@/components/PageHeader";

export default function SettingsPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasResend = !!process.env.RESEND_API_KEY;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Phase 1 configuration." />
      <div className="p-8 max-w-2xl space-y-4">
        <div className="card p-5">
          <div className="text-sm font-medium mb-3">Supabase</div>
          <div className="text-xs text-black/60">Project URL</div>
          <div className="font-mono text-sm break-all">{url}</div>
        </div>
        <div className="card p-5">
          <div className="text-sm font-medium mb-3">Resend</div>
          <div className="text-sm">
            {hasResend ? (
              <span className="badge bg-gold/10 text-gold">Connected</span>
            ) : (
              <span className="badge bg-black/5">Not configured — paste RESEND_API_KEY in .env.local</span>
            )}
          </div>
        </div>
        <div className="card p-5">
          <div className="text-sm font-medium mb-3">Operator</div>
          <div className="text-sm">Adriano Domingues — caseloadselect.ca</div>
        </div>
      </div>
    </div>
  );
}
