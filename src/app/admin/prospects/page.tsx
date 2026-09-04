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
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function ProspectsPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Prospect list</h1>
        <p className="text-sm text-black/50 mt-1">
          GTA solo and two-lawyer firms from the LSO directory, with verified websites,
          advertising signals, practice areas, and Portuguese / Spanish language tiers.
        </p>
        <Link href="/admin/prospects/brazilian" className="mt-3 inline-flex rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy/90">
          Open Brazilian lawyer research overlay
        </Link>
      </div>

      <ProspectsFrame />
    </div>
  );
}
