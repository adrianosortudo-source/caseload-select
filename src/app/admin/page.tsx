/**
 * /admin → /admin/triage
 *
 * The operator console has no dashboard surface yet. Land them on the
 * triage queue, which is the live operating surface.
 */

import { redirect } from "next/navigation";

export default function AdminLanding() {
  redirect("/admin/triage");
}
