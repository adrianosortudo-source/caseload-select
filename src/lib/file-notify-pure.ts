/**
 * Pure email builders for the firm file exchange notifications.
 *
 * Two flavours:
 *
 *   operator → lawyers   "Adriano shared a new {category} with you"
 *   lawyer   → operator  "{firm} sent a new {category}"
 *
 * Both render with the same branded shell as the magic-link and new-lead
 * emails so the inbox stays coherent.
 */

import { categoryLabel, formatBytes, type FileCategory } from "@/lib/firm-files-pure";

export interface FileEmailInput {
  firmName: string;
  fileDisplayName: string;
  fileCategory: FileCategory;
  fileSizeBytes: number;
  description: string | null;
  filesUrl: string;          // absolute URL to /portal/[firmId]/files
  uploaderRole: "operator" | "lawyer";
  uploaderLabel: string;     // "Adriano" or the lawyer's name; falls back to "Your operator" / "A lawyer"
}

export interface FileEmail {
  subject: string;
  html: string;
}

export function buildFileEmail(input: FileEmailInput): FileEmail {
  const isOperatorUploader = input.uploaderRole === "operator";
  const subject = isOperatorUploader
    ? `${input.uploaderLabel} shared a ${categoryLabel(input.fileCategory).toLowerCase()} with you · ${input.firmName}`
    : `${input.firmName} sent a new ${categoryLabel(input.fileCategory).toLowerCase()}`;
  return { subject, html: renderHtml(input) };
}

function renderHtml(input: FileEmailInput): string {
  const isOperator = input.uploaderRole === "operator";
  const heading = isOperator
    ? `New ${categoryLabel(input.fileCategory)} shared`
    : `New file from ${escapeHtml(input.firmName)}`;
  const body = isOperator
    ? `${escapeHtml(input.uploaderLabel)} just dropped a ${escapeHtml(categoryLabel(input.fileCategory).toLowerCase())} into the portal for ${escapeHtml(input.firmName)}.`
    : `${escapeHtml(input.uploaderLabel)} at ${escapeHtml(input.firmName)} just uploaded a ${escapeHtml(categoryLabel(input.fileCategory).toLowerCase())}.`;

  const descriptionBlock = input.description
    ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.55;color:#3F3C36;background:#F4F3EF;padding:12px 14px;border:1px solid #E4E2DB;">${escapeHtml(input.description)}</p>`
    : "";

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F4F3EF;font-family:'DM Sans',Arial,sans-serif;color:#0D1520;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3EF;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E4E2DB;">
          <tr>
            <td style="background:#0D1520;padding:18px 28px;border-bottom:2px solid #C4B49A;">
              <div style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#C4B49A;">CaseLoad Select · ${escapeHtml(input.firmName)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 4px;">
              <div style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7A6638;">File exchange</div>
              <div style="margin-top:8px;font-family:'Manrope',Arial,sans-serif;font-weight:800;font-size:22px;line-height:1.25;color:#1E2F58;">${heading}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3EF;border:1px solid #E4E2DB;">
                <tr>
                  <td style="padding:14px 16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5C5850;">${escapeHtml(categoryLabel(input.fileCategory))}</td>
                        <td align="right" style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5C5850;">${escapeHtml(formatBytes(input.fileSizeBytes))}</td>
                      </tr>
                    </table>
                    <div style="margin-top:10px;font-family:'DM Sans',Arial,sans-serif;font-size:14px;line-height:1.5;color:#0D1520;font-weight:600;">
                      ${escapeHtml(input.fileDisplayName)}
                    </div>
                    ${descriptionBlock}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#3F3C36;">
                ${body}
              </p>
              <p style="margin:0;">
                <a href="${escapeAttr(input.filesUrl)}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;text-decoration:none;font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;padding:13px 24px;">Open the file</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#EFEDE6;padding:14px 28px;border-top:1px solid #E4E2DB;font-size:11px;color:#9B9690;font-family:'Oxanium',Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;">
              caseloadselect.ca
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]!));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
