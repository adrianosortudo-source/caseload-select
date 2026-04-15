/**
 * Domain management API — operator only.
 *
 * POST   /api/admin/domains   Add a custom domain to a firm
 * DELETE /api/admin/domains   Remove a custom domain from a firm
 * GET    /api/admin/domains   List all firms with custom domains
 *
 * Auth: Bearer CRON_SECRET
 *
 * POST body: { firm_id: string, domain: string }
 * DELETE body: { firm_id: string }
 *
 * Flow on add:
 *   1. Register domain with Vercel API
 *   2. Store domain in intake_firms.custom_domain
 *   3. Return CNAME record for DNS setup instructions
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { addVercelDomain, removeVercelDomain, getVercelDomainStatus } from "@/lib/vercel-domains";

function authorized(req: NextRequest): boolean {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("intake_firms")
    .select("id, name, custom_domain")
    .not("custom_domain", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ firms: data });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { firm_id, domain } = await req.json() as { firm_id?: string; domain?: string };
  if (!firm_id || !domain) {
    return NextResponse.json({ error: "firm_id and domain required" }, { status: 400 });
  }

  const normalizedDomain = domain.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/$/, "");

  // Register with Vercel
  let domainStatus;
  try {
    domainStatus = await addVercelDomain(normalizedDomain);
  } catch (err) {
    return NextResponse.json({ error: `Vercel domain add failed: ${(err as Error).message}` }, { status: 500 });
  }

  // Store in Supabase
  const { error: dbErr } = await supabase
    .from("intake_firms")
    .update({ custom_domain: normalizedDomain })
    .eq("id", firm_id);

  if (dbErr) {
    return NextResponse.json({ error: `DB update failed: ${dbErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    domain: normalizedDomain,
    verified: domainStatus.verified,
    dns_instructions: {
      type: "CNAME",
      name: normalizedDomain,
      value: "cname.vercel-dns.com",
      note: "Add this CNAME record at the firm's DNS provider. Verification may take up to 24 hours.",
    },
  });
}

export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { firm_id } = await req.json() as { firm_id?: string };
  if (!firm_id) return NextResponse.json({ error: "firm_id required" }, { status: 400 });

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("custom_domain")
    .eq("id", firm_id)
    .single();

  if (firm?.custom_domain) {
    try {
      await removeVercelDomain(firm.custom_domain);
    } catch (err) {
      console.warn("[admin/domains] Vercel domain remove failed:", (err as Error).message);
      // Non-fatal — remove from DB regardless
    }
  }

  await supabase.from("intake_firms").update({ custom_domain: null }).eq("id", firm_id);
  return NextResponse.json({ ok: true });
}
