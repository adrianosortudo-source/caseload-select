/**
 * POST /api/discovery-report
 *
 * Receives a Discovery Intelligence Report from the ChatGPT GPT Action
 * (sendDiscoveryReport). Stores it in Supabase and emails it to Adriano.
 *
 * This replaces the Google Apps Script webhook, which broke because
 * Google's 302 redirect converts ChatGPT's POST to GET.
 *
 * Body: { firm_name: string; report_content: string }
 * Returns: { status: "success" | "partial" | "error"; stored: boolean; emailed: boolean }
 */

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendEmail } from "@/lib/email";

const RECIPIENT = "adrianosortudo@gmail.com";
const SUBJECT_PREFIX = "CaseLoad Select Discovery Report: ";

// Allow CORS for ChatGPT action calls
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: Request) {
  const headers = corsHeaders();

  try {
    const body = await req.json() as {
      firm_name?: string;
      report_content?: string;
    };

    const firmName = body.firm_name || "Unknown Firm";
    const reportContent = body.report_content || "No content provided";
    const timestamp = new Date().toISOString();

    let stored = false;
    let emailed = false;
    let storeError: string | null = null;
    let emailError: string | null = null;

    // Step 1: Write to Supabase (runs first, never loses data)
    try {
      const { error } = await supabase
        .from("discovery_reports")
        .insert({
          firm_name: firmName,
          report_content: reportContent,
          received_at: timestamp,
        });

      if (error) {
        // Table might not exist yet — create it on first run
        if (error.code === "42P01") {
          console.warn("[discovery-report] Table does not exist. Skipping store. Create the table manually.");
          storeError = "Table discovery_reports does not exist";
        } else {
          storeError = error.message;
        }
      } else {
        stored = true;
      }
    } catch (err) {
      storeError = err instanceof Error ? err.message : String(err);
    }

    // Step 2: Send email via Resend
    try {
      // Convert markdown to basic HTML
      const htmlContent = reportContent
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/^# (.*?)(<br>)/gm, "<h1>$1</h1>")
        .replace(/^## (.*?)(<br>)/gm, "<h2>$1</h2>")
        .replace(/^### (.*?)(<br>)/gm, "<h3>$1</h3>");

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 24px;">
          <div style="background: #1E2F58; color: #ffffff; padding: 24px 32px; border-radius: 4px 4px 0 0;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700;">CaseLoad Select Discovery Report</h1>
            <p style="margin: 8px 0 0; opacity: 0.8; font-size: 14px;">${firmName}</p>
          </div>
          <div style="background: #F4F3EF; padding: 32px; border: 1px solid #e5e5e5; border-top: none; border-radius: 0 0 4px 4px;">
            <p style="color: #6b7280; font-size: 12px; margin: 0 0 24px;">Received: ${new Date(timestamp).toLocaleString("en-CA", { timeZone: "America/Toronto" })}</p>
            <div style="color: #111827; font-size: 14px; line-height: 1.7;">
              ${htmlContent}
            </div>
          </div>
          <p style="color: #9ca3af; font-size: 11px; margin-top: 16px; text-align: center;">
            Sent by CaseLoad Select Intelligence Discovery GPT
          </p>
        </div>
      `;

      const result = await sendEmail(
        RECIPIENT,
        `${SUBJECT_PREFIX}${firmName}`,
        html
      );

      if (result.skipped) {
        emailError = "Resend not configured (dev mode)";
      } else {
        emailed = true;
      }
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
    }

    // Build response
    let status: "success" | "partial" | "error";
    let message: string;

    if (stored && emailed) {
      status = "success";
      message = `Report stored and emailed for ${firmName}`;
    } else if (stored || emailed) {
      status = "partial";
      message = stored
        ? `Report stored but email failed for ${firmName}`
        : `Email sent but storage failed for ${firmName}`;
    } else {
      status = "error";
      message = `Both storage and email failed for ${firmName}`;
    }

    const responseBody = {
      status,
      message,
      stored,
      emailed,
      ...(storeError && { store_error: storeError }),
      ...(emailError && { email_error: emailError }),
    };

    return NextResponse.json(responseBody, {
      status: status === "error" ? 500 : 200,
      headers,
    });
  } catch (err) {
    console.error("[discovery-report] Parse error:", err);
    return NextResponse.json(
      { status: "error", message: "Failed to parse request body", stored: false, emailed: false },
      { status: 400, headers }
    );
  }
}
