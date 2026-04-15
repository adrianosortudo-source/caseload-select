/**
 * DocuGenerate — PDF generation client
 *
 * Fills a configured template with client and case data, returns a URL
 * to the generated PDF. That URL is passed to DocuSeal for e-signature.
 *
 * Env vars required:
 *   DOCUGENERATE_API_KEY      — API key from docugenerate.com dashboard
 *   DOCUGENERATE_TEMPLATE_ID  — template ID for the retainer agreement
 */

const BASE_URL = "https://api.docugenerate.com/v1";

export interface RetainerVariables {
  client_name: string;
  client_email: string;
  client_phone: string;
  firm_name: string;
  firm_location: string;
  practice_area: string;
  agreement_date: string;
  estimated_fee?: string;
}

export interface GenerateDocumentResult {
  document_id: string;
  document_url: string;
}

export async function generateRetainerPdf(
  variables: RetainerVariables,
  outputFileName?: string
): Promise<GenerateDocumentResult> {
  const apiKey = process.env.DOCUGENERATE_API_KEY;
  const templateId = process.env.DOCUGENERATE_TEMPLATE_ID;

  if (!apiKey) throw new Error("DOCUGENERATE_API_KEY is not set");
  if (!templateId) throw new Error("DOCUGENERATE_TEMPLATE_ID is not set");

  const res = await fetch(`${BASE_URL}/document`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template_id: templateId,
      data: variables,
      ...(outputFileName ? { output_name: outputFileName } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`DocuGenerate ${res.status}: ${body}`);
  }

  const data = (await res.json()) as Record<string, unknown>;

  // DocuGenerate returns { id, document_uri }
  const document_id = String(data.id ?? "");
  const document_url = String(data.document_uri ?? "");

  if (!document_url) {
    throw new Error("DocuGenerate response missing document URL");
  }

  return { document_id, document_url };
}
