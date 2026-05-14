/**
 * Admin domain management — operator-only.
 *
 * POST   /api/admin/domain   { firm_id, domain } → add domain
 * DELETE /api/admin/domain   { firm_id }         → remove domain
 * GET    /api/admin/domain   ?firmId=xxx         → get domain + Vercel status
 *
 * Auth: requireOperator() on every method. Closes Jim Manico audit
 * APP-001 (the route was the gate, not the UI; previously anyone on the
 * public internet could POST to hijack a firm's custom_domain, redirect
 * the firm's portal to attacker-controlled DNS, and exfil lawyer
 * sessions on the path-'/' cookie). Domain ownership verification
 * (TXT-record challenge before write) is a follow-up; current gate
 * relies on operator trust.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { addVercelDomain, removeVercelDomain, getVercelDomainStatus } from "@/lib/vercel-domains";
import { requireOperator } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;

  const firmId = req.nextUrl.searchParams.get("firmId");
  if (!firmId) return NextResponse.json({ error: "firmId required" }, { status: 400 });

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("id, name, custom_domain")
    .eq("id", firmId)
    .single();

  if (!firm) return NextResponse.json({ error: "Firm not found" }, { status: 404 });

  let vercel = null;
  if (firm.custom_domain && process.env.VERCEL_API_TOKEN) {
    try {
      vercel = await getVercelDomainStatus(firm.custom_domain);
    } catch {
      // non-fatal
    }
  }

  return NextResponse.json({ firm, vercel });
}

export async function POST(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firm_id, domain } = await req.json() as { firm_id?: string; domain?: string };
  if (!firm_id || !domain) {
    return NextResponse.json({ error: "firm_id and domain required" }, { status: 400 });
  }

  const normalized = domain.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/$/, "");

  // Register with Vercel (non-fatal if token not set)
  let vercel = null;
  if (process.env.VERCEL_API_TOKEN) {
    try {
      vercel = await addVercelDomain(normalized);
    } catch (err) {
      return NextResponse.json(
        { error: `Vercel domain registration failed: ${(err as Error).message}` },
        { status: 500 }
      );
    }
  }

  const { error } = await supabase
    .from("intake_firms")
    .update({ custom_domain: normalized })
    .eq("id", firm_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    domain: normalized,
    verified: vercel?.verified ?? false,
    dns: {
      type: "CNAME",
      name: normalized,
      value: "cname.vercel-dns.com",
      note: "Add at your DNS provider. Propagation can take up to 24 hours.",
    },
  });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firm_id } = await req.json() as { firm_id?: string };
  if (!firm_id) return NextResponse.json({ error: "firm_id required" }, { status: 400 });

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("custom_domain")
    .eq("id", firm_id)
    .single();

  if (firm?.custom_domain && process.env.VERCEL_API_TOKEN) {
    try {
      await removeVercelDomain(firm.custom_domain);
    } catch (err) {
      console.warn("[admin/domain] Vercel remove failed:", (err as Error).message);
      // non-fatal  -  clear from DB regardless
    }
  }

  await supabase.from("intake_firms").update({ custom_domain: null }).eq("id", firm_id);
  return NextResponse.json({ ok: true });
}
