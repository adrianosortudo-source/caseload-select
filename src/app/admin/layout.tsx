import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import AdminSidebar from "@/components/admin/AdminSidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getOperatorSession();
  if (!session) {
    redirect("/portal/login?error=missing");
  }

  return (
    <div className="flex min-h-screen bg-parchment">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
          {children}
        </main>
        <footer className="text-center text-xs text-black/30 py-6 shrink-0 flex items-center justify-center gap-4 print:hidden">
          <span>CaseLoad Select operator console</span>
          <span aria-hidden>·</span>
          <a href="/privacy" className="hover:text-navy transition-colors">Privacy</a>
          <span aria-hidden>·</span>
          <a href="/terms" className="hover:text-navy transition-colors">Terms</a>
        </footer>
      </div>
    </div>
  );
}
