import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";
import FirmSwitcher from "./FirmSwitcher";

export default async function AdminSidebar() {
  const { data } = await supabaseAdmin
    .from("intake_firms")
    .select("id, name")
    .order("name");
  const firms = (data ?? []).map((f) => ({
    id: f.id as string,
    name: (f.name as string | null) ?? "Unnamed firm",
  }));

  return (
    <aside className="w-60 shrink-0 bg-deep-black flex flex-col sticky top-0 h-screen overflow-y-auto border-r border-white/5 print:hidden">
      {/* Brand mark links to the console home */}
      <Link href="/admin" className="block px-5 pt-5 pb-4 border-b border-white/8 shrink-0 hover:bg-white/4 transition-colors">
        <div className="font-display text-[11px] uppercase tracking-[0.2em] font-semibold text-gold">
          CaseLoad Select
        </div>
        <div className="text-white/40 text-[9px] mt-0.5 uppercase tracking-widest font-display">
          Operator console
        </div>
      </Link>

      {/* FirmSwitcher renders firm header + FIRM nav + SYSTEM nav */}
      <div className="flex-1 overflow-y-auto py-3">
        <FirmSwitcher firms={firms} />
      </div>

      {/* Sign out */}
      <div className="px-3 pb-5 pt-4 border-t border-white/5 shrink-0">
        <form action="/api/portal/logout" method="POST">
          <button
            type="submit"
            className="w-full text-left text-[10px] font-display font-semibold uppercase tracking-widest text-white/40 hover:text-white/60 px-2 py-1.5 transition"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
