import SecureImportRoom from "@/components/portal/SecureImportRoom";
import { requirePortalViewer } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export default async function SecureImportRoomPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params;
  const viewer = await requirePortalViewer(firmId);
  const { data: firm } = await supabase
    .from("intake_firms")
    .select("secure_client_import_enabled, secure_client_import_live_writes_enabled, secure_client_import_max_rows")
    .eq("id", firmId)
    .maybeSingle();
  const enabled =
    firm?.secure_client_import_enabled === true &&
    firm?.secure_client_import_live_writes_enabled === true &&
    process.env.CLIENT_IMPORT_LIVE_WRITES_ENABLED === "true";
  const maxRows = Math.min(Number(firm?.secure_client_import_max_rows ?? 2500), 5000);
  return <SecureImportRoom firmId={firmId} readOnly={viewer.isOperator} enabled={enabled} maxRows={maxRows} />;
}
