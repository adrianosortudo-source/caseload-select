/**
 * Retainer agreement orchestration
 *
 * Called after OTP verification on Band A/B intake sessions.
 * Idempotent: will not generate a second agreement if one already exists
 * for the session.
 *
 * Flow:
 * 1. Idempotency check (one agreement per session)
 * 2. Load session contact + firm data
 * 3. Generate filled PDF via DocuGenerate
 * 4. Create DocuSeal submission (sends signing email to prospect)
 * 5. Store result in retainer_agreements
 *
 * Errors are non-fatal from the caller's perspective — OTP verification
 * succeeds regardless of retainer generation outcome.
 */

import { supabase } from "./supabase";
import { generateRetainerPdf } from "./docugenerate";
import { createRetainerSubmission } from "./docuseal";

export interface RetainerTriggerInput {
  sessionId: string;
  firmId: string;
}

export interface RetainerResult {
  skipped: boolean;
  reason?: string;
  agreementId?: string;
}

export async function triggerRetainerAgreement(
  input: RetainerTriggerInput
): Promise<RetainerResult> {
  const { sessionId, firmId } = input;

  // 1. Idempotency check
  const { data: existing } = await supabase
    .from("retainer_agreements")
    .select("id, status")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existing) {
    return { skipped: true, reason: "agreement_exists", agreementId: existing.id as string };
  }

  // 2. Load session
  const { data: session, error: sessionErr } = await supabase
    .from("intake_sessions")
    .select("id, firm_id, band, contact, practice_area, scoring")
    .eq("id", sessionId)
    .single();

  if (sessionErr || !session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Band guard
  const band = (session.band as string | null) ?? null;
  if (!band || !["A", "B"].includes(band)) {
    return { skipped: true, reason: `band_not_eligible` };
  }

  // 3. Load firm
  const { data: firm, error: firmErr } = await supabase
    .from("intake_firms")
    .select("id, name, location")
    .eq("id", firmId)
    .single();

  if (firmErr || !firm) {
    throw new Error(`Firm ${firmId} not found`);
  }

  // Extract contact
  const contact = (session.contact as Record<string, string | null> | null) ?? {};
  const firstName = (contact.first_name ?? "").trim();
  const lastName = (contact.last_name ?? "").trim();
  const contactName = [firstName, lastName].filter(Boolean).join(" ") || "Prospect";
  const contactEmail = contact.email ?? null;
  const contactPhone = contact.phone ?? null;

  if (!contactEmail) {
    return { skipped: true, reason: "no_email" };
  }

  const today = new Date().toLocaleDateString("en-CA");
  const practiceArea = (session.practice_area as string | null) ?? "Legal Services";
  const firmName = firm.name as string;
  const firmLocation = (firm.location as string | null) ?? "Toronto, ON";

  // 4. Generate PDF via DocuGenerate
  const docResult = await generateRetainerPdf(
    {
      client_name: contactName,
      client_email: contactEmail,
      client_phone: contactPhone ?? "",
      firm_name: firmName,
      firm_location: firmLocation,
      practice_area: practiceArea,
      agreement_date: today,
    },
    `Retainer_${contactName.replace(/\s+/g, "_")}_${today}`
  );

  // 5. Insert record as 'generated' before sending (so we have an ID on DocuSeal failure)
  const { data: agreement, error: insertErr } = await supabase
    .from("retainer_agreements")
    .insert({
      session_id: sessionId,
      firm_id: firmId,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      docugenerate_document_id: docResult.document_id,
      docugenerate_document_url: docResult.document_url,
      status: "generated",
      generated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertErr || !agreement) {
    throw new Error(`retainer_agreements insert failed: ${insertErr?.message}`);
  }

  const agreementId = agreement.id as string;

  // 6. Create DocuSeal submission
  const submission = await createRetainerSubmission({
    documentUrl: docResult.document_url,
    submitters: [
      {
        name: contactName,
        email: contactEmail,
        ...(contactPhone ? { phone: contactPhone } : {}),
        role: "Client",
      },
    ],
    sendEmail: true,
    message: {
      subject: `Your retainer agreement from ${firmName}`,
      body: `Please review and sign your retainer agreement at your earliest convenience. This agreement covers ${practiceArea} services.`,
    },
  });

  // 7. Update agreement with DocuSeal data
  await supabase
    .from("retainer_agreements")
    .update({
      docuseal_submission_id: submission.submission_id,
      docuseal_signing_url: submission.signing_url,
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", agreementId);

  return { skipped: false, agreementId };
}
