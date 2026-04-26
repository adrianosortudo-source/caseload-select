/**
 * POST /api/webhooks/docuseal
 *
 * Receives DocuSeal submission lifecycle events and updates the
 * retainer_agreements table accordingly.
 *
 * Events handled:
 *   form.viewed      → status: viewed
 *   form.completed   → status: signed (all signers done)
 *
 * Signature verification: HMAC-SHA256 via X-DocuSeal-Signature header.
 * Set DOCUSEAL_WEBHOOK_SECRET in Vercel env vars.
 *
 * DocuSeal webhook setup (one-time in DocuSeal dashboard):
 *   URL: https://app.caseloadselect.ca/api/webhooks/docuseal
 *   Events: form.viewed, form.completed
 *   Secret: value of DOCUSEAL_WEBHOOK_SECRET
 */

import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { verifyDocuSealWebhook } from "@/lib/docuseal";

// Disable body parsing so we can read raw bytes for signature verification
export const dynamic = "force-dynamic";

interface DocuSealWebhookBody {
  event_type?: string;
  timestamp?: string;
  data?: {
    submission?: {
      id?: string | number;
      status?: string;
    };
    submitter?: {
      id?: string | number;
      email?: string;
    };
  };
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-docuseal-signature") ?? "";

    // Verify signature (skipped if DOCUSEAL_WEBHOOK_SECRET not set)
    if (!verifyDocuSealWebhook(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let body: DocuSealWebhookBody;
    try {
      body = JSON.parse(rawBody) as DocuSealWebhookBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const eventType = body.event_type ?? "";
    const submissionId = String(body.data?.submission?.id ?? "");

    if (!submissionId) {
      return NextResponse.json({ ok: true, note: "no submission_id  -  ignored" });
    }

    const now = new Date().toISOString();

    if (eventType === "form.viewed") {
      // First signer has opened the document
      await supabase
        .from("retainer_agreements")
        .update({ status: "viewed", viewed_at: now, updated_at: now })
        .eq("docuseal_submission_id", submissionId)
        .eq("status", "sent"); // only advance if currently 'sent'

      console.log(`[docuseal-webhook] form.viewed  -  submission ${submissionId}`);
    } else if (eventType === "form.completed") {
      // All signers have signed
      await supabase
        .from("retainer_agreements")
        .update({ status: "signed", signed_at: now, updated_at: now })
        .eq("docuseal_submission_id", submissionId)
        .in("status", ["sent", "viewed"]); // advance from either prior state

      console.log(`[docuseal-webhook] form.completed  -  submission ${submissionId}`);
    } else {
      // Unhandled event  -  acknowledge without action
      console.log(`[docuseal-webhook] unhandled event: ${eventType}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[docuseal-webhook] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
