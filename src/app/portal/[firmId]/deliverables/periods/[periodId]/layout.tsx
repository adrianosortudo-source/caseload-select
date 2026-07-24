/**
 * Layout for the Weekly Package Control Room's 5 routes (Overview/Content/
 * Assets/Review/Release). Session gate copied from
 * src/app/portal/[firmId]/deliverables/page.tsx: operator OR matching
 * firm-lawyer session; client sessions are excluded (they use
 * /portal/[firmId]/m/[matterId]/* instead). Renders the shared period tab
 * nav above every child route.
 */
import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import PeriodTabNav from "@/components/portal/control-room/PeriodTabNav";

export default async function ControlRoomLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ firmId: string; periodId: string }>;
}) {
  const { firmId, periodId } = await params;

  const session = await getPortalSession();
  if (!session || session.role === "client") {
    redirect("/portal/login");
  }
  if (session.role !== "operator" && session.firm_id !== firmId) {
    redirect("/portal/login");
  }

  return (
    <div>
      <PeriodTabNav firmId={firmId} periodId={periodId} />
      {children}
    </div>
  );
}
