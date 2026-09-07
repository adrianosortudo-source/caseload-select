/**
 * /admin/prospects
 *
 * Operator console home for the GTA prospect list. Renders INSIDE the admin
 * layout so the console sidebar stays available (operator requirement: never
 * leave the console shell when moving between tools). Auth is enforced by the
 * parent /admin layout (getOperatorSession + redirect).
 *
 * The list itself is the self-contained artifact served by ./view/route.ts;
 * ProspectsFrame fetches it and renders it in an iframe srcdoc so it behaves
 * exactly as-is (its own filters, search, table) without its styles or scripts
 * touching the console chrome. Standalone by design: no CRM link, no shared
 * data, nothing to configure here.
 */
import ProspectsFrame from "./ProspectsFrame";
import ReconciledProspects from "./ReconciledProspects";

export const dynamic = "force-dynamic";

export default function ProspectsPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Prospect list</h1>
        <p className="text-sm text-black/50 mt-1">
          Browse the reviewed firm expansion alongside the legacy GTA directory clusters.
        </p>
      </div>

      <ReconciledProspects />

      <div>
        <h2 className="text-lg font-bold text-navy">Legacy GTA directory clusters</h2>
        <p className="text-sm text-black/50 mt-1">The original LSO-derived solo and two-lawyer address clusters remain available while their firm-level records are reconciled above.</p>
      </div>
      <ProspectsFrame />
    </div>
  );
}
