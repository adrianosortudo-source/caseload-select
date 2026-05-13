/**
 * @deprecated Removed from scope on 2026-05-06. Do not call from new code.
 *
 * S6 (retainer automation via DocuGenerate + DocuSeal) was permanently
 * removed from the project. The retainer document workflow is lawyer-owned.
 * See master CLAUDE.md "Build Roadmap" and CRM Bible v5.1 DR-032.
 *
 * This file is preserved as dormant code pending a follow-up cleanup.
 *
 * --------------------------------------------------------------------
 * ORIGINAL DESCRIPTION (HISTORICAL):
 *
 * DocuSeal  -  e-signature submission client
 *
 * Creates a signing submission from a DocuGenerate-produced PDF URL.
 * DocuSeal sends the signing email directly to the prospect.
 *
 * Env vars required:
 *   DOCUSEAL_API_KEY          -  API key from docuseal.com dashboard
 *   DOCUSEAL_TEMPLATE_ID      -  template ID defining signature field positions
 *   DOCUSEAL_WEBHOOK_SECRET   -  secret for verifying incoming webhook signatures
 *
 * DocuSeal template setup (one-time):
 *   1. Create a template in the DocuSeal dashboard with a single "Client" signer
 *   2. Add a Signature field + Date Signed field in the appropriate position
 *   3. Save the template ID as DOCUSEAL_TEMPLATE_ID
 *   The document content is replaced per submission via document_url.
 */

import { createHmac, timingSafeEqual } from "crypto";

const BASE_URL = "https://api.docuseal.com";

export interface SubmissionSubmitter {
  name: string;
  email: string;
  phone?: string;
  role?: string;
}

export interface CreateSubmissionOptions {
  documentUrl: string;
  submitters: SubmissionSubmitter[];
  sendEmail?: boolean;
  message?: { subject: string; body: string };
}

export interface CreateSubmissionResult {
  submission_id: string;
  signing_url: string;
}

export async function createRetainerSubmission(
  options: CreateSubmissionOptions
): Promise<CreateSubmissionResult> {
  const apiKey = process.env.DOCUSEAL_API_KEY;
  const templateId = process.env.DOCUSEAL_TEMPLATE_ID;

  if (!apiKey) throw new Error("DOCUSEAL_API_KEY is not set");
  if (!templateId) throw new Error("DOCUSEAL_TEMPLATE_ID is not set");

  const payload = {
    template_id: Number(templateId),
    document_url: options.documentUrl,
    send_email: options.sendEmail ?? true,
    submitters: options.submitters.map((s) => ({
      name: s.name,
      email: s.email,
      ...(s.phone ? { phone: s.phone } : {}),
      ...(s.role ? { role: s.role } : {}),
    })),
    ...(options.message ? { message: options.message } : {}),
  };

  const res = await fetch(`${BASE_URL}/submissions`, {
    method: "POST",
    headers: {
      "X-Auth-Token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`DocuSeal ${res.status}: ${body}`);
  }

  const data = (await res.json()) as unknown;

  // DocuSeal returns an array of submitter objects on success
  const submitters = Array.isArray(data) ? data : [data];
  const first = submitters[0] as Record<string, unknown>;

  const submission_id = String(first.submission_id ?? first.id ?? "");
  const signing_url = String(first.signing_url ?? first.embed_src ?? "");

  if (!submission_id) {
    throw new Error("DocuSeal response missing submission_id");
  }

  return { submission_id, signing_url };
}

/**
 * Verify the HMAC-SHA256 signature on an incoming DocuSeal webhook.
 * DocuSeal sends the signature in the X-DocuSeal-Signature header.
 */
export function verifyDocuSealWebhook(
  rawBody: string,
  signatureHeader: string
): boolean {
  const secret = process.env.DOCUSEAL_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[docuseal] DOCUSEAL_WEBHOOK_SECRET not set  -  skipping signature check");
    return true; // permissive in dev; always set in production
  }

  try {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const sigBuffer = Buffer.from(signatureHeader, "hex");
    const expBuffer = Buffer.from(expected, "hex");
    if (sigBuffer.length !== expBuffer.length) return false;
    return timingSafeEqual(sigBuffer, expBuffer);
  } catch {
    return false;
  }
}
