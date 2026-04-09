import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendEmail } from "@/lib/email";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { stage } = await req.json();

  const { data: lead, error } = await supabase
    .from("leads")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !lead) {
    return NextResponse.json({ error: error?.message ?? "update failed" }, { status: 400 });
  }

  // WF-06 — on client_won: insert review_request row + send review email
  if (stage === "client_won") {
    // Idempotency guard — never double-insert
    const { data: existing } = await supabase
      .from("review_requests")
      .select("id")
      .eq("lead_id", id)
      .maybeSingle();

    if (!existing) {
      // Resolve law firm notification email (if a firm is linked)
      let firmEmail: string | null = null;
      let firmName = "your law firm";
      if (lead.law_firm_id) {
        const { data: firm } = await supabase
          .from("law_firm_clients")
          .select("name, contact_email")
          .eq("id", lead.law_firm_id)
          .maybeSingle();
        if (firm) {
          firmEmail = firm.contact_email ?? null;
          firmName = firm.name ?? firmName;
        }
      }

      // Determine delivery status before insert
      let reviewStatus: "pending" | "sent" = "pending";
      const reviewEmail = lead.email ?? firmEmail;

      if (reviewEmail) {
        try {
          const result = await sendEmail(
            reviewEmail,
            `How was your experience with ${firmName}?`,
            `<p>Hi ${lead.name},</p>
<p>Thank you for choosing <strong>${firmName}</strong>. We hope your case is progressing well.</p>
<p>We'd love to hear about your experience — your review helps other clients find trusted legal representation.</p>
<p><a href="https://g.page/r/review" style="background:#a07830;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:8px;">Leave a Google Review</a></p>
<p style="color:#888;font-size:12px;margin-top:24px;">CaseLoad Select · caseloadselect.ca</p>`
          );
          if (!result.skipped) reviewStatus = "sent";
        } catch (e) {
          console.error("WF-06 review email error:", e);
        }
      }

      const { data: reviewRow } = await supabase
        .from("review_requests")
        .insert({
          lead_id: id,
          law_firm_id: lead.law_firm_id,
          status: reviewStatus,
        })
        .select()
        .single();

      return NextResponse.json({ lead, review_request: reviewRow ?? null, email_sent: reviewStatus === "sent" });
    }
  }

  return NextResponse.json({ lead });
}
