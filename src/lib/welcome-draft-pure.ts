/**
 * Pure builder for the named-lead welcome draft (S8 Phase 1 Story 8).
 *
 * Generates the HTML body + plain-text fallback that lands in
 * client_matters.welcome_draft_html / welcome_draft_plain_text when a
 * Band A take creates a matter. The lawyer reviews and edits before
 * sending (the edited version is stored in welcome_draft_edited_html;
 * the original draft is preserved for comparison).
 *
 * No DB / IO in this file. The template is deliberately simple and
 * Ontario-LSO-compliant: no outcome promises, no "specialist /
 * expert" language, no unverifiable superlatives. Just a warm
 * acknowledgment and the next concrete step.
 */

import type { MatterType } from './screen-engine/types';

export interface WelcomeDraftInput {
  primary_name: string;
  matter_type: string;
  practice_area: string;
  firm_name: string;
  lead_lawyer_display_name: string | null;
  lead_lawyer_title: string | null;
  portal_url: string | null; // magic-link URL produced by Story 01
}

export interface WelcomeDraft {
  html: string;
  plain_text: string;
  subject: string;
}

/**
 * Build the welcome draft. The output is deterministic for a given
 * input — same input always produces the same output (no timestamps,
 * no random IDs embedded). This lets the operator regenerate a draft
 * without divergence.
 */
export function buildWelcomeDraft(input: WelcomeDraftInput): WelcomeDraft {
  const firstName = (input.primary_name ?? '').split(/\s+/)[0] || 'there';
  const lawyerName = (input.lead_lawyer_display_name ?? '').trim();
  const lawyerTitle = (input.lead_lawyer_title ?? '').trim();
  const signature = lawyerName
    ? lawyerTitle
      ? `${lawyerName}, ${lawyerTitle}`
      : lawyerName
    : `the ${input.firm_name} team`;

  const matterDescriptor = describeMatter(input.matter_type, input.practice_area);

  const subject = `Welcome to ${input.firm_name} — next steps on your ${matterDescriptor.short}`;

  const portalLine = input.portal_url
    ? `<p>You can also check in on your matter any time at <a href="${escapeAttr(input.portal_url)}">your secure portal</a>. We'll post updates there as things move along.</p>`
    : '';
  const portalLinePlain = input.portal_url
    ? `\n\nYou can also check in on your matter any time at your secure portal: ${input.portal_url}\nWe'll post updates there as things move along.`
    : '';

  const html = `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Thanks for reaching out to ${escapeHtml(input.firm_name)}. I've reviewed what you shared about your ${escapeHtml(matterDescriptor.long)} and I'd like to set up a short call so we can talk through the specifics.</p>
    <p>Here's what to expect next:</p>
    <ol>
      <li>I'll send you a few times that work on my end. Reply with what works for you.</li>
      <li>On the call we'll review what you shared, talk through what's involved, and I'll outline how I'd approach your matter.</li>
      <li>If we decide to work together, I'll send a retainer agreement and a clear scope.</li>
    </ol>
    <p>If anything urgent comes up in the meantime, reply to this email and I'll get back to you the same business day.</p>
    ${portalLine}
    <p>Talk soon,<br>${escapeHtml(signature)}</p>
  `.trim();

  const plain_text = [
    `Hi ${firstName},`,
    '',
    `Thanks for reaching out to ${input.firm_name}. I've reviewed what you shared about your ${matterDescriptor.long} and I'd like to set up a short call so we can talk through the specifics.`,
    '',
    `Here's what to expect next:`,
    `  1. I'll send you a few times that work on my end. Reply with what works for you.`,
    `  2. On the call we'll review what you shared, talk through what's involved, and I'll outline how I'd approach your matter.`,
    `  3. If we decide to work together, I'll send a retainer agreement and a clear scope.`,
    '',
    `If anything urgent comes up in the meantime, reply to this email and I'll get back to you the same business day.`,
    portalLinePlain,
    '',
    `Talk soon,`,
    signature,
  ].join('\n');

  return { html, plain_text, subject };
}

interface MatterDescriptor {
  short: string;
  long: string;
}

function describeMatter(matterType: string, practiceArea: string): MatterDescriptor {
  // Phrasing tuned to be LSO-compliant: descriptive, never asserting
  // outcome or superlative.
  switch (matterType as MatterType) {
    case 'business_setup_advisory':
      return { short: 'business setup', long: 'business setup or incorporation' };
    case 'shareholder_dispute':
      return { short: 'shareholder concern', long: 'shareholder or co-owner concern' };
    case 'unpaid_invoice':
      return { short: 'unpaid invoice', long: 'unpaid invoice or collections matter' };
    case 'contract_dispute':
      return { short: 'contract concern', long: 'contract concern' };
    case 'vendor_supplier_dispute':
      return { short: 'vendor billing concern', long: 'vendor or supplier billing concern' };
    case 'corporate_money_control':
      return { short: 'corporate financial concern', long: 'corporate financial concern' };
    case 'corporate_general':
      return { short: 'corporate matter', long: 'corporate matter' };
    case 'commercial_real_estate':
      return { short: 'commercial real estate transaction', long: 'commercial real estate transaction' };
    case 'residential_purchase_sale':
      return { short: 'real estate transaction', long: 'home purchase or sale' };
    case 'real_estate_litigation':
      return { short: 'real estate concern', long: 'real estate concern' };
    case 'landlord_tenant':
      return { short: 'landlord-tenant matter', long: 'landlord-tenant matter' };
    case 'construction_lien':
      return { short: 'construction matter', long: 'construction or lien matter' };
    case 'preconstruction_condo':
      return { short: 'preconstruction condo matter', long: 'preconstruction condo matter' };
    case 'mortgage_dispute':
      return { short: 'mortgage matter', long: 'mortgage matter' };
    case 'real_estate_general':
      return { short: 'real estate matter', long: 'real estate matter' };
    case 'wrongful_dismissal':
      return { short: 'employment matter', long: 'wrongful dismissal claim' };
    case 'severance_review':
      return { short: 'employment matter', long: 'severance package review' };
    case 'harassment_complaint':
      return { short: 'employment matter', long: 'workplace harassment matter' };
    case 'wage_recovery':
      return { short: 'employment matter', long: 'unpaid wages or wage-recovery matter' };
    case 'employment_contract_review':
      return { short: 'employment matter', long: 'employment contract review' };
    case 'employment_general':
      return { short: 'employment matter', long: 'workplace or employment matter' };
    case 'will_drafting':
      return { short: 'estates matter', long: 'will and estate-planning matter' };
    case 'power_of_attorney':
      return { short: 'estates matter', long: 'power of attorney drafting' };
    case 'probate':
      return { short: 'estates matter', long: 'probate or estate-administration matter' };
    case 'estate_dispute':
      return { short: 'estates matter', long: 'estate dispute' };
    case 'estates_general':
      return { short: 'estates matter', long: 'will, estate, or planning matter' };
    default:
      return { short: practiceArea || 'matter', long: practiceArea ? `${practiceArea} matter` : 'matter' };
  }
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
