/**
 * Email-safe DRG-style correspondence shell.
 *
 * Renders a complete transactional email as a 600px single-column table with
 * inline CSS, an Outlook conditional wrapper, paper ground, cream surface,
 * brass hairlines, ink text, and a restrained oxblood accent. Source Serif
 * with a Georgia / Times fallback. Every colour is a solid hex and every
 * layout primitive is a table, so the output carries no box-shadow, rgba(),
 * flex, grid, positioned layout, or gradient. This mirrors the production
 * layouts in 06_Clients/DRGLaw/02_Strategy/EmailTemplates/ProductionLayouts.
 *
 * Pure: tokens come from resolveEmailBranding, content comes from the caller.
 */

import type { EmailBranding } from "@/lib/email-branding";

export interface EmailDetailRow {
  label: string;
  value: string;
}

export interface EmailShellOptions {
  branding: EmailBranding;
  /** Hidden inbox-preview text. */
  preheader?: string;
  /** Small-caps oxblood eyebrow above the title. */
  eyebrow?: string;
  /** Main title. Omit for a plain letter (the body carries its own greeting). */
  title?: string;
  /** Body HTML. Rendered inside a styled container; arbitrary tags inherit. */
  bodyHtml: string;
  /** Optional definition strip (File / Lawyer / Portal style rows). */
  detailRows?: EmailDetailRow[];
  /** Optional primary CTA button. */
  cta?: { label: string; url: string };
  /** Optional footer line (firm identity / contact), already-safe HTML. */
  footerHtml?: string;
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the full email document. bodyHtml is trusted as already-sanitised
 * (the callers pass content through sanitizeWelcomeHtml / their own escaping);
 * the title, eyebrow, detail rows, CTA label, and footer firm name are escaped
 * here.
 */
export function renderEmailShell(opts: EmailShellOptions): string {
  const b = opts.branding;
  const f = b.fontStack;

  const preheader = opts.preheader
    ? `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${b.paper};">${esc(opts.preheader)}</div>`
    : "";

  const wordmarkSub = b.wordmarkSub
    ? `<p style="margin:7px 0 0 0; font-family:${f}; font-size:10px; line-height:14px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:${b.taupe};">${esc(b.wordmarkSub)}</p>`
    : "";

  const eyebrow = opts.eyebrow
    ? `<p style="margin:0 0 10px 0; font-family:${f}; font-size:11px; line-height:15px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:${b.oxblood};">${esc(opts.eyebrow)}</p>`
    : "";

  const title = opts.title
    ? `<p class="title" style="margin:0 0 14px 0; font-family:${f}; font-size:36px; line-height:40px; font-weight:700; color:${b.ink};">${esc(opts.title)}</p>`
    : "";

  const detail =
    opts.detailRows && opts.detailRows.length ? renderDetail(opts.detailRows, b) : "";

  const cta = opts.cta
    ? `<tr><td class="pad" style="padding:4px 34px 28px 34px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${b.oxblood}" style="background-color:${b.oxblood};"><a href="${esc(opts.cta.url)}" style="display:inline-block; padding:15px 20px; font-family:${f}; font-size:12px; line-height:14px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:${b.oxbloodText}; text-decoration:none;">${esc(opts.cta.label)}</a></td></tr></table></td></tr>`
    : `<tr><td style="padding:0 34px 12px 34px;">&nbsp;</td></tr>`;

  const footer = opts.footerHtml
    ? `<tr><td style="padding:21px 34px 28px 34px; background-color:${b.paper}; border-top:1px solid ${b.brass};"><p style="margin:0; font-family:${f}; font-size:13px; line-height:20px; color:${b.ink};">${opts.footerHtml}</p></td></tr>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${esc(b.firmName)}</title>
    <style>
      body, table, td, p, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
      table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
      table { border-collapse:collapse; }
      .cls-body p { margin:0 0 16px 0; }
      .cls-body p:last-child { margin-bottom:0; }
      .cls-body ol, .cls-body ul { margin:0 0 16px 0; padding-left:22px; }
      .cls-body li { margin:0 0 8px 0; }
      .cls-body a { color:${b.oxblood}; }
      .cls-body strong, .cls-body b { font-weight:700; }
      @media screen and (max-width:620px) { .pad { padding-left:20px !important; padding-right:20px !important; } .title { font-size:30px !important; line-height:34px !important; } }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:${b.paper};">
    ${preheader}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; background-color:${b.paper};"><tr><td align="center" style="padding:22px 10px;">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; max-width:600px; background-color:${b.surface}; border:1px solid ${b.brass};">
        <tr><td class="pad" style="padding:30px 34px 18px 34px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${b.brass}; border-bottom:1px solid ${b.brass}; padding:13px 0 11px 0; text-align:center;"><p style="margin:0; font-family:${f}; font-size:27px; line-height:29px; font-weight:700; color:${b.ink};">${esc(b.wordmark)}</p>${wordmarkSub}</td></tr></table></td></tr>
        <tr><td class="pad" style="padding:8px 34px 0 34px;">${eyebrow}${title}<div class="cls-body" style="font-family:${f}; font-size:16px; line-height:25px; color:${b.ink};">${opts.bodyHtml}</div></td></tr>
        ${detail}
        ${cta}
        ${footer}
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr></table>
  </body>
</html>`;
}

function renderDetail(rows: EmailDetailRow[], b: EmailBranding): string {
  const f = b.fontStack;
  const cells = rows
    .map((r, i) => {
      const last = i === rows.length - 1;
      const bb = last ? "" : `border-bottom:1px solid ${b.rowDivider};`;
      return `<tr><td width="32%" style="padding:13px 18px; ${bb} font-family:${f}; font-size:14px; line-height:20px; font-weight:700; color:${b.oxblood};">${esc(r.label)}</td><td style="padding:13px 18px; ${bb} font-family:${f}; font-size:14px; line-height:20px; color:${b.ink};">${esc(r.value)}</td></tr>`;
    })
    .join("");
  return `<tr><td class="pad" style="padding:14px 34px 22px 34px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${b.paper}; border-top:1px solid ${b.brass}; border-bottom:1px solid ${b.brass};">${cells}</table></td></tr>`;
}
